import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const attributesPath = new URL("../.gitattributes", import.meta.url);
const configPath = new URL("../.commitatlas.json", import.meta.url);
const retiredLightConfigPath = new URL("../.commitatlas.light.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);
const workflowPath = new URL("../.github/workflows/commitatlas.yml", import.meta.url);
const previewPath = new URL("../.github/workflows/commitatlas-preview.yml", import.meta.url);

async function manifests() {
  return Promise.all(["../assets/commitatlas/manifest.json", "../assets/commitatlas/light/manifest.json"]
    .map(async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"))));
}

function ownedImagePath(url, themes) {
  const match = /^(\.\/assets\/commitatlas\/(light\/)?([a-z0-9][a-z0-9.-]*\.svg))(?:\?v=([a-f0-9]{16}))?(?:#[^\s"'<>]*)?$/.exec(url);
  assert.ok(match, "owned SVG URL must have a canonical path and at most one hash version: " + url);
  const artifact = themes[match[2] ? 1 : 0].artifacts.find((entry) => entry.path === match[3]);
  assert.ok(artifact, "owned SVG URL must name a manifest artifact: " + url);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  if (match[4]) assert.equal(match[4], artifact.sha256.slice(0, 16), "image version must match its own theme's artifact");
  return match[1];
}

test("one pinned CommitAtlas invocation produces the dark and light bundles", async () => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const workflow = await readFile(workflowPath, "utf8");
  const preview = await readFile(previewPath, "utf8");

  assert.equal(config.theme, "ember");
  assert.deepEqual(config.themes, [{ theme: "paper", outputDir: "assets/commitatlas/light" }]);
  assert.equal(config.outputDir, "assets/commitatlas");
  assert.equal((workflow.match(/uses: Chris0Jeky\/CommitAtlas@[0-9a-f]{40}/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /uses: Chris0Jeky\/CommitAtlas@5cb95cd7b185df85ba948c14e1f505b880c98926/);
  const pin = workflow.match(/uses: Chris0Jeky\/CommitAtlas@([0-9a-f]{40})/)?.[1];
  const previewPins = [...preview.matchAll(/uses: Chris0Jeky\/CommitAtlas@([0-9a-f]{40})/g)];
  assert.equal(previewPins.length, 1);
  assert.equal(previewPins[0][1], pin, "preview and refresh must use the same immutable producer");
  for (const source of [workflow, preview]) {
    assert.match(source, /run: node scripts\/validate-commitatlas-bundle\.mjs/);
    assert.match(source, /COMMITATLAS_OUTPUTS_JSON: \$\{\{ toJSON\(steps\.commitatlas\.outputs\) \}\}/);
  }
  await assert.rejects(readFile(retiredLightConfigPath, "utf8"), { code: "ENOENT" });
});

test("generated artifacts preserve manifest bytes across checkouts", async () => {
  const attributes = await readFile(attributesPath, "utf8");
  assert.match(attributes, /^assets\/commitatlas\/\*\* text eol=lf$/m);

  for (const path of [
    "assets/commitatlas/atlas.svg",
    "assets/commitatlas/projects.json",
    "assets/commitatlas/projects.md",
    "assets/commitatlas/light/atlas.svg",
    "assets/commitatlas/light/projects.json",
    "assets/commitatlas/light/projects.md",
  ]) {
    const output = execFileSync("git", ["check-attr", "eol", "--", path], {
      encoding: "utf8",
    });
    assert.match(output, /: eol: lf\s*$/);
  }
});

test("operating picture states the public-profile boundary and refresh fallback", async () => {
  const readme = await readFile(readmePath, "utf8");

  assert.match(readme, /GitHub's logged-out public profile view/);
  assert.match(readme, /signed-in owner's contribution calendar can differ because it may include private activity/);
  assert.match(readme, /Twelve-hourly committed snapshot/);
  assert.match(readme, /a failed refresh keeps the last good snapshot online/);
});

test("scheduled refresh runs twelve-hourly even when no public push event is present", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, /cron: "23 5,17 \* \* \*"/);
  assert.doesNotMatch(workflow, /has_commits|events\/public|steps\.activity/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /paths:\n\s+- \.commitatlas\.json\n\s+- \.github\/workflows\/commitatlas\.yml/);
  assert.ok(workflow.includes("      - scripts/update-commitatlas-image-versions.mjs\n"), "merging the updater must trigger a refresh");
});

test("ambient density cards have reduced-motion sources before animated sources", async () => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const readme = await readFile(readmePath, "utf8");
  assert.equal(config.days, "auto", "streak history must not be truncated with the calendar");
  assert.equal(config.motion, "ambient");
  assert.equal(config.reducedMotion, true);
  const picture = readme.match(/<picture>[\s\S]*?<\/picture>/)?.[0] ?? "";
  const sources = [...picture.matchAll(/<source media="([^"]+)" srcset="([^"]+)"/g)];
  const themes = await manifests();
  assert.equal(sources.filter((match) => match[1].includes("prefers-reduced-motion")).length, 4);
  assert.ok(sources.slice(0, 4).every((match) => match[1].includes("prefers-reduced-motion") && ownedImagePath(match[2], themes).endsWith("-still.svg")));
  assert.match(readme, /latest 365 observed days/);
});

test("owned README image versions, when present, match their exact manifest artifacts", async () => {
  const readme = await readFile(readmePath, "utf8");
  const themes = await manifests();
  const images = [...readme.matchAll(/\b(?:src|srcset|href)="(\.\/assets\/commitatlas\/[^\"]+\.svg[^\"]*)"/g)];
  assert.ok(images.length > 0);
  for (const match of images) ownedImagePath(match[1], themes);
});

