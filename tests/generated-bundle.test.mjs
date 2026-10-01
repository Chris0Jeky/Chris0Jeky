import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('paired generated bundles match configured public scope and every manifest digest', async () => {
  const config = await json('.commitatlas.json');
  const scope = config.projects.map(project => project.repo.toLowerCase()).sort();
  const manifests = [];
  for (const dir of ['assets/commitatlas/', 'assets/commitatlas/light/']) {
    const catalog = await json(`${dir}projects.json`);
    assert.deepEqual(catalog.projects.map(project => project.repo.toLowerCase()).sort(), scope);
    const manifest = await json(`${dir}manifest.json`);
    assert.equal(manifest.user, config.user);
    assert.equal(manifest.artifacts.length, 13);
    assert.equal(new Set(manifest.artifacts.map(item => item.path)).size, 13);
    for (const artifact of manifest.artifacts) {
      assert.match(artifact.path, /^[a-z0-9-]+\.(?:svg|json|md)$/);
      const bytes = await readFile(new URL(`${dir}${artifact.path}`, root));
      assert.equal(bytes.length, artifact.bytes, artifact.path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256, artifact.path);
    }
    manifests.push(manifest);
  }
  assert.equal(manifests[0].generatedAt, manifests[1].generatedAt);
  assert.deepEqual(manifests[0].window, manifests[1].window);
});
