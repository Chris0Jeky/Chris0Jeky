import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateProjectCatalog } from "../scripts/update-project-catalog.mjs";

const START = "<!-- commitatlas:project-catalog:start -->";
const END = "<!-- commitatlas:project-catalog:end -->";

const ACTIONS = [
  { kind: "source", label: "Source", url: "https://github.com/Chris0Jeky/Alpha", origin: "snapshot" },
  { kind: "website", label: "Website", url: "https://chris0jeky.github.io/Alpha/", origin: "snapshot" },
  { kind: "ci", label: "CI", url: "https://github.com/Chris0Jeky/Alpha/actions/workflows/ci.yml", origin: "snapshot" },
  { kind: "docs", label: "Docs", url: "https://github.com/Chris0Jeky/Alpha#readme", origin: "config" },
];

/**
 * Attach the version-2 disclosure pair the way CommitAtlas does: `host` is exactly
 * `new URL(url).hostname.toLowerCase()`, and `external` is true for any host off the fixed
 * GitHub-operated hostnames -- a `*.github.io` Pages host included, because that label is
 * owner-chosen.
 */
function disclosed(actions) {
  return actions.map((action) => {
    const host = new URL(action.url).hostname.toLowerCase();
    return { ...action, host, external: host !== "github.com" };
  });
}

/** A version-1 catalog exactly as the currently pinned CommitAtlas Action emits it. */
function catalogV1(overrides = {}) {
  return {
    version: 1,
    generator: "CommitAtlas",
    user: "Chris0Jeky",
    source: "github-public-rest",
    generatedAt: "2026-08-20T05:23:00.000Z",
    window: { from: "2025-08-21", to: "2026-08-20", days: 365, observedDays: 365, complete: true },
    projects: [
      {
        repo: "Chris0Jeky/Alpha",
        name: "Alpha",
        label: "Alpha",
        lifecycle: "active",
        primaryLanguage: "TypeScript",
        stars: 12,
        forks: 3,
        openIssues: 1,
        ci: { state: "passing", label: "Passing", workflow: "ci.yml", url: "https://github.com/Chris0Jeky/Alpha/actions/workflows/ci.yml" },
        release: { tag: "v1.0.0", name: "Alpha 1.0.0", url: "https://github.com/Chris0Jeky/Alpha/releases/tag/v1.0.0" },
        actions: ACTIONS.map((action) => ({ ...action })),
      },
    ],
    ...overrides,
  };
}

/** The version-2 catalog: the issue count is renamed, and every action carries host/external. */
function catalog(overrides = {}) {
  const base = catalogV1();
  const { openIssues, ...entry } = base.projects[0];
  return {
    ...base,
    version: 2,
    projects: [{ ...entry, openIssuesAndPullRequests: openIssues, actions: disclosed(ACTIONS) }],
    ...overrides,
  };
}

function project(value, overrides) {
  return { ...value, projects: [{ ...value.projects[0], ...overrides }] };
}

function fixture(readme, value = catalog()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commitatlas-profile-"));
  const readmePath = path.join(directory, "README.md");
  const catalogPath = path.join(directory, "projects.json");
  fs.writeFileSync(readmePath, readme, "utf8");
  fs.writeFileSync(catalogPath, `${JSON.stringify(value)}\n`, "utf8");
  return { readmePath, catalogPath };
}

function render(value) {
  const paths = fixture(`# Selected work\n\n${START}\nplaceholder\n${END}\n`, value);
  const result = updateProjectCatalog(paths.readmePath, paths.catalogPath);
  return { ...result, readme: fs.readFileSync(paths.readmePath, "utf8"), paths };
}

function rejects(value, message) {
  const readme = `${START}\n${END}\n`;
  const paths = fixture(readme, value);
  assert.throws(() => updateProjectCatalog(paths.readmePath, paths.catalogPath), message);
  // Failing closed means failing before any write: the README keeps its untouched marker body.
  assert.equal(fs.readFileSync(paths.readmePath, "utf8"), readme);
}

test("renders the ordered version 2 catalog and is idempotent", () => {
  const first = render(catalog());
  assert.equal(first.changed, true);
  assert.match(first.readme, /\| Project \| Status \| Signals\/actions \|/);
  assert.match(first.readme, /\[Alpha\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha\)/);
  // The count is read from openIssuesAndPullRequests and stays labelled as covering both.
  assert.match(first.readme, /1 open issues\/PRs/);
  assert.match(first.readme, /12 stars · 3 forks · 1 open issues\/PRs/);
  // Zero-valued vanity counts are omitted from the rendered table; open work is always stated.
  const humble = render(catalog({ projects: [{ ...catalog().projects[0], stars: 0, forks: 0 }] }));
  assert.match(humble.readme, /\| 1 open issues\/PRs;/);
  assert.doesNotMatch(humble.readme, /\b0 stars|\b0 forks/);
  assert.match(first.readme, /\[Docs\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha#readme\)/);
  assert.equal((first.readme.match(new RegExp(START, "g")) ?? []).length, 1);
  assert.equal((first.readme.match(new RegExp(END, "g")) ?? []).length, 1);
  const second = updateProjectCatalog(first.paths.readmePath, first.paths.catalogPath);
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(first.paths.readmePath, "utf8"), first.readme);
});

test("renders a version 1 catalog from the pinned generator identically", () => {
  // The pin in .github/workflows/commitatlas.yml still emits v1, so this is the shape the daily
  // refresh actually feeds in today. Identical output proves the rename changed no rendering.
  assert.equal(render(catalogV1()).readme, render(catalog()).readme);
});

test("tolerates the additive host and external keys on a version 1 catalog", () => {
  // CommitAtlas shipped host/external (PR #53) before the version bump, so a version-1 catalog
  // carrying them genuinely exists on CommitAtlas@main. Additive and unrendered: accepted.
  assert.equal(render(project(catalogV1(), { actions: disclosed(ACTIONS) })).readme, render(catalog()).readme);
});

test("fails closed for every unsupported catalog version", () => {
  for (const version of [0, 3, 1.5, -1, "2", "1", null, true, [2], { major: 2 }]) {
    rejects(catalog({ version }), /catalog\.version must be one of 1, 2/);
  }
  // A missing version field is a missing required key, never a silently-defaulted one.
  const { version, ...withoutVersion } = catalog();
  rejects(withoutVersion, /catalog\.version is required/);
});

test("rejects a catalog whose issue-count key belongs to the other version", () => {
  // The exact hazard the version bump exists to stop: a renamed key read back as undefined. Under
  // each version the other name is an unknown field, and its own name is required.
  const { openIssuesAndPullRequests, ...v2Entry } = catalog().projects[0];
  rejects(project(catalog(), { openIssues: 1, openIssuesAndPullRequests: undefined }), /unknown field openIssues/);
  rejects({ ...catalog(), projects: [v2Entry] }, /openIssuesAndPullRequests is required/);

  const { openIssues, ...v1Entry } = catalogV1().projects[0];
  rejects(project(catalogV1(), { openIssuesAndPullRequests: 1, openIssues: undefined }), /unknown field openIssuesAndPullRequests/);
  rejects({ ...catalogV1(), projects: [v1Entry] }, /openIssues is required/);
});

test("requires host and external on every version 2 action", () => {
  for (const dropped of ["host", "external"]) {
    const actions = disclosed(ACTIONS).map((action) => {
      const { [dropped]: removed, ...rest } = action;
      return rest;
    });
    rejects(project(catalog(), { actions }), new RegExp(`actions\\[0\\]\\.${dropped} is required`));
  }
});

test("rejects an action host that disagrees with its own URL", () => {
  const website = (overrides) => disclosed(ACTIONS).map((action) => action.kind === "website" ? { ...action, ...overrides } : action);
  // Both versions, deliberately. Tolerating these keys under v1 must not mean skipping their value
  // checks: v1-with-disclosure is exactly the shape the next pin bump is most likely to produce, so
  // a change that made these checks version-2-only has to break a test.
  for (const base of [catalog(), catalogV1()]) {
    rejects(project(base, { actions: website({ host: "github.com" }) }), /host must match the hostname of its own action URL/);
    rejects(project(base, { actions: website({ host: "Chris0Jeky.GitHub.io" }) }), /host must be a lowercase hostname/);
    rejects(project(base, { actions: website({ external: "true" }) }), /external must be a boolean/);
  }
});

test("fails closed for missing, duplicate, and reversed markers", () => {
  for (const readme of ["no markers", `${START}\n${START}\n${END}`, `${END}\n${START}`]) {
    const paths = fixture(readme);
    assert.throws(() => updateProjectCatalog(paths.readmePath, paths.catalogPath), /marker/);
  }
});

test("rejects unknown schema fields and unsafe URLs", () => {
  rejects(catalog({ unexpected: true }), /unknown field/);
  rejects(project(catalog(), { extra: true }), /unknown field/);
  const unsafe = (url) => project(catalog(), { actions: [{ ...disclosed(ACTIONS)[0], url }] });
  rejects(unsafe("http://example.test/source"), /safe HTTPS/);
  rejects(unsafe("https://user:pass@example.test/source"), /credentials/);
});

test("escapes table cells while retaining action destinations", () => {
  const value = project(catalog(), {
    label: "A | B",
    actions: disclosed(ACTIONS).map((action) => action.kind === "docs" ? { ...action, label: "Docs | guide" } : action),
  });
  const rendered = render(value).readme;
  assert.match(rendered, /\[A \\| B\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha\)/);
  assert.match(rendered, /\[Docs \\| guide\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha#readme\)/);
});
