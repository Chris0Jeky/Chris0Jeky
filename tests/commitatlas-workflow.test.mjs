import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const attributesPath = new URL("../.gitattributes", import.meta.url);
const configPath = new URL("../.commitatlas.json", import.meta.url);
const darkDeliveryPath = new URL("../assets/commitatlas/delivery.json", import.meta.url);
const lightDeliveryPath = new URL("../assets/commitatlas/light/delivery.json", import.meta.url);
const retiredLightConfigPath = new URL("../.commitatlas.light.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);
const workflowPath = new URL("../.github/workflows/commitatlas.yml", import.meta.url);

test("one pinned CommitAtlas invocation produces the dark and light bundles", async () => {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const workflow = await readFile(workflowPath, "utf8");

  assert.equal(config.theme, "ember");
  assert.deepEqual(config.themes, [{ theme: "paper", outputDir: "assets/commitatlas/light" }]);
  assert.equal(config.outputDir, "assets/commitatlas");
  assert.equal(config.cards.filter((card) => card === "delivery").length, 1);
  assert.equal((workflow.match(/uses: Chris0Jeky\/CommitAtlas@[0-9a-f]{40}/g) ?? []).length, 1);
  assert.match(workflow, /uses: Chris0Jeky\/CommitAtlas@[0-9a-f]{40}/);
  assert.match(workflow, /github-token:\s+\$\{\{ github\.token \}\}/);
  assert.match(workflow, /assets\/commitatlas\/light\/manifest\.json/);
  assert.match(workflow, /theme manifests do not describe one atomic snapshot/);
  assert.match(workflow, /delivery\.json/);
  assert.match(workflow, /delivery evidence differs between themes/);
  assert.match(workflow, /git push origin HEAD:\$\{GITHUB_REF_NAME\}/);
  await assert.rejects(readFile(retiredLightConfigPath, "utf8"), { code: "ENOENT" });
});

test("generated artifacts preserve manifest bytes across checkouts", async () => {
  const attributes = await readFile(attributesPath, "utf8");
  assert.match(attributes, /^assets\/commitatlas\/\*\* text eol=lf$/m);

  for (const path of [
    "assets/commitatlas/atlas.svg",
    "assets/commitatlas/delivery.svg",
    "assets/commitatlas/delivery.json",
    "assets/commitatlas/projects.json",
    "assets/commitatlas/projects.md",
    "assets/commitatlas/light/atlas.svg",
    "assets/commitatlas/light/delivery.svg",
    "assets/commitatlas/light/delivery.json",
    "assets/commitatlas/light/projects.json",
    "assets/commitatlas/light/projects.md",
  ]) {
    const output = execFileSync("git", ["check-attr", "eol", "--", path], {
      encoding: "utf8",
    });
    assert.match(output, /: eol: lf\s*$/);
  }
});

test("delivery evidence is identical across themes and keeps its public scope inspectable", async () => {
  const darkText = await readFile(darkDeliveryPath, "utf8");
  const lightText = await readFile(lightDeliveryPath, "utf8");
  assert.equal(darkText, lightText);
  const evidence = JSON.parse(darkText);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.kind, "commitatlas-delivery-evidence");
  assert.equal(evidence.login, "Chris0Jeky");
  assert.equal(evidence.scope.kind, "configured-public-repositories");
  assert.deepEqual(evidence.scope.repositories, [
    "Chris0Jeky/Alibi",
    "Chris0Jeky/CommitAtlas",
    "Chris0Jeky/local-asset-studio",
    "Chris0Jeky/NavSentinel",
    "Chris0Jeky/Pulseboard",
    "Chris0Jeky/Taskdeck",
  ]);
  assert.equal(evidence.source.provider, "github-graphql");
  assert.equal(evidence.source.metric, "pull-request-search-counts");
  assert.equal(evidence.source.queryCount, 19);
  assert.equal(evidence.formulas.resolvedMergeConversion, "lifetime.merged / lifetime.closed");
  assert.equal(evidence.formulas.benchmarkMultiple7, "mergedPerWeek7 / benchmark.value");
  assert.equal(evidence.benchmark.id, "jellyfish-high-ai-adoption-2026-03");
  assert.equal(evidence.benchmark.value, 2.2);
  assert.match(evidence.benchmark.sourceUrl, /^https:\/\/jellyfish\.co\//);
  assert.match(evidence.benchmark.publishedAt, /^2026-03-17$/);
  assert.ok(evidence.benchmark.caveats.some((caveat) => /not.*percentile|percentile.*not/i.test(caveat)));
  assert.ok(evidence.limitations.some((limitation) => /not.*quality|quality.*not/i.test(limitation)));
});

test("operating picture states public boundaries, refresh fallback, and delivery non-claims", async () => {
  const readme = await readFile(readmePath, "utf8");

  assert.match(readme, /GitHub's logged-out public profile view/);
  assert.match(readme, /signed-in owner's contribution calendar can differ because it may include private activity/);
  assert.match(readme, /Daily committed snapshot/);
  assert.match(readme, /a failed refresh keeps the last good snapshot online/);
  assert.match(readme, /assets\/commitatlas\/delivery\.svg/);
  assert.match(readme, /assets\/commitatlas\/light\/delivery\.svg/);
  assert.match(readme, /assets\/commitatlas\/delivery\.json/);
  assert.match(readme, /six configured public repositories/i);
  assert.match(readme, /activity flow[^\n]*not quality[^\n]*impact/i);
});
