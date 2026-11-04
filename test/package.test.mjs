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

test('MCP integration config uses the current Node binary', () => {
  const { toml, json, source } = integrationConfig(path.join(ROOT, 'data-test'), {
    execPath: 'C:/Program Files/nodejs/node.exe', electron: false,
  });
  assert.equal(source, 'node');
  assert.match(toml, /command = "C:\/Program Files\/nodejs\/node\.exe"/);
  assert.doesNotMatch(toml, /ELECTRON_RUN_AS_NODE/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.mcpServers.deepseek_delegate.command, 'C:/Program Files/nodejs/node.exe');
  assert.equal(parsed.mcpServers.deepseek_delegate.env.ELECTRON_RUN_AS_NODE, undefined);
});

test('MCP integration config runs Electron as Node', () => {
  const { toml, json, source } = integrationConfig(path.join(ROOT, 'data-test'), {
    execPath: 'C:/DeepSeekHarness/DeepSeek Harness.exe', electron: true,
  });
  assert.equal(source, 'electron');
  assert.match(toml, /ELECTRON_RUN_AS_NODE = "1"/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.mcpServers.deepseek_delegate.command, 'C:/DeepSeekHarness/DeepSeek Harness.exe');
  assert.equal(parsed.mcpServers.deepseek_delegate.env.ELECTRON_RUN_AS_NODE, '1');
});

test('MCP integration config does not reuse an unrelated executable', () => {
  const { source } = integrationConfig(path.join(ROOT, 'data-test'), {
    execPath: 'C:/weird/app.exe', electron: false,
  });
  assert.ok(['path', 'missing'].includes(source));
});
