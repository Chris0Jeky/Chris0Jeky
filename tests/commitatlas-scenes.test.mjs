import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateCommitAtlasImageVersions } from "../scripts/update-commitatlas-image-versions.mjs";

const configPath = new URL("../.commitatlas.json", import.meta.url);
const readmePath = new URL("../README.md", import.meta.url);
const SCENES = ["identity-beacon", "evidence-coverage", "activity-terrain"];
const PREFIX = "./assets/commitatlas/";
const imagePath = (value) => value.split("?")[0];

function picture(readme, artifact) {
  const matches = [...readme.matchAll(/<picture>[\s\S]*?<\/picture>/g)]
    .filter(([markup]) => imagePath(markup.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1] ?? "") === PREFIX + artifact);
  assert.equal(matches.length, 1, "one picture must display " + artifact);
  return { markup: matches[0][0], index: matches[0].index };
}

function sources(markup) {
  return [...markup.matchAll(/<source media="([^"]+)" srcset="([^"]+)"/g)]
    .map(([, media, url]) => ({ media, path: imagePath(url) }));
}

test("profile adopts only the three public survey scenes using the existing identity and project labels", () => {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.deepEqual(config.scenes, SCENES);
  assert.equal(config.scenePack, "survey");
  assert.equal(config.layout, "wide", "the wide Beacon keeps the three project bodies in one row");
  assert.equal(config.responsiveAtlas, true, "mobile Atlas keeps the existing compact companion");
  assert.equal(config.motion, "ambient");
  assert.equal(config.reducedMotion, true);
  assert.equal(config.days, "auto");
  assert.deepEqual(config.identity, {
    name: "Cristian (Chris) Tcaci",
    tagline: "Backend & platform engineer · Local-first systems · Evidence-based automation",
    focus: ["Local Asset Studio", "NavSentinel", "Alibi"],
  });
  assert.ok(config.identity.name.length <= 40 && config.identity.tagline.length <= 80);
  assert.ok(config.identity.focus.every((label) => label.length <= 24 && config.projects.filter((project) => project.label === label).length === 1));
  assert.equal(config.lens, undefined, "public profile scenes must not enable Lens publication");
  assert.equal(config.theme, "ember");
  assert.deepEqual(config.themes, [{ theme: "paper", outputDir: "assets/commitatlas/light" }]);
});

test("scene pictures select their own dark/light still twins before ambient images at reviewed display widths", () => {
  const readme = fs.readFileSync(readmePath, "utf8");
  for (const id of SCENES) {
    const { markup } = picture(readme, `scene-${id}.svg`);
    assert.deepEqual(sources(markup), [
      { media: "(prefers-reduced-motion: reduce) and (prefers-color-scheme: light)", path: `${PREFIX}light/scene-${id}.still.svg` },
      { media: "(prefers-reduced-motion: reduce)", path: `${PREFIX}scene-${id}.still.svg` },
      { media: "(prefers-color-scheme: light)", path: `${PREFIX}light/scene-${id}.svg` },
    ]);
    const width = id === "identity-beacon" ? 520 : 720;
    assert.match(markup, new RegExp(`<img width="${width}" alt="[^"]+" src=`), "the header must not expand to the full scene width");
  }
  assert.doesNotMatch(readme.slice(0, readme.indexOf("### Backend & platform engineer")), /capsule-render\.vercel\.app/);
});

test("beacon replaces the header, coverage follows Atlas, and terrain stays inside generated signals", () => {
  const readme = fs.readFileSync(readmePath, "utf8");
  const beacon = picture(readme, "scene-identity-beacon.svg");
  const atlas = picture(readme, "atlas.svg");
  const coverage = picture(readme, "scene-evidence-coverage.svg");
  const terrain = picture(readme, "scene-activity-terrain.svg");
  assert.ok(beacon.index < readme.indexOf("### Backend & platform engineer"));
  assert.ok(atlas.index < coverage.index && coverage.index < readme.indexOf("## What I build"));
  const details = readme.lastIndexOf("<details>", readme.indexOf("<summary><strong>Generated project radar and focused public signals"));
  assert.ok(details >= 0 && terrain.index > details && terrain.index < readme.indexOf("</details>", details));
  for (const heading of ["## What I build", "## Generated flagship snapshot", "## Experience and working principles"]) {
    assert.equal(readme.split(heading).length, 2, "preserve the existing written section " + heading);
  }
});

test("desktop Atlas stays wide while mobile and reduced-motion sources use the existing compact pair", () => {
  const { markup } = picture(fs.readFileSync(readmePath, "utf8"), "atlas.svg");
  assert.match(markup, /<img width="860"/);
  assert.deepEqual(sources(markup), [
    { media: "(prefers-reduced-motion: reduce) and (prefers-color-scheme: light) and (max-width: 600px)", path: PREFIX + "light/atlas-compact-still.svg" },
    { media: "(prefers-reduced-motion: reduce) and (max-width: 600px)", path: PREFIX + "atlas-compact-still.svg" },
    { media: "(prefers-reduced-motion: reduce) and (prefers-color-scheme: light)", path: PREFIX + "light/atlas-still.svg" },
    { media: "(prefers-reduced-motion: reduce)", path: PREFIX + "atlas-still.svg" },
    { media: "(prefers-color-scheme: light) and (max-width: 600px)", path: PREFIX + "light/atlas-compact.svg" },
    { media: "(max-width: 600px)", path: PREFIX + "atlas-compact.svg" },
    { media: "(prefers-color-scheme: light)", path: PREFIX + "light/atlas.svg" },
  ]);
});

test("the image updater fingerprints every adopted scene URL against its own theme and remains idempotent", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commitatlas-scene-versions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = fs.readFileSync(readmePath, "utf8");
  const versions = new Map();
  const references = [...before.matchAll(/\b(?:src|srcset|href)="(\.\/assets\/commitatlas\/[^"?#]+\.svg)(?:[?#][^"]*)?"/g)]
    .map(([, url]) => url);
  for (const directory of ["assets/commitatlas", "assets/commitatlas/light"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    const names = [...new Set(references.filter((url) => path.posix.dirname(url.slice(2)) === directory).map((url) => path.posix.basename(url)))];
    const artifacts = names.map((name) => {
      const body = `Synthetic fixture for ${directory}/${name}\n`;
      const sha256 = crypto.createHash("sha256").update(body).digest("hex");
      versions.set(`./${directory}/${name}`, sha256.slice(0, 16));
      return { path: name, bytes: Buffer.byteLength(body), sha256 };
    });
    fs.writeFileSync(path.join(root, directory, "manifest.json"), JSON.stringify({ version: 1, generator: "CommitAtlas", artifacts }));
  }
  fs.writeFileSync(path.join(root, "README.md"), before);
  assert.deepEqual(updateCommitAtlasImageVersions(root), { changed: true });
  const after = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const id of SCENES) {
    const urls = [...picture(after, `scene-${id}.svg`).markup.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map(([, url]) => url);
    assert.equal(urls.length, 4);
    for (const url of urls) assert.equal(url, `${imagePath(url)}?v=${versions.get(imagePath(url))}`);
  }
  const unversion = (value) => value.replace(/\?v=[a-f0-9]{16}(?=["#])/g, "");
  assert.equal(unversion(after), unversion(before), "fingerprinting must preserve every other README byte");
  assert.deepEqual(updateCommitAtlasImageVersions(root), { changed: false });
  assert.equal(fs.readFileSync(path.join(root, "README.md"), "utf8"), after);
});
