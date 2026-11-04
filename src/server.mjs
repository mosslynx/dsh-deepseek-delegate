import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ROOT, VERSION, atomicJSON, redact } from './config.mjs';
import { TaskManager } from './tasks.mjs';
import { resolveLauncher, availableRoutes } from './harness.mjs';
import { callTool } from './protocol.mjs';

function nodeCommand() {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, executable);
    if (fs.existsSync(candidate)) return candidate.replaceAll('\\', '/');
  }
  return '';
}
function isNodeBinary(file) {
  return /(^|[\\/])node(?:\.exe)?$/i.test(file);
}
export function runtimeCommand({ execPath = process.execPath, electron = Boolean(process.versions.electron) } = {}) {
  if (electron) return { command: execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, source: 'electron' };
  if (isNodeBinary(execPath)) return { command: execPath, env: {}, source: 'node' };
  const found = nodeCommand();
  return found ? { command: found, env: {}, source: 'path' } : { command: 'node', env: {}, source: 'missing' };
}
export function integrationConfig(dir, options = {}) {
  const runtime = runtimeCommand(options);
  // Prefer the bundled MCP entry: a linked install (cloned or unzipped folder)
  // has no node_modules, so src/cli.mjs cannot resolve the yaml dependency.
  const bundled = path.join(ROOT, 'lib/cli.js');
  const entry = (fs.existsSync(bundled) ? bundled : path.join(ROOT, 'src/cli.mjs')).replaceAll('\\', '/');
  const env = { DEEPSEEK_MCP_DATA: dir.replaceAll('\\', '/'), ...runtime.env };
  const envToml = Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n');
  return {
    toml: `[mcp_servers.deepseek_delegate]\ncommand = ${JSON.stringify(runtime.command)}\nargs = [${JSON.stringify(entry)}, "mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n\n[mcp_servers.deepseek_delegate.env]\n${envToml}\n`,
    json: JSON.stringify({ mcpServers: { deepseek_delegate: { command: runtime.command, args: [entry, 'mcp'], env } } }, null, 2),
    source: runtime.source,
  };
}
function lockState(lock, { graceMs = 10000 } = {}) {
  if (!fs.existsSync(lock)) return 'free';
  let owner = null;
  try { owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')); }
  catch { owner = null; }
  if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
    try { process.kill(owner.pid, 0); return 'active'; }
    catch (e) { return e.code === 'EPERM' ? 'active' : 'stale'; }
  }
  let age = Infinity;
  try { age = Date.now() - fs.statSync(lock).mtimeMs; }
  catch { return 'free'; }
  return age > graceMs ? 'stale' : 'starting';
}
function safeEqual(a, b) {
  const ab = Buffer.from(a || ''); const bb = Buffer.from(b || '');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
function localOrigin(origin) {
  if (origin === 'dsh-app://app') return true; // Official Desktop application origin.
  if (origin === 'null') return true; // Harness Desktop's file:// renderer.
  try { const u = new URL(origin); return ['http:', 'https:'].includes(u.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname); }
  catch { return false; }
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 100000) throw new Error('请求过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
export async function startServer(dir, { port = 0, launch, lockGraceMs = 10000 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'server.lock');
  try { fs.mkdirSync(lock); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (lockState(lock, { graceMs: lockGraceMs }) !== 'stale') throw new Error('DeepSeek 委派插件已在运行或正在启动');
    fs.rmSync(lock, { recursive: true, force: true });
    try { fs.mkdirSync(lock); }
    catch (again) {
      if (again.code === 'EEXIST') throw new Error('DeepSeek 委派插件已在运行或正在启动');
      throw again;
    }
  }
  atomicJSON(path.join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  let manager;
  try { manager = new TaskManager(dir, { launch }); }
  catch (e) { fs.rmSync(lock, { recursive: true, force: true }); throw e; }
  const token = randomBytes(32).toString('hex');
  const startedAt = new Date().toISOString();
  let origin, closing;
  async function dispatch(method, pathname, data) {
    if (closing) throw new Error('插件正在关闭');
    const url = new URL(pathname, 'http://localhost');
    pathname = url.pathname;
    const pageOptions = () => {
      const options = {};
      for (const key of ['limit', 'offset']) if (url.searchParams.has(key)) {
        const value = url.searchParams.get(key);
        if (!/^\d+$/.test(value)) throw new Error(`分页参数无效：${key}`);
        options[key] = Number(value);
      }
      if (url.searchParams.has('status')) options.status = url.searchParams.get('status');
      return options;
    };
    const result = (value, status = 200) => ({ value, status });
    if (method === 'GET' && pathname === '/api/state') {
      let launcher, launcherError, routes = [], providerError;
      try { launcher = resolveLauncher(manager.config.executable).detected; } catch (e) { launcherError = e.message; }
      try { routes = availableRoutes(manager.config); } catch (e) { providerError = e.message; }
      const { tasks, ...taskPage } = manager.listPage(pageOptions());
      return result({ config: manager.settings(), tasks, taskPage, usage: manager.usageSummary(), launcher, launcherError, providerError, routes,
        version: VERSION, startedAt, pid: process.pid, dataDir: dir, integration: integrationConfig(dir) });
    }
    if (method === 'GET' && pathname === '/api/ping') return result({ ok: true, pid: process.pid });
    if (method === 'PUT' && pathname === '/api/config') return result(manager.settings(data));
    if (method === 'GET' && pathname === '/api/tasks') return result(manager.listPage(pageOptions()));
    if (method === 'POST' && pathname === '/api/tasks') return result(manager.delegate(data), 201);
    const taskMatch = typeof pathname === 'string' && pathname.match(/^\/api\/tasks\/([\w-]+)$/);
    if (method === 'GET' && taskMatch) return result(manager.publicTask(manager.get(taskMatch[1])));
    const cancelMatch = typeof pathname === 'string' && pathname.match(/^\/api\/tasks\/([\w-]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) return result(manager.cancel(cancelMatch[1]));
    const retryMatch = typeof pathname === 'string' && pathname.match(/^\/api\/tasks\/([\w-]+)\/retry$/);
    if (method === 'POST' && retryMatch) return result(manager.retry(retryMatch[1]), 201);
    const resumeMatch = typeof pathname === 'string' && pathname.match(/^\/api\/tasks\/([\w-]+)\/resume$/);
    if (method === 'POST' && resumeMatch) return result(manager.resume(resumeMatch[1], data), 201);
    if (method === 'POST' && pathname === '/api/tool') return result(await callTool(manager, data.name, data.arguments));
    return result({ error: '接口不存在' }, 404);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) return json({ error: '无效主机' }, 403);
      if (req.headers.origin) {
        if (!localOrigin(req.headers.origin)) return json({ error: '拒绝跨站请求' }, 403);
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (!safeEqual(req.headers.authorization?.replace(/^Bearer /, ''), token)) return json({ error: '插件连接已失效，请重新打开 Harness 页面' }, 401);
      if (closing) return json({ error: '插件正在关闭' }, 503);
      const parsed = new URL(req.url, origin);
      const pathname = parsed.pathname + parsed.search;
      const data = ['POST', 'PUT'].includes(req.method) ? await body(req) : undefined;
      const { value, status } = await dispatch(req.method, pathname, data);
      return json(value, status);
    } catch (e) { if (!res.headersSent) json({ error: redact(e.message) }, 400); else res.end(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (e) { await manager.close(); fs.rmSync(lock, { recursive: true, force: true }); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = { pid: process.pid, origin, token, startedAt };
  atomicJSON(path.join(dir, 'runtime.json'), runtime);
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      await manager.close();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      fs.rmSync(path.join(dir, 'runtime.json'), { force: true });
      fs.rmSync(lock, { recursive: true, force: true });
    })();
    return closing;
  }
  return { manager, runtime, close, server, dispatch };
}
