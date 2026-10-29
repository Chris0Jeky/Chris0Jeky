import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateCommitAtlasBundle } from "../scripts/validate-commitatlas-bundle.mjs";

// Independent producer contract: a missing still companion must never pass publication.
const ARTIFACTS = [
  "activity-still.svg", "activity.svg", "atlas-compact-still.svg", "atlas-compact.svg",
  "atlas-still.svg", "atlas.svg", "breakdown.svg", "cadence.svg", "languages.svg",
  "profile.svg", "projects.json", "projects.md", "projects.svg", "releases.svg",
  "rhythm.svg", "scene-activity-terrain.still.svg", "scene-activity-terrain.svg",
  "scene-evidence-coverage.still.svg", "scene-evidence-coverage.svg",
  "scene-identity-beacon.still.svg", "scene-identity-beacon.svg", "streak.svg",
];
const SCENES = ["activity-terrain", "evidence-coverage", "identity-beacon"];
const THEMES = ["assets/commitatlas", "assets/commitatlas/light"];
const OUTPUTS = {
  manifest: "assets/commitatlas/manifest.json",
  atlas: "assets/commitatlas/atlas.svg",
  "atlas-compact": "assets/commitatlas/atlas-compact.svg",
  "atlas-still": "assets/commitatlas/atlas-still.svg",
  "atlas-compact-still": "assets/commitatlas/atlas-compact-still.svg",
  "activity-still": "assets/commitatlas/activity-still.svg",
  "atlas-wide": "",
  "atlas-wide-still": "",
  profile: "assets/commitatlas/profile.svg",
  streak: "assets/commitatlas/streak.svg",
  activity: "assets/commitatlas/activity.svg",
  breakdown: "assets/commitatlas/breakdown.svg",
  rhythm: "assets/commitatlas/rhythm.svg",
  languages: "assets/commitatlas/languages.svg",
  projects: "assets/commitatlas/projects.svg",
  cadence: "assets/commitatlas/cadence.svg",
  releases: "assets/commitatlas/releases.svg",
  "projects-json": "assets/commitatlas/projects.json",
  "projects-markdown": "assets/commitatlas/projects.md",
  scenes: JSON.stringify(THEMES.flatMap((directory) => SCENES.map((id) => `${directory}/scene-${id}.svg`))),
  "scene-stills": JSON.stringify(THEMES.flatMap((directory) => SCENES.map((id) => `${directory}/scene-${id}.still.svg`))),
};
const script = fileURLToPath(new URL("../scripts/validate-commitatlas-bundle.mjs", import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commitatlas-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "before\n<!-- commitatlas:project-catalog:start -->\nold\n<!-- commitatlas:project-catalog:end -->\nafter\n");
  for (const directory of THEMES) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    const artifacts = ARTIFACTS.map((name) => {
      const body = Buffer.from("synthetic " + directory + "/" + name + "\n");
      fs.writeFileSync(path.join(root, directory, name), body);
      return { path: name, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
    });
    fs.writeFileSync(path.join(root, directory, "manifest.json"), JSON.stringify({
      version: 1, generator: "CommitAtlas", user: "Chris0Jeky", source: "github-public-profile",
      window: { from: "2024-10-30", to: "2026-10-29", days: 730 },
      generatedAt: "2026-10-29T05:23:00.000Z", artifacts,
    }));
  }
  return root;
}

function editManifest(root, directory, edit) {
  const target = path.join(root, directory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
  edit(manifest);
  fs.writeFileSync(target, JSON.stringify(manifest));
}

test("accepts the complete paired snapshot and all selected Action outputs without writing files", (t) => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const manifest = validateCommitAtlasBundle(root, OUTPUTS);
  assert.equal(manifest.artifacts.length, 22);
  assert.equal(manifest.window.to, "2026-10-29");
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), before);
});

test("rejects every missing reduced-motion companion in either theme", async (t) => {
  for (const directory of THEMES) {
    for (const name of ["activity-still.svg", "atlas-still.svg", "atlas-compact-still.svg", ...SCENES.map((id) => `scene-${id}.still.svg`)]) {
      await t.test(directory + "/" + name, (t) => {
        const root = fixture(t);
        fs.unlinkSync(path.join(root, directory, name));
        assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), new RegExp(name.replaceAll(".", "\\.")));
      });
    }
  }
});

test("rejects changed bytes even when file length is unchanged", (t) => {
  const root = fixture(t);
  const target = path.join(root, "assets/commitatlas/light/atlas-still.svg");
  const bytes = fs.readFileSync(target);
  bytes[0] ^= 1;
  fs.writeFileSync(target, bytes);
  assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /Manifest mismatch.*light\/atlas-still\.svg/);
});

test("rejects truncated output before publication", (t) => {
  const root = fixture(t);
  fs.truncateSync(path.join(root, "assets/commitatlas/atlas.svg"), 1);
  assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /Manifest mismatch.*atlas\.svg/);
});

test("rejects missing, duplicate, unexpected, and traversing manifest paths", async (t) => {
  for (const [label, edit] of [
    ["missing", (m) => m.artifacts.pop()],
    ["duplicate", (m) => { m.artifacts[0] = m.artifacts[1]; }],
    ["unexpected", (m) => { m.artifacts[0].path = "unexpected.svg"; }],
    ["traversal", (m) => { m.artifacts[0].path = "../README.md"; }],
  ]) {
    await t.test(label, (t) => {
      const root = fixture(t);
      editManifest(root, THEMES[1], edit);
      assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /manifest|artifact/i);
    });
  }
});

test("rejects altered manifest identity and malformed integrity fields", async (t) => {
  for (const [label, edit] of [
    ["version", (m) => { m.version = 2; }],
    ["generator", (m) => { m.generator = "other"; }],
    ["user", (m) => { m.user = "other"; }],
    ["source", (m) => { m.source = "other"; }],
    ["byte type", (m) => { m.artifacts[0].bytes = String(m.artifacts[0].bytes); }],
    ["byte limit", (m) => { m.artifacts[0].bytes = Number.MAX_SAFE_INTEGER; }],
    ["hash format", (m) => { m.artifacts[0].sha256 = "not-a-digest"; }],
  ]) {
    await t.test(label, (t) => {
      const root = fixture(t);
      editManifest(root, THEMES[0], edit);
      assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /manifest|artifact|identity|integrity/i);
    });
  }
});

test("rejects theme generation times or windows from different snapshots", async (t) => {
  for (const [label, edit] of [
    ["generation time", (m) => { m.generatedAt = "2026-10-29T05:24:00.000Z"; }],
    ["window", (m) => { m.window = { from: "2025-10-30", to: "2026-10-29", days: 365 }; }],
  ]) {
    await t.test(label, (t) => {
      const root = fixture(t);
      editManifest(root, THEMES[1], edit);
      assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /one atomic snapshot/);
    });
  }
});

test("rejects invalid dates and inconsistent window lengths even when both themes agree", async (t) => {
  for (const [label, edit] of [
    ["timestamp", (m) => { m.generatedAt = "not-a-date"; }],
    ["calendar date", (m) => { m.window.from = "2026-02-30"; }],
    ["reversed", (m) => { m.window.from = "2026-10-30"; }],
    ["length", (m) => { m.window.days = 729; }],
    ["fractional length", (m) => { m.window.days = 730.5; }],
    ["generation day", (m) => { m.generatedAt = "2026-10-28T05:23:00.000Z"; }],
  ]) {
    await t.test(label, (t) => {
      const root = fixture(t);
      for (const directory of THEMES) editManifest(root, directory, edit);
      assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /timestamp|date|window|generatedAt/i);
    });
  }
});

test("requires every selected Action output to name its expected repository-relative artifact", async (t) => {
  for (const name of Object.keys(OUTPUTS)) {
    await t.test(name, (t) => {
      const root = fixture(t);
      assert.throws(() => validateCommitAtlasBundle(root, { ...OUTPUTS, [name]: "../unexpected" }), /Action output/);
    });
  }
});

test("scene Action outputs are separate complete ordered arrays for both themes", async (t) => {
  for (const output of ["scenes", "scene-stills"]) {
    const expected = JSON.parse(OUTPUTS[output]);
    const other = output === "scenes" ? "scene-stills" : "scenes";
    for (const [label, value] of [
      ["missing", undefined], ["invalid JSON", "{"], ["wrong type", expected],
      ["not an array", "null"], ["ordinary and still swapped", OUTPUTS[other]],
      ["missing light theme", JSON.stringify(expected.slice(0, 3))],
      ["duplicate", JSON.stringify([...expected.slice(0, -1), expected[0]])],
      ["traversal", JSON.stringify(["../scene.svg", ...expected.slice(1)])],
      ["unselected scene", JSON.stringify([...expected, "assets/commitatlas/scene-signature.svg"])],
      ["reordered", JSON.stringify([...expected].reverse())],
    ]) {
      await t.test(output + ": " + label, (t) => {
        const root = fixture(t);
        const before = fs.readFileSync(path.join(root, "README.md"));
        assert.throws(() => validateCommitAtlasBundle(root, { ...OUTPUTS, [output]: value }), /Action output/);
        assert.deepEqual(fs.readFileSync(path.join(root, "README.md")), before);
      });
    }
  }
});

test("corrupt scene bytes in the later theme reject the whole bundle before README changes", (t) => {
  const root = fixture(t);
  const target = path.join(root, THEMES[1], "scene-evidence-coverage.still.svg");
  const before = fs.readFileSync(path.join(root, "README.md"));
  const bytes = fs.readFileSync(target);
  bytes[0] ^= 1;
  fs.writeFileSync(target, bytes);
  assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /Manifest mismatch.*light\/scene-evidence-coverage\.still\.svg/);
  assert.deepEqual(fs.readFileSync(path.join(root, "README.md")), before);
});

test("rejects unmanifested files and directories from the upload inventory", async (t) => {
  for (const [name, directory] of [
    ["extra.svg", THEMES[0]], [".unexpected", THEMES[1]], ["nested", THEMES[1]],
  ]) {
    await t.test(directory + "/" + name, (t) => {
      const root = fixture(t);
      const target = path.join(root, directory, name);
      if (name === "nested") fs.mkdirSync(target);
      else fs.writeFileSync(target, "unowned content");
      assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /inventory|unexpected/i);
    });
  }
});

test("rejects linked or nonregular artifacts and README files", async (t) => {
  for (const [label, relative, type] of [
    ["artifact symlink", "assets/commitatlas/atlas-still.svg", "symlink"],
    ["artifact hardlink", "assets/commitatlas/light/atlas-still.svg", "hardlink"],
    ["artifact directory", "assets/commitatlas/atlas.svg", "directory"],
    ["README symlink", "README.md", "symlink"],
  ]) {
    await t.test(label, (t) => {
      const root = fixture(t);
      const target = path.join(root, relative);
      const external = path.join(root, "replacement");
      fs.renameSync(target, external);
      if (type === "symlink") fs.symlinkSync(external, target);
      else if (type === "hardlink") fs.linkSync(external, target);
      else fs.mkdirSync(target);
      assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /regular|link/i);
    });
  }
});

test("rejects symlinked output-directory ancestors", (t) => {
  const root = fixture(t);
  const assets = path.join(root, "assets");
  const replacement = path.join(root, "replacement");
  fs.renameSync(assets, replacement);
  fs.symlinkSync(replacement, assets, "dir");
  assert.throws(() => validateCommitAtlasBundle(root, OUTPUTS), /directory|link/i);
});

test("CLI consumes JSON from the environment and fails before writing on invalid input", (t) => {
  const root = fixture(t);
  const before = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const run = (outputs) => spawnSync(process.execPath, [script], {
    cwd: root, encoding: "utf8", env: { ...process.env, COMMITATLAS_OUTPUTS_JSON: outputs },
  });
  const success = run(JSON.stringify(OUTPUTS));
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /Validated two CommitAtlas themes/);
  for (const value of ["", "{", "null", JSON.stringify({ ...OUTPUTS, manifest: "../README.md" })]) {
    const failure = run(value);
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), before);
  }
});
