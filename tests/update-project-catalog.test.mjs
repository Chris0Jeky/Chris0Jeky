import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateProjectCatalog } from "../scripts/update-project-catalog.mjs";

const START = "<!-- commitatlas:project-catalog:start -->";
const END = "<!-- commitatlas:project-catalog:end -->";

function catalog(overrides = {}) {
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
        actions: [
          { kind: "source", label: "Source", url: "https://github.com/Chris0Jeky/Alpha", origin: "snapshot" },
          { kind: "ci", label: "CI", url: "https://github.com/Chris0Jeky/Alpha/actions/workflows/ci.yml", origin: "snapshot" },
          { kind: "docs", label: "Docs", url: "https://github.com/Chris0Jeky/Alpha#readme", origin: "config" },
        ],
      },
    ],
    ...overrides,
  };
}

function fixture(readme, value = catalog()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commitatlas-profile-"));
  const readmePath = path.join(directory, "README.md");
  const catalogPath = path.join(directory, "projects.json");
  fs.writeFileSync(readmePath, readme, "utf8");
  fs.writeFileSync(catalogPath, `${JSON.stringify(value)}\n`, "utf8");
  return { readmePath, catalogPath };
}

test("renders the ordered catalog and is idempotent", () => {
  const paths = fixture(`# Selected work\n\n${START}\nplaceholder\n${END}\n`);
  const first = updateProjectCatalog(paths.readmePath, paths.catalogPath);
  assert.equal(first.changed, true);
  const rendered = fs.readFileSync(paths.readmePath, "utf8");
  assert.match(rendered, /\| Project \| Status \| Signals\/actions \|/);
  assert.match(rendered, /\[Alpha\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha\)/);
  assert.match(rendered, /\[Docs\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha#readme\)/);
  assert.equal((rendered.match(new RegExp(START, "g")) ?? []).length, 1);
  assert.equal((rendered.match(new RegExp(END, "g")) ?? []).length, 1);
  const second = updateProjectCatalog(paths.readmePath, paths.catalogPath);
  assert.equal(second.changed, false);
  assert.equal(fs.readFileSync(paths.readmePath, "utf8"), rendered);
});

test("fails closed for missing, duplicate, and reversed markers", () => {
  for (const readme of ["no markers", `${START}\n${START}\n${END}`, `${END}\n${START}`]) {
    const paths = fixture(readme);
    assert.throws(() => updateProjectCatalog(paths.readmePath, paths.catalogPath), /marker/);
  }
});

test("rejects unsupported versions, unknown schema fields, and unsafe URLs", () => {
  const cases = [
    [catalog({ version: 2 }), /version/],
    [catalog({ unexpected: true }), /unknown field/],
    [catalog({ projects: [{ ...catalog().projects[0], extra: true }] }), /unknown field/],
    [catalog({ projects: [{ ...catalog().projects[0], actions: [{ ...catalog().projects[0].actions[0], url: "http://example.test/source" }] }] }), /safe HTTPS/],
    [catalog({ projects: [{ ...catalog().projects[0], actions: [{ ...catalog().projects[0].actions[0], url: "https://user:pass@example.test/source" }] }] }), /credentials/],
  ];
  for (const [value, message] of cases) {
    const paths = fixture(`${START}\n${END}\n`, value);
    assert.throws(() => updateProjectCatalog(paths.readmePath, paths.catalogPath), message);
  }
});

test("escapes table cells while retaining action destinations", () => {
  const base = catalog().projects[0];
  const value = catalog({ projects: [{
    ...base,
    label: "A | B",
    actions: base.actions.map((action) => action.kind === "docs" ? { ...action, label: "Docs | guide" } : action),
  }] });
  const paths = fixture(`${START}\n${END}\n`, value);
  updateProjectCatalog(paths.readmePath, paths.catalogPath);
  const rendered = fs.readFileSync(paths.readmePath, "utf8");
  assert.match(rendered, /\[A \\| B\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha\)/);
  assert.match(rendered, /\[Docs \\| guide\]\(https:\/\/github\.com\/Chris0Jeky\/Alpha#readme\)/);
});
