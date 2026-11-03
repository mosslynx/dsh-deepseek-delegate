import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { childEnvironment, resolveLauncher } from '../src/harness.mjs';

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

test('resolves unpacked DSH Desktop resources/app layout', t => {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-'));
  t.after(() => fs.rmSync(install, { recursive: true, force: true }));
  const executable = path.join(install, 'DSH Desktop.exe');
  const entry = path.join(install, 'resources', 'app', 'lib', 'desktop-cli.js');
  touch(executable); touch(entry);
  assert.deepEqual(resolveLauncher(executable), {
    command: executable,
    prefix: ['--expose-internals', entry],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    detected: executable,
  });
});

test('keeps resolving legacy DeepSeek Harness app.asar layout', t => {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-harness-'));
  t.after(() => fs.rmSync(install, { recursive: true, force: true }));
  const executable = path.join(install, 'DeepSeek Harness.exe');
  const archive = path.join(install, 'resources', 'app.asar');
  touch(executable); touch(archive);
  assert.deepEqual(resolveLauncher(executable), {
    command: executable,
    prefix: ['--expose-internals', path.join(archive, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    detected: executable,
  });
});

test('resolves the official dsh.cmd relative to its install root, not the bin directory', t => {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cmd-'));
  t.after(() => fs.rmSync(install, { recursive: true, force: true }));
  const cmd = path.join(install, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
  const executable = path.join(install, 'DSH Desktop.exe');
  const archive = path.join(install, 'resources', 'app.asar');
  touch(cmd); touch(executable); touch(archive);
  const launcher = resolveLauncher(cmd);
  assert.equal(launcher.command, executable);
  assert.deepEqual(launcher.prefix, ['--expose-internals', path.join(archive, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')]);
  assert.equal(launcher.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(launcher.detected, cmd);
});

test('removes the desktop Host proxy dispatcher flag but preserves proxy endpoints', () => {
  const env = childEnvironment({ env: { ELECTRON_RUN_AS_NODE: '1' } }, 'workspace-write', {
    NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://127.0.0.1:7897',
    HTTPS_PROXY: 'http://127.0.0.1:7897', ALL_PROXY: 'http://127.0.0.1:7897',
    NO_PROXY: 'localhost,127.0.0.1', KEEP_ME: 'yes',
  });
  assert.equal(env.NODE_USE_ENV_PROXY, undefined);
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.ALL_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1');
  assert.equal(env.KEEP_ME, 'yes');
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(env.DSH_PERMISSION_MODE, 'workspace-write');
});
