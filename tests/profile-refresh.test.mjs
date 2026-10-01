import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public refresh excludes private-source Taskdeck without hiding its authored summary', async () => {
  const config = JSON.parse(await read('.commitatlas.json'));
  const readme = await read('README.md');
  assert.equal(config.projects.some(project => project.repo === 'Chris0Jeky/Taskdeck'), false);
  assert.equal(config.projects.length, 5);
  assert.match(readme, /#### Taskdeck/);
  assert.match(readme, /Implementation source remains private/);
  assert.match(readme, /Public summaries are maintained separately/);
  assert.doesNotMatch(readme, /public beta; stable v0\.2\.0/);
});

test('refresh uses the verified engine pin without private repository credentials', async () => {
  const workflow = await read('.github/workflows/commitatlas.yml');
  assert.match(workflow, /Chris0Jeky\/CommitAtlas@c68cf08ee55e029d9da28a7c022515e8261bef24/);
  assert.doesNotMatch(workflow, /github-token:|secrets\./);
});

test('profile copy reflects observed Alibi release and current public catalog scope', async () => {
  const readme = await read('README.md');
  assert.match(readme, /browser\/PWA release 0\.15\.0/);
  assert.match(readme, /510 puzzles/);
  assert.doesNotMatch(readme, /0\.11\.3|355 puzzles|will move it to the current six flagships/);
  assert.match(readme, /five public repositories/);
});

test('manual refresh publishes only back to the selected branch', async () => {
  const workflow = await read('.github/workflows/commitatlas.yml');
  assert.doesNotMatch(workflow, /git push origin HEAD:main/);
  assert.match(workflow, /git push origin "HEAD:\$\{GITHUB_REF_NAME\}"/);
});

test('PR validation generates public preview artifacts without publishing to main', async () => {
  const workflow = await read('.github/workflows/tests.yml');
  assert.match(workflow, /public-refresh-preview:/);
  assert.match(workflow, /Chris0Jeky\/CommitAtlas@c68cf08ee55e029d9da28a7c022515e8261bef24/);
  assert.match(workflow, /name: profile-refresh-preview/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /git push|github-token:|secrets\./);
});
