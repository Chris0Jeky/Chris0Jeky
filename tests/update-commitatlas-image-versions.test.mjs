import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/update-commitatlas-image-versions.mjs", import.meta.url));
const darkHashes = {
  "atlas.svg": "0123456789abcdef" + "a".repeat(48),
  "atlas-still.svg": "123456789abcdef0" + "b".repeat(48),
  "atlas-compact-still.svg": "23456789abcdef01" + "c".repeat(48),
  "projects.json": "3456789abcdef012" + "d".repeat(48),
};
const lightHashes = {
  "atlas.svg": "456789abcdef0123" + "e".repeat(48),
  "atlas-still.svg": "56789abcdef01234" + "f".repeat(48),
  "atlas-compact-still.svg": "6789abcdef012345" + "0".repeat(48),
  "projects.json": "789abcdef0123456" + "1".repeat(48),
};

function manifest(hashes) {
  return {
    version: 1,
    generator: "CommitAtlas",
    user: "Chris0Jeky",
    source: "github-public-profile",
    window: { from: "2025-10-30", to: "2026-10-29", days: 365 },
    generatedAt: "2026-10-29T05:23:00.000Z",
    artifacts: Object.entries(hashes).map(([name, sha256]) => ({ path: name, bytes: 100, sha256 })),
  };
}

function fixture(t, readme) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commitatlas-image-versions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "assets/commitatlas/light"), { recursive: true });
  const readmePath = path.join(root, "README.md");
  const dark = path.join(root, "assets/commitatlas/manifest.json");
  const light = path.join(root, "assets/commitatlas/light/manifest.json");
  fs.writeFileSync(readmePath, readme);
  fs.writeFileSync(dark, JSON.stringify(manifest(darkHashes)));
  fs.writeFileSync(light, JSON.stringify(manifest(lightHashes)));
  return { root, readmePath, dark, light };
}

function run(root) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.ifError(result.error);
  return result;
}

function succeeds(paths) {
  const result = run(paths.root);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(paths.readmePath, "utf8");
}

function rejectsUnchanged(paths, message) {
  const before = fs.readFileSync(paths.readmePath);
  const result = run(paths.root);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, message);
  assert.deepEqual(fs.readFileSync(paths.readmePath), before, "invalid input must fail before any README write");
}

test("versions every owned HTML image reference using its own theme and artifact hash", (t) => {
  const before = [
    "# Snapshot · unchanged prose",
    '<img alt="Snapshot > example" src="./assets/commitatlas/atlas.svg" />',
    "<source srcset='./assets/commitatlas/light/atlas.svg 1x, ./assets/commitatlas/light/atlas-compact-still.svg 2x' />",
    '<a HREF = "./assets/commitatlas/atlas-still.svg?v=old-version#detail">Still version</a>',
    "<img SRC=./assets/commitatlas/atlas-compact-still.svg />",
    '<source srcset="  ./assets/commitatlas/atlas.svg 860w,\t./assets/commitatlas/light/atlas.svg 1720w  " />',
    '<img src="https://example.com/image.svg?v=unrelated" data-src="./assets/commitatlas/atlas.svg" />',
    '<img alt=\'Example src="./assets/commitatlas/atlas.svg"\' src="https://example.com/other.svg" />',
    '<a href="./assets/commitatlas/projects.json">Catalog</a>',
    '<a href="./assets/commitatlas/manifest.json">Manifest</a>',
    '<!-- <img src="./assets/commitatlas/atlas.svg" /> -->',
    "Plain ./assets/commitatlas/atlas.svg text remains unchanged.",
    "",
  ].join("\r\n");
  const expected = [
    "# Snapshot · unchanged prose",
    '<img alt="Snapshot > example" src="./assets/commitatlas/atlas.svg?v=0123456789abcdef" />',
    "<source srcset='./assets/commitatlas/light/atlas.svg?v=456789abcdef0123 1x, ./assets/commitatlas/light/atlas-compact-still.svg?v=6789abcdef012345 2x' />",
    '<a HREF = "./assets/commitatlas/atlas-still.svg?v=123456789abcdef0#detail">Still version</a>',
    "<img SRC=./assets/commitatlas/atlas-compact-still.svg?v=23456789abcdef01 />",
    '<source srcset="  ./assets/commitatlas/atlas.svg?v=0123456789abcdef 860w,\t./assets/commitatlas/light/atlas.svg?v=456789abcdef0123 1720w  " />',
    '<img src="https://example.com/image.svg?v=unrelated" data-src="./assets/commitatlas/atlas.svg" />',
    '<img alt=\'Example src="./assets/commitatlas/atlas.svg"\' src="https://example.com/other.svg" />',
    '<a href="./assets/commitatlas/projects.json">Catalog</a>',
    '<a href="./assets/commitatlas/manifest.json">Manifest</a>',
    '<!-- <img src="./assets/commitatlas/atlas.svg" /> -->',
    "Plain ./assets/commitatlas/atlas.svg text remains unchanged.",
    "",
  ].join("\r\n");
  const paths = fixture(t, before);
  const manifests = [fs.readFileSync(paths.dark), fs.readFileSync(paths.light)];
  assert.equal(succeeds(paths), expected);
  assert.equal(succeeds(paths), expected, "every supported attribute form must remain idempotent");
  assert.deepEqual([fs.readFileSync(paths.dark), fs.readFileSync(paths.light)], manifests);
});

test("rerunning is byte-idempotent without rewriting an already current README", (t) => {
  const paths = fixture(t, '<img src="./assets/commitatlas/atlas.svg?v=previous" />\n');
  const first = succeeds(paths);
  fs.utimesSync(paths.readmePath, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
  const stamp = fs.statSync(paths.readmePath).mtimeMs;
  assert.equal(succeeds(paths), first);
  assert.equal(fs.statSync(paths.readmePath).mtimeMs, stamp);
});

test("a changed artifact replaces only its existing version", (t) => {
  const paths = fixture(t, '<img src="./assets/commitatlas/atlas.svg" /><img src="./assets/commitatlas/light/atlas.svg" />');
  succeeds(paths);
  fs.writeFileSync(paths.dark, JSON.stringify(manifest({ ...darkHashes, "atlas.svg": "fedcba9876543210" + "a".repeat(48) })));
  assert.equal(succeeds(paths), '<img src="./assets/commitatlas/atlas.svg?v=fedcba9876543210" /><img src="./assets/commitatlas/light/atlas.svg?v=456789abcdef0123" />');
});

test("preserves unrelated srcset candidates including comma-containing data URLs", (t) => {
  const before = '<source srcset="data:image/png;base64,AAAA 1x, ./assets/commitatlas/light/atlas.svg?v=old 2x, https://example.com/x.svg?x=1&y=2 3x" />';
  const paths = fixture(t, before);
  assert.equal(succeeds(paths), '<source srcset="data:image/png;base64,AAAA 1x, ./assets/commitatlas/light/atlas.svg?v=456789abcdef0123 2x, https://example.com/x.svg?x=1&y=2 3x" />');
});

test("rejects unknown and noncanonical owned paths before changing any earlier reference", async (t) => {
  for (const url of [
    "./assets/commitatlas/missing.svg",
    "./assets/commitatlas/light/missing.svg",
    "./assets/commitatlas/../outside.svg",
    "./assets/commitatlas/light/../atlas.svg",
    "./assets/commitatlas/light/%2e%2e/atlas.svg",
    "./assets/commitatlas/%61tlas.svg",
    "./assets/commitatlas//atlas.svg",
    "./assets/commitatlas/light\\atlas.svg",
    "./assets/commitatlas/atlas.svg/extra",
  ]) {
    await t.test(url, (t) => {
      const paths = fixture(t, `<img src="./assets/commitatlas/atlas.svg" /><source srcset="https://example.com/safe.svg 1x, ${url} 2x" />`);
      rejectsUnchanged(paths, /unknown|canonical|path/i);
    });
  }
});

test("rejects ambiguous owned queries rather than discarding or merging them", async (t) => {
  for (const query of [
    "?v=one&v=two", "?v=one&amp;v=two", "?raw=true", "?v=old&raw=true",
    "?%76=old", "?v=%6fld", "?v=old?again", "?v=", "?", "?V=old",
  ]) {
    await t.test(query, (t) => {
      const paths = fixture(t, `<img src="./assets/commitatlas/atlas.svg" /><a href="./assets/commitatlas/light/atlas.svg${query}">View</a>`);
      rejectsUnchanged(paths, /query/i);
    });
  }
});

test("rejects ambiguous descriptors in an owned srcset", (t) => {
  const paths = fixture(t, '<source srcset="./assets/commitatlas/atlas.svg 1x 2x" />');
  rejectsUnchanged(paths, /srcset|descriptor/i);
});

test("validates both manifests completely even when only dark images are referenced", async (t) => {
  const mutations = [
    ["unsupported version", (value) => { value.version = 2; }, /version|manifest/i],
    ["wrong generator", (value) => { value.generator = "Other"; }, /generator|manifest/i],
    ["missing artifacts", (value) => { delete value.artifacts; }, /artifacts|manifest/i],
    ["duplicate path", (value) => { value.artifacts.push(value.artifacts[0]); }, /duplicate|path/i],
    ["traversal path", (value) => { value.artifacts[0].path = "../atlas.svg"; }, /path/i],
    ["encoded path", (value) => { value.artifacts[0].path = "%61tlas.svg"; }, /path/i],
    ["nested path", (value) => { value.artifacts[0].path = "light/atlas.svg"; }, /path/i],
    ["path with terminal newline", (value) => { value.artifacts[0].path = "atlas.svg\n"; }, /path/i],
    ["missing hash", (value) => { delete value.artifacts[0].sha256; }, /sha256|hash/i],
    ["short hash", (value) => { value.artifacts[0].sha256 = "0123456789abcdef"; }, /sha256|hash/i],
    ["uppercase hash", (value) => { value.artifacts[0].sha256 = "A".repeat(64); }, /sha256|hash/i],
    ["invalid hash", (value) => { value.artifacts[0].sha256 = "z".repeat(64); }, /sha256|hash/i],
    ["hash with terminal newline", (value) => { value.artifacts[0].sha256 = "a".repeat(64) + "\n"; }, /sha256|hash/i],
    ["non-SVG invalid hash", (value) => { value.artifacts.at(-1).sha256 = null; }, /sha256|hash/i],
  ];
  for (const [name, change, message] of mutations) {
    await t.test(name, (t) => {
      const paths = fixture(t, '<img src="./assets/commitatlas/atlas.svg" />');
      const value = manifest(lightHashes);
      change(value);
      fs.writeFileSync(paths.light, JSON.stringify(value));
      rejectsUnchanged(paths, message);
    });
  }
});

test("a missing or malformed light manifest fails before the README changes", async (t) => {
  for (const mode of ["missing", "malformed"]) {
    await t.test(mode, (t) => {
      const paths = fixture(t, '<img src="./assets/commitatlas/atlas.svg" />');
      if (mode === "missing") fs.unlinkSync(paths.light);
      else fs.writeFileSync(paths.light, "{broken JSON");
      rejectsUnchanged(paths, /manifest|JSON/i);
    });
  }
});

test("refuses a linked README so image versioning cannot write through another path", async (t) => {
  for (const kind of ["symlink", "hardlink"]) {
    await t.test(kind, (t) => {
      const paths = fixture(t, '<img src="./assets/commitatlas/atlas.svg" />');
      const target = path.join(paths.root, "kept.md");
      fs.renameSync(paths.readmePath, target);
      if (kind === "symlink") fs.symlinkSync(target, paths.readmePath);
      else fs.linkSync(target, paths.readmePath);
      rejectsUnchanged(paths, /regular|link/i);
    });
  }
});
