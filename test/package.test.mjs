import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrationConfig } from '../src/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('plugin entries point at bundled, dependency-free host and MCP builds', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.main, './lib/plugin.js');
  assert.equal(pkg.exports['.'], './lib/plugin.js');
  for (const file of ['lib/plugin.js', 'lib/cli.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, /from\s+['"]yaml['"]/, `${file} must inline yaml so linked installs work without node_modules`);
  }
});

test('MCP integration config prefers the bundled entry', () => {
  const { toml, json } = integrationConfig(path.join(ROOT, 'data-test'));
  assert.match(toml, /lib\/cli\.js/);
  assert.match(json, /lib\/cli\.js/);
});
