import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const EXPECTED_ARTIFACTS = [
  "activity-still.svg", "activity.svg", "atlas-compact-still.svg", "atlas-compact.svg",
  "atlas-still.svg", "atlas.svg", "breakdown.svg", "cadence.svg", "languages.svg",
  "profile.svg", "projects.json", "projects.md", "projects.svg", "releases.svg",
  "rhythm.svg", "streak.svg",
];
const EXPECTED_OUTPUTS = {
  manifest: "manifest.json", atlas: "atlas.svg", "atlas-compact": "atlas-compact.svg",
  profile: "profile.svg", streak: "streak.svg", activity: "activity.svg",
  breakdown: "breakdown.svg", rhythm: "rhythm.svg", languages: "languages.svg",
  projects: "projects.svg", cadence: "cadence.svg", releases: "releases.svg",
  "projects-json": "projects.json", "projects-markdown": "projects.md",
};
const PRIMARY = "assets/commitatlas";
const LIGHT = PRIMARY + "/light";
const MAX_ARTIFACT_BYTES = 128 * 1024;

/** Validate the complete upload/commit inventory without modifying any file. */
export function validateCommitAtlasBundle(root, outputs) {
  if (!isRecord(outputs)) throw new Error("Action outputs must be an object");
  for (const [name, target] of Object.entries(EXPECTED_OUTPUTS)) {
    if (outputs[name] !== PRIMARY + "/" + target) throw new Error("Unexpected Action output " + name);
  }
  readRegular(root, "README.md", 1_000_000);
  assertDirectory(root, "assets");
  assertDirectory(root, PRIMARY, [...EXPECTED_ARTIFACTS, "manifest.json", "light"]);
  assertDirectory(root, LIGHT, [...EXPECTED_ARTIFACTS, "manifest.json"]);
  const primary = readManifest(root, PRIMARY);
  const light = readManifest(root, LIGHT);
  if (light.generatedAt !== primary.generatedAt || JSON.stringify(light.window) !== JSON.stringify(primary.window)) {
    throw new Error("CommitAtlas theme manifests do not describe one atomic snapshot");
  }
  for (const [directory, manifest] of [[PRIMARY, primary], [LIGHT, light]]) {
    for (const artifact of manifest.artifacts) {
      const body = readRegular(root, directory + "/" + artifact.path, MAX_ARTIFACT_BYTES);
      const digest = crypto.createHash("sha256").update(body).digest("hex");
      if (body.length !== artifact.bytes || digest !== artifact.sha256) {
        throw new Error("Manifest mismatch for " + directory + "/" + artifact.path);
      }
    }
  }
  return primary;
}

function readManifest(root, directory) {
  const relative = directory + "/manifest.json";
  const manifest = JSON.parse(readRegular(root, relative, 64 * 1024).toString("utf8"));
  if (!isRecord(manifest) || manifest.version !== 1 || manifest.generator !== "CommitAtlas"
      || manifest.user !== "Chris0Jeky" || manifest.source !== "github-public-profile") {
    throw new Error("Unexpected CommitAtlas manifest identity in " + relative);
  }
  if (typeof manifest.generatedAt !== "string" || !Number.isFinite(Date.parse(manifest.generatedAt))
      || new Date(manifest.generatedAt).toISOString() !== manifest.generatedAt) {
    throw new Error("Manifest generatedAt must be a canonical ISO timestamp");
  }
  const window = manifest.window;
  if (!isRecord(window) || !isUtcDate(window.from) || !isUtcDate(window.to)
      || !Number.isSafeInteger(window.days) || window.days < 1 || window.days > 731
      || (Date.parse(window.to) - Date.parse(window.from)) / 86_400_000 + 1 !== window.days
      || window.to !== manifest.generatedAt.slice(0, 10)) {
    throw new Error("Manifest window dates and length must match its generation day");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== EXPECTED_ARTIFACTS.length
      || manifest.artifacts.some((artifact) => !isRecord(artifact)
        || typeof artifact.path !== "string" || !Number.isSafeInteger(artifact.bytes)
        || artifact.bytes <= 0 || artifact.bytes > MAX_ARTIFACT_BYTES
        || typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256))) {
    throw new Error("Invalid artifact integrity fields in " + relative);
  }
  const names = manifest.artifacts.map((artifact) => artifact.path).sort();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED_ARTIFACTS)) {
    throw new Error("Unexpected CommitAtlas manifest artifact inventory in " + relative);
  }
  return manifest;
}

function assertDirectory(root, relative, expectedNames) {
  const directory = path.join(root, relative);
  if (!fs.lstatSync(directory).isDirectory()) {
    throw new Error(relative + " must be a real directory without links");
  }
  if (expectedNames) {
    const names = fs.readdirSync(directory).sort();
    const expected = [...expectedNames].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      const missing = expected.filter((name) => !names.includes(name));
      if (missing.length) {
        throw new Error("Missing artifact from " + relative + " inventory: " + missing.join(", "));
      }
      throw new Error("Unexpected file or directory in " + relative + " inventory");
    }
  }
}

function readRegular(root, relative, limit) {
  const target = path.join(root, relative);
  const info = fs.lstatSync(target);
  if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > limit) {
    throw new Error(relative + " must be a bounded nonempty regular file with one link");
  }
  return fs.readFileSync(target);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUtcDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputs = JSON.parse(process.env.COMMITATLAS_OUTPUTS_JSON ?? "");
    const manifest = validateCommitAtlasBundle(process.cwd(), outputs);
    console.log("Validated two CommitAtlas themes generated at " + manifest.generatedAt + ".");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "CommitAtlas bundle validation failed");
    process.exitCode = 1;
  }
}
