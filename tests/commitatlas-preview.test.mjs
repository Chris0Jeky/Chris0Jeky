import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const previewPath = new URL("../.github/workflows/commitatlas-preview.yml", import.meta.url);
const refreshPath = new URL("../.github/workflows/commitatlas.yml", import.meta.url);

function step(source, name) {
  const start = source.indexOf("      - name: " + name + "\n");
  assert.notEqual(start, -1, "missing step: " + name);
  const end = source.indexOf("\n      - ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("PR preview uses only read permission and checks out the exact uncredentialed head", async () => {
  const preview = await readFile(previewPath, "utf8");
  assert.match(preview, /^on:\n  pull_request:\n    paths:/m);
  for (const relative of [".commitatlas.json", ".github/workflows/commitatlas.yml",
    ".github/workflows/commitatlas-preview.yml", "scripts/validate-commitatlas-bundle.mjs",
    "scripts/update-project-catalog.mjs", "scripts/update-commitatlas-image-versions.mjs", "README.md", "assets/commitatlas/**"]) {
    assert.ok(preview.includes("      - " + relative + "\n"), "missing preview path: " + relative);
  }
  const permissions = preview.match(/^permissions:\n((?:  .+\n)+)/m)?.[1];
  assert.equal(permissions, "  contents: read\n");
  assert.equal((preview.match(/^\s*permissions:/gm) ?? []).length, 1);
  assert.doesNotMatch(preview, /pull_request_target|workflow_run|workflow_dispatch|secrets\.|github\.token|github-token:|GH_TOKEN|GITHUB_TOKEN|git (?:push|commit|config)/);
  const checkout = step(preview, "Check out exact pull request head");
  assert.match(checkout, /uses: actions\/checkout@[a-f0-9]{40}\n/);
  assert.match(checkout, /repository: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/);
  assert.match(checkout, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(checkout, /persist-credentials: false/);
  const generate = step(preview, "Generate public CommitAtlas assets");
  assert.match(generate, /uses: Chris0Jeky\/CommitAtlas@[a-f0-9]{40}\n/);
  assert.match(generate, /with:\n          config: \.commitatlas\.json\s*$/);
});

test("preview uploads a verified ZIP containing only the profile README and assets", async () => {
  const preview = await readFile(previewPath, "utf8");
  const names = ["Generate public CommitAtlas assets", "Validate complete paired bundle",
    "Update generated selected work catalog", "Version generated CommitAtlas image URLs", "Upload verified profile preview"];
  const positions = names.map((name) => {
    step(preview, name);
    return preview.indexOf("      - name: " + name);
  });
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  const validate = step(preview, names[1]);
  assert.match(validate, /env:\n          COMMITATLAS_OUTPUTS_JSON: \$\{\{ toJSON\(steps\.commitatlas\.outputs\) \}\}/);
  assert.match(validate, /run: node scripts\/validate-commitatlas-bundle\.mjs\s*$/);
  const catalog = step(preview, names[2]);
  assert.match(catalog, /run: node scripts\/update-project-catalog\.mjs README\.md assets\/commitatlas\/projects\.json/);
  const versions = step(preview, names[3]);
  assert.match(versions, /run: node scripts\/update-commitatlas-image-versions\.mjs\s*$/);
  const upload = step(preview, names[4]);
  assert.match(upload, /uses: actions\/upload-artifact@[a-f0-9]{40}\n/);
  assert.match(upload, /name: commitatlas-profile-preview-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(upload, /path: \|\n            README\.md\n            assets\/commitatlas\n/);
  assert.match(upload, /archive: true/);
  assert.match(upload, /include-hidden-files: false/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 14/);
  assert.doesNotMatch(upload, /\n\s+if:|always\(\)|continue-on-error/);
  assert.doesNotMatch(preview, /continue-on-error/);
});

test("shared validation runs before the only write-capable workflow publishes", async () => {
  const refresh = await readFile(refreshPath, "utf8");
  assert.match(refresh, /^permissions:\n  contents: write$/m);
  assert.match(refresh, /push:\n    branches: \[main\]/);
  assert.doesNotMatch(refresh, /pull_request/);
  const validate = step(refresh, "Validate complete paired bundle");
  const catalog = step(refresh, "Update generated selected work catalog");
  const versions = step(refresh, "Version generated CommitAtlas image URLs");
  const commit = step(refresh, "Commit refreshed public assets");
  assert.ok(refresh.indexOf(validate) < refresh.indexOf(catalog));
  assert.ok(refresh.indexOf(catalog) < refresh.indexOf(versions));
  assert.ok(refresh.indexOf(versions) < refresh.indexOf(commit));
  assert.match(validate, /COMMITATLAS_OUTPUTS_JSON: \$\{\{ toJSON\(steps\.commitatlas\.outputs\) \}\}/);
  assert.match(validate, /run: node scripts\/validate-commitatlas-bundle\.mjs/);
  assert.match(versions, /run: node scripts\/update-commitatlas-image-versions\.mjs\s*$/);
  assert.match(commit, /git add -- README\.md assets\/commitatlas/);
  assert.match(commit, /git push origin HEAD:main/);
});
