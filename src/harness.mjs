import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { parseRoute } from './config.mjs';
import { parseDocument } from 'yaml';

function exists(file) { try { return fs.statSync(file).isFile(); } catch { return false; } }
function desktopExecutable(install) {
  for (const name of ['DeepSeek Harness.exe', 'DSH Desktop.exe']) {
    const candidate = path.join(install, name);
    if (exists(candidate)) return candidate;
  }
  return '';
}
function desktopEntry(install) {
  const resources = path.join(install, 'resources');
  const appAsar = path.join(resources, 'app.asar');
  // ASAR children are virtual paths, so only the archive itself can be
  // checked with fs. Keep the historical entry first for older releases.
  if (fs.existsSync(appAsar)) {
    return path.join(appAsar, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js');
  }
  const app = path.join(resources, 'app');
  if (!fs.existsSync(app)) return '';
  for (const entry of [
    path.join(app, 'lib/desktop-cli.js'),
    path.join(app, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
    path.join(app, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),
    path.join(app, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
  ]) if (exists(entry)) return entry;
  return '';
}
function desktopLauncher(absolute, install) {
  // Callers already resolve the install root (the directory holding the .exe);
  // deriving it from dirname(absolute) again breaks dsh.cmd paths, which sit
  // four levels below the root.
  const command = desktopExecutable(install);
  const entry = desktopEntry(install);
  if (!command || !entry) return undefined;
  return { command, prefix: ['--expose-internals', entry], env: { ELECTRON_RUN_AS_NODE: '1' }, detected: absolute };
}
export function resolveLauncher(configured = '') {
  const candidates = configured ? [configured] : [
    process.env.DSH_EXECUTABLE,
    ...(/(?:DeepSeek Harness|DSH Desktop)\.exe$/i.test(process.execPath) ? [process.execPath] : []),
    'E:\\DeepSeekHarness\\resources\\runtime\\cli\\bin\\dsh.cmd',
    path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    ...(process.env.PATH || '').split(path.delimiter).flatMap(p => [path.join(p, 'dsh.cmd'), path.join(p, 'dsh')]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (!exists(absolute)) continue;
    let install;
    if (/(?:DeepSeek Harness|DSH Desktop)\.exe$/i.test(absolute)) install = path.dirname(absolute);
    if (/dsh\.cmd$/i.test(absolute)) install = path.resolve(path.dirname(absolute), '../../../..');
    if (install) {
      const launcher = desktopLauncher(absolute, install);
      if (launcher) return launcher;
    }
    if (/\.(cmd|bat)$/i.test(absolute)) throw new Error('请选择官方 dsh.cmd、DeepSeek Harness.exe 或 DSH Desktop.exe；不执行任意批处理包装器');
    return { command: absolute, prefix: [], env: {}, detected: absolute };
  }
  throw new Error('找不到 DeepSeek Harness CLI。请在设置中指定 dsh.cmd、DeepSeek Harness.exe 或 DSH Desktop.exe 的完整路径。');
}
export function buildOverlay(config) {
  const { provider, model } = parseRoute(config.modelRoute);
  return [
    ...providerPatches(config),
    ...(config.reuseSavedAuth ? [{ id: 'credentials', disabled: false }, { id: 'authorization', disabled: false }] : []),
    ...(config.reuseSavedAuth && provider === 'deepseek-account' ? [{ id: 'deepseek-account', disabled: false }] : []),
    { id: 'agent-default-model', config: {
      provider, model,
      ...(config.reasoningEffort === 'default' ? {} : { reasoningEffort: config.reasoningEffort }),
    } },
    // Unattended runs cannot answer interactive approval requests.
    // The sandbox still enforces the selected filesystem policy.
    { id: 'sandbox-policy', config: { mode: config.permissionMode, workspaceRoot: config.cwd } },
    { id: 'approval', config: { policy: 'never' } },
    { id: 'permission', config: { defaultPreset: config.permissionMode,
      presets: { [config.permissionMode]: { sandbox: config.permissionMode, approval: 'never' } } } },
  ];
}
export function providerPatches(config) {
  if (!config.reuseProviders) return [];
  if (!exists(config.providerConfigPath)) {
    if (!['deepseek-official', 'deepseek-account'].includes(parseRoute(config.modelRoute).provider))
      throw new Error('找不到桌面版供应商配置，请在设置中选择 cordis.patch.yml');
    return [];
  }
  const doc = parseDocument(fs.readFileSync(config.providerConfigPath, 'utf8'));
  if (doc.errors.length) throw new Error('桌面版供应商 YAML 配置无法解析');
  const entries = doc.toJS();
  if (!Array.isArray(entries)) throw new Error('供应商配置应为 Harness patch 数组');
  // Only import the provider adapter, never desktop UI plugins or default model/permissions.
  const adapter = entries.find(x => x?.id === 'llm-pi-ai');
  if (!adapter?.config?.providers) return [];
  return [{ id: 'llm-pi-ai', disabled: false, config: { providers: adapter.config.providers } }];
}
export function availableRoutes(config) {
  return providerPatches(config).flatMap(p => Object.entries(p.config.providers).flatMap(([provider, c]) =>
    (c.models || []).map(m => `${provider}/${m.id}`)));
}
export function childEnvironment(launcher, permissionMode, base = process.env) {
  const env = { ...base, ...launcher.env, DSH_PERMISSION_MODE: permissionMode };
  // The desktop Host installs NODE_USE_ENV_PROXY for its own Node runtime.
  // Passing it to the Electron CLI child makes undici install its env proxy
  // dispatcher too; on current DSH Desktop releases that dispatcher hangs the
  // headless OpenAI request. Keep HTTP(S)_PROXY/ALL_PROXY so the child still
  // uses the configured proxy, but let Electron's native networking handle it.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'NODE_USE_ENV_PROXY') delete env[key];
  }
  return env;
}
export function spawnHarness(config, overlayPath, sessionId) {
  const launcher = resolveLauncher(config.executable);
  const args = [...launcher.prefix, '--profile', 'headless', '--patch', overlayPath, '--json'];
  if (sessionId) args.push('--session-id', sessionId);
  args.push('-');
  return spawn(launcher.command, args, {
    cwd: config.cwd, windowsHide: true, shell: false,
    detached: process.platform !== 'win32',
    env: childEnvironment(launcher, config.permissionMode),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
export function stopTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}
