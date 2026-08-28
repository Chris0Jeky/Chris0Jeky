import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- commitatlas:project-catalog:start -->";
const END_MARKER = "<!-- commitatlas:project-catalog:end -->";
const MAX_README_BYTES = 1_000_000;
const MAX_CATALOG_BYTES = 512_000;
const LIFECYCLES = new Set(["planned", "active", "maintenance", "paused", "archived"]);
const CI_STATES = new Set(["unavailable", "unconfigured", "stale", "passing", "failing", "pending"]);
const ACTION_KINDS = new Set(["source", "website", "ci", "release", "release-download", "docs", "install", "download"]);

/**
 * Every catalog shape this consumer can read, keyed by the `version` field that CommitAtlas emits.
 *
 * `version` is the *only* compatibility gate, so it has to carry the whole shape difference. Both
 * supported versions are listed because the two ends move independently: `.github/workflows/
 * commitatlas.yml` pins the generator by SHA, so the daily refresh keeps producing whichever shape
 * the pinned commit produces until that pin is deliberately moved.
 *
 * - **1** — the retained legacy shape: `openIssues`, actions with no host fields.
 *   `host`/`external` are *optional* here rather than rejected, because CommitAtlas shipped them
 *   (PR #53) before the version was bumped. The pinned generator now emits version 2, but
 *   commits `7b507dc`..`8eee522f` on it emit version 1 *with* those keys, and a pin can still land
 *   there. They are additive and nothing here renders them, so tolerating them keeps a partial SHA
 *   bump from turning the refresh red, and keeps a future additive generator change from being
 *   breaking for a field this consumer never reads.
 * - **2** — `openIssues` renamed to `openIssuesAndPullRequests` (the value always counted pull
 *   requests too), and `host`/`external` now *required* on every action.
 *
 * A version outside this table is rejected outright. That is the point of the field: an unreadable
 * catalog must fail loudly rather than let a renamed key be read back as `undefined`.
 */
const CATALOG_SHAPES = new Map([
  [1, {
    issueCountKey: "openIssues",
    requiredActionKeys: ["kind", "label", "url", "origin"],
    optionalActionKeys: ["host", "external"],
  }],
  [2, {
    issueCountKey: "openIssuesAndPullRequests",
    requiredActionKeys: ["kind", "label", "url", "origin", "host", "external"],
    optionalActionKeys: [],
  }],
]);
const SUPPORTED_VERSIONS = [...CATALOG_SHAPES.keys()];

export function updateProjectCatalog(readmePath, catalogPath) {
  const readme = readBounded(readmePath, MAX_README_BYTES, "README");
  const rawCatalog = readBounded(catalogPath, MAX_CATALOG_BYTES, "project catalog");
  let catalog;
  try {
    catalog = JSON.parse(rawCatalog);
  } catch (error) {
    throw new Error(`project catalog is not valid JSON: ${error.message}`, { cause: error });
  }
  validateCatalog(catalog);
  const replacement = renderProjectTable(catalog);
  const updated = replaceMarkedRegion(readme, replacement);
  if (updated !== readme) fs.writeFileSync(readmePath, updated, "utf8");
  return { changed: updated !== readme, rendered: replacement };
}

export function validateCatalog(catalog) {
  const root = object(catalog, "catalog");
  exactKeys(root, ["version", "generator", "user", "source", "generatedAt", "window", "projects"], "catalog");
  const shape = catalogShape(root.version);
  if (root.generator !== "CommitAtlas") fail("catalog.generator must be CommitAtlas");
  text(root.user, "catalog.user", 80);
  if (root.source !== "github-public-rest") fail("catalog.source must be github-public-rest");
  text(root.generatedAt, "catalog.generatedAt", 80);
  if (Number.isNaN(Date.parse(root.generatedAt)) || !root.generatedAt.includes("T")) fail("catalog.generatedAt must be an ISO timestamp");

  const window = object(root.window, "catalog.window");
  exactKeys(window, ["from", "to", "days", "observedDays", "complete"], "catalog.window");
  date(window.from, "catalog.window.from");
  date(window.to, "catalog.window.to");
  integer(window.days, "catalog.window.days", 1, 366);
  integer(window.observedDays, "catalog.window.observedDays", 0, window.days);
  if (typeof window.complete !== "boolean") fail("catalog.window.complete must be a boolean");
  if (window.from > window.to) fail("catalog.window.from must not be after catalog.window.to");

  if (!Array.isArray(root.projects) || root.projects.length < 1 || root.projects.length > 6) {
    fail("catalog.projects must contain between one and six entries");
  }
  const repositories = new Set();
  root.projects.forEach((project, index) => validateProject(project, index, repositories, shape));
  return root;
}

function validateProject(value, index, repositories, shape) {
  const prefix = `catalog.projects[${index}]`;
  const project = object(value, prefix);
  exactKeys(project, ["repo", "name", "label", "lifecycle", "stars", "forks", shape.issueCountKey, "ci", "actions"], prefix, ["description", "primaryLanguage", "pushedAt", "release"]);
  text(project.repo, `${prefix}.repo`, 140);
  if (!/^[^/\s]+\/[^/\s]+$/.test(project.repo)) fail(`${prefix}.repo must be an owner/name repository slug`);
  const repositoryKey = project.repo.toLowerCase();
  if (repositories.has(repositoryKey)) fail(`duplicate repository: ${project.repo}`);
  repositories.add(repositoryKey);
  text(project.name, `${prefix}.name`, 80);
  text(project.label, `${prefix}.label`, 80);
  if (!LIFECYCLES.has(project.lifecycle)) fail(`${prefix}.lifecycle is invalid`);
  if (project.description !== undefined) text(project.description, `${prefix}.description`, 500);
  if (project.primaryLanguage !== undefined) text(project.primaryLanguage, `${prefix}.primaryLanguage`, 80);
  if (project.pushedAt !== undefined) text(project.pushedAt, `${prefix}.pushedAt`, 80);
  integer(project.stars, `${prefix}.stars`, 0, Number.MAX_SAFE_INTEGER);
  integer(project.forks, `${prefix}.forks`, 0, Number.MAX_SAFE_INTEGER);
  integer(project[shape.issueCountKey], `${prefix}.${shape.issueCountKey}`, 0, Number.MAX_SAFE_INTEGER);

  const ci = object(project.ci, `${prefix}.ci`);
  exactKeys(ci, ["state", "label", "workflow"], `${prefix}.ci`, ["url"]);
  if (!CI_STATES.has(ci.state)) fail(`${prefix}.ci.state is invalid`);
  text(ci.label, `${prefix}.ci.label`, 80);
  if (ci.workflow !== null) text(ci.workflow, `${prefix}.ci.workflow`, 80);
  if (ci.url !== undefined) safeHttps(ci.url, `${prefix}.ci.url`);

  if (project.release !== undefined) {
    const release = object(project.release, `${prefix}.release`);
    exactKeys(release, ["tag", "name", "url"], `${prefix}.release`, ["download"]);
    text(release.tag, `${prefix}.release.tag`, 80);
    text(release.name, `${prefix}.release.name`, 80);
    safeHttps(release.url, `${prefix}.release.url`);
    if (release.download !== undefined) {
      const download = object(release.download, `${prefix}.release.download`);
      exactKeys(download, ["name", "url"], `${prefix}.release.download`);
      text(download.name, `${prefix}.release.download.name`, 80);
      safeHttps(download.url, `${prefix}.release.download.url`);
    }
  }

  if (!Array.isArray(project.actions) || project.actions.length < 1) fail(`${prefix}.actions must contain at least one emitted action`);
  const kinds = new Set();
  let sourceCount = 0;
  project.actions.forEach((value, actionIndex) => {
    const actionPrefix = `${prefix}.actions[${actionIndex}]`;
    const action = object(value, actionPrefix);
    exactKeys(action, shape.requiredActionKeys, actionPrefix, shape.optionalActionKeys);
    if (!ACTION_KINDS.has(action.kind)) fail(`${actionPrefix}.kind is invalid`);
    if (kinds.has(action.kind)) fail(`${prefix}.actions contains duplicate kind ${action.kind}`);
    kinds.add(action.kind);
    if (action.kind === "source") sourceCount += 1;
    text(action.label, `${actionPrefix}.label`, 80);
    safeHttps(action.url, `${actionPrefix}.url`);
    if (action.origin !== "snapshot" && action.origin !== "config") fail(`${actionPrefix}.origin is invalid`);
    if (action.kind === "source" && action.origin !== "snapshot") fail(`${actionPrefix}.source action must be observed in the snapshot`);
    // `host` and `external` are the destination-disclosure pair, and they are checked to different
    // depths on purpose. Nothing in the README renders either one.
    //
    // `host` is reconciled with its own `url`: CommitAtlas emits literally
    // `new URL(url).hostname.toLowerCase()`, so agreement is exact rather than approximate and this
    // rule can never drift away from the generator. A `host` that disagrees is a generator defect.
    //
    // `external` is only type-checked. Deriving it needs CommitAtlas's GITHUB_OWNED_HOSTS, a policy
    // list that upstream owns and revises; a copy here would turn the next hostname it adds into a
    // red scheduled run on a correct catalog. That boundary is enforced where the list lives.
    if (action.host !== undefined) actionHost(action.host, `${actionPrefix}.host`, action.url);
    if (action.external !== undefined && typeof action.external !== "boolean") fail(`${actionPrefix}.external must be a boolean`);
  });
  if (sourceCount !== 1) fail(`${prefix}.actions must contain exactly one source action`);
}

export function renderProjectTable(catalog) {
  validateCatalog(catalog);
  const shape = catalogShape(catalog.version);
  const rows = [
    "| Project | Status | Signals/actions |",
    "| --- | --- | --- |",
  ];
  for (const project of catalog.projects) {
    const source = project.actions.find((action) => action.kind === "source");
    const projectLink = `[${escapeTable(project.label)}](${markdownDestination(source.url)})`;
    const status = `${escapeTable(capitalize(project.lifecycle))} · CI ${escapeTable(project.ci.state)}`;
    const signals = [
      // Zero-valued vanity counts are omitted; open work is always stated.
      [
        project.stars > 0 ? `${project.stars} stars` : null,
        project.forks > 0 ? `${project.forks} forks` : null,
        `${project[shape.issueCountKey]} open issues/PRs`,
      ].filter(Boolean).join(" · "),
      project.primaryLanguage ? `Language: ${escapeTable(project.primaryLanguage)}` : null,
      project.ci.workflow ? `Workflow: ${escapeTable(project.ci.workflow)}` : null,
      project.release ? `Release: ${escapeTable(project.release.tag)}` : null,
    ].filter(Boolean);
    const actions = project.actions
      .filter((action) => action.kind !== "source")
      .map((action) => `[${escapeTable(action.label)}](${markdownDestination(action.url)})`);
    if (actions.length > 0) signals.push(`Actions: ${actions.join(" · ")}`);
    rows.push(`| ${projectLink} | ${status} | ${signals.join("; ")} |`);
  }
  return rows.join("\n");
}

export function replaceMarkedRegion(readme, replacement) {
  if (typeof readme !== "string") fail("README must be text");
  const startCount = count(readme, START_MARKER);
  const endCount = count(readme, END_MARKER);
  if (startCount !== 1 || endCount !== 1) fail("README must contain exactly one project-catalog marker pair");
  const start = readme.indexOf(START_MARKER);
  const end = readme.indexOf(END_MARKER);
  if (start > end) fail("project-catalog markers are reversed");
  const interiorStart = start + START_MARKER.length;
  if (end < interiorStart) fail("project-catalog markers overlap");
  return `${readme.slice(0, interiorStart)}\n${replacement}\n${readme.slice(end)}`;
}

function readBounded(filePath, limit, label) {
  if (typeof filePath !== "string" || filePath.length === 0) fail(`${label} path is required`);
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`, { cause: error });
  }
  if (!stats.isFile()) fail(`${label} must be a regular file`);
  if (stats.size > limit) fail(`${label} exceeds the ${limit}-byte read limit`);
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Resolve the shape for a catalog version, or refuse to read the catalog at all.
 *
 * Lookup is by `Map` identity, so no coercion happens: `"2"`, `2.0000001`, `null` and a missing
 * field all miss the table and fail here rather than further down where a renamed key would read
 * back as `undefined`.
 */
export function catalogShape(version) {
  const shape = CATALOG_SHAPES.get(version);
  if (!shape) fail(`catalog.version must be one of ${SUPPORTED_VERSIONS.join(", ")}, received ${describeVersion(version)}`);
  return shape;
}

function describeVersion(value) {
  if (typeof value !== "number") return `a non-numeric ${value === null ? "null" : typeof value} value`;
  return Number.isFinite(value) ? String(value) : "a non-finite number";
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, required, label, optional = []) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} contains unknown field ${key}`);
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label}.${key} is required`);
}

function text(value, label, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail(`${label} must be bounded text`);
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} must be a safe non-negative integer`);
}

function date(value, label) {
  text(value, label, 10);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(`${label} must be an ISO date`);
}

function safeHttps(value, label) {
  text(value, label, 500);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a safe HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(`${label} must be a safe HTTPS URL without credentials`);
}

function actionHost(value, label, url) {
  text(value, label, 253);
  if (value !== value.toLowerCase()) fail(`${label} must be a lowercase hostname`);
  let observed;
  try {
    observed = new URL(url).hostname.toLowerCase();
  } catch {
    fail(`${label} cannot be reconciled with an unparseable action URL`);
  }
  if (value !== observed) fail(`${label} must match the hostname of its own action URL`);
}

function escapeTable(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function markdownDestination(value) {
  return String(value).replace(/[()<>|\\]/g, (character) => encodeURIComponent(character));
}

function capitalize(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

function fail(message) {
  throw new Error(message);
}

function main() {
  if (process.argv.length !== 4) {
    throw new Error("Usage: node scripts/update-project-catalog.mjs <README path> <projects.json path>");
  }
  const result = updateProjectCatalog(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
  console.log(result.changed ? "Updated selected work project catalog." : "Selected work project catalog is already current.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
