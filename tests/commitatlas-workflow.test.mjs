import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configPath = new URL("../.commitatlas.json", import.meta.url);
const retiredLightConfigPath = new URL("../.commitatlas.light.json", import.meta.url);
const workflowPath = new URL("../.github/workflows/commitatlas.yml", import.meta.url);

test("one pinned CommitAtlas invocation produces the dark and light bundles", async () => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(config.theme, "ember");
  assert.deepEqual(config.themes, [{ theme: "paper", outputDir: "assets/commitatlas/light" }]);
  assert.equal(config.outputDir, "assets/commitatlas");
  assert.equal((workflow.match(/uses: Chris0Jeky\/CommitAtlas@[0-9a-f]{40}/g) ?? []).length, 1);
  assert.match(workflow, /uses: Chris0Jeky\/CommitAtlas@af71fbf8d1e889c3cb25255d7a92114d5bb15eb5/);
  assert.match(workflow, /assets\/commitatlas\/light\/manifest\.json/);
  assert.match(workflow, /theme manifests do not describe one atomic snapshot/);
  await assert.rejects(readFile(retiredLightConfigPath, "utf8"), { code: "ENOENT" });
});
