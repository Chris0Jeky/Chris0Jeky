import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const attributesPath = new URL("../.gitattributes", import.meta.url);
const configPath = new URL("../.commitatlas.json", import.meta.url);
const retiredLightConfigPath = new URL("../.commitatlas.light.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);
const workflowPath = new URL("../.github/workflows/commitatlas.yml", import.meta.url);

test("one pinned CommitAtlas invocation produces the dark and light bundles", async () => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(config.theme, "ember");
  assert.deepEqual(config.themes, [{ theme: "paper", outputDir: "assets/commitatlas/light" }]);
  assert.equal(config.outputDir, "assets/commitatlas");
  assert.equal((workflow.match(/uses: Chris0Jeky\/CommitAtlas@[0-9a-f]{40}/g) ?? []).length, 1);
  assert.match(workflow, /uses: Chris0Jeky\/CommitAtlas@51817aabdd5402dece1824eef47f0c6b3d87230c/);
  assert.match(workflow, /assets\/commitatlas\/light\/manifest\.json/);
  assert.match(workflow, /theme manifests do not describe one atomic snapshot/);
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
  assert.match(readme, /Daily committed snapshot/);
  assert.match(readme, /a failed refresh keeps the last good snapshot online/);
});
