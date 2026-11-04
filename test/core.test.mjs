import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { TaskManager } from '../src/tasks.mjs';
import { startServer } from '../src/server.mjs';
import { request } from '../src/client.mjs';
import { apply } from '../src/plugin.mjs';
import { createPanelApi, PANEL_CHANNEL, PANEL_ENDPOINT } from '../src/ui/transport.mjs';

const fixture = fileURLToPath(new URL('./fixture-harness.mjs', import.meta.url));
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delegate-test-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cwd: dir, reuseProviders: false }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
function launcher(mode, sessions = []) {
  return (_config, _overlay, session) => { sessions.push(session); return spawn(process.execPath, [fixture, mode, ...(session ? [session] : [])], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' }); };
}
function manager(t, mode = 'ok', sessions) {
  const dir = directory(t), m = new TaskManager(dir, { launch: launcher(mode, sessions) });
  m.settings({ cwd: dir, reuseProviders: false }); t.after(() => m.close()); return m;
}
function nativeContext() {
  const routes = new Map(), effects = [];
  return {
    ctx: {
      effect: fn => { effects.push(fn()); }, logger: { info() {} },
      connection: { fetch: { register: route => {
        assert.equal(routes.has(route.path), false); routes.set(route.path, route);
        effects.push(() => routes.delete(route.path));
      } } },
    },
    connection: { rpc: { call: async (channel, endpoint, payload, signal) => {
      signal?.throwIfAborted();
      const route = routes.get(`${channel}/${endpoint}`); if (!route) throw new Error('channel offline');
      const rpcId = 'test-request';
      const response = await route.fetch(new Request(`http://localhost${route.path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }), signal,
      }));
      assert.equal(response.ok, true);
      const envelope = await response.json();
      assert.equal(envelope.type, 'server-response'); assert.equal(envelope.rpcId, rpcId);
      if (!envelope.result.ok) assert.deepEqual(envelope.result.error.details, {});
      return envelope.result;
    } } },
    routes,
    dispose: async () => { for (const effect of effects.splice(0).reverse()) await effect(); },
  };
}
async function finish(m, id) {
  for (let i = 0; i < 10; i++) { const task = await m.wait(id, 1000); if (!['running', 'queued'].includes(task.status)) return task; }
  throw new Error('fixture did not finish');
}

test('literal prompt, Unicode result, native session continuation and stored results', async t => {
  const sessions = [], m = manager(t, 'ok', sessions);
  const prompt = '你好 🐳 `literal` $(not a command)';
  const a = await finish(m, m.delegate({ prompt }).id);
  assert.equal(a.status, 'completed'); assert.equal(a.answer, `answer:${prompt}`);
  const b = await finish(m, m.delegate({ prompt: '接着说', continueTaskId: a.id }).id);
  assert.equal(b.sessionId, a.sessionId); assert.deepEqual(sessions, [null, a.sessionId]);
  assert.equal('config' in m.list()[0], false);
  m.settings({ modelRoute: 'other/model' });
  assert.throws(() => m.delegate({ prompt: 'x', continueTaskId: a.id }), /模型路由/);
  const stored = JSON.parse(fs.readFileSync(path.join(m.dir, 'tasks.json')));
  assert.equal(stored[0].answer, a.answer);
});

test('records and exposes Harness token usage', async t => {
  const m = manager(t, 'usage');
  const result = await finish(m, m.delegate({ prompt: 'measure tokens' }).id);
  const expected = { totalTokens: 1234, inputTokens: 900, outputTokens: 334, thoughtTokens: 80, cachedReadTokens: 12, cachedWriteTokens: 4 };
  const exposed = { ...expected, billableTokens: 1234 };
  assert.deepEqual(result.usage, exposed);
  assert.deepEqual(m.list()[0].usage, exposed);
  assert.deepEqual(m.usageSummary(), { taskCount: 1, reportedTaskCount: 1, ...exposed });
  const stored = JSON.parse(fs.readFileSync(path.join(m.dir, 'tasks.json')));
  assert.deepEqual(stored[0].usage, expected);
  const reloaded = new TaskManager(m.dir, { launch: launcher('usage') });
  t.after(() => reloaded.close());
  assert.deepEqual(reloaded.get(result.id).usage, expected);
});

test('accepts nested usage updates and ignores malformed counters', async t => {
  const nested = manager(t, 'usage-nested');
  const nestedResult = await finish(nested, nested.delegate({ prompt: 'nested usage' }).id);
  assert.equal(nestedResult.usage.totalTokens, 1234);
  const malformed = manager(t, 'usage-invalid');
  const malformedResult = await finish(malformed, malformed.delegate({ prompt: 'bad usage' }).id);
  assert.equal(malformedResult.status, 'completed');
  assert.equal(malformedResult.usage, null);
});

test('normalizes real Harness usage names and sums multiple steps', async t => {
  const m = manager(t, 'usage-real');
  const result = await finish(m, m.delegate({ prompt: 'real usage' }).id);
  assert.deepEqual(result.usage, {
    totalTokens: 210, inputTokens: 130, outputTokens: 60,
    thoughtTokens: 12, cachedReadTokens: 20, cachedWriteTokens: 0, billableTokens: 190,
  });
});

test('keeps ACP context occupancy separate from billable usage', async t => {
  const m = manager(t, 'usage-context');
  const result = await finish(m, m.delegate({ prompt: 'context usage' }).id);
  assert.equal(result.usage, null);
  assert.deepEqual(result.contextUsage, { used: 1234, size: 128000 });
});

test('provider errors keep late stderr and cannot become false success', async t => {
  const m = manager(t, 'error'), result = await finish(m, m.delegate({ prompt: 'x' }).id);
  assert.equal(result.status, 'failed'); assert.match(result.error, /provider rejected/); assert.match(result.stderr, /late diagnostic/);
});
test('final text alone does not mark an incomplete turn successful', async t => {
  const m = manager(t, 'incomplete'), result = await finish(m, m.delegate({ prompt: 'x' }).id);
  assert.equal(result.status, 'failed'); assert.match(result.error, /未收到完成事件/);
});
test('cancelling queued work never launches it and running child is drained', async t => {
  const m = manager(t, 'hang'); const a = m.delegate({ prompt: 'a' });
  await new Promise(resolve => setImmediate(resolve));
  const b = m.delegate({ prompt: 'b' }); m.cancel(b.id); m.cancel(a.id);
  assert.equal(m.children.size, 1);
  await m.close(); assert.equal(m.children.size, 0);
  assert.equal(m.get(a.id).status, 'cancelled'); assert.equal(m.get(b.id).status, 'cancelled');
});
test('plugin unload interrupts tasks, closes listener and removes runtime discovery', async t => {
  const dir = directory(t), host = nativeContext(); t.after(() => host.dispose());
  await apply(host.ctx, { dataDir: dir });
  const runtime = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json')));
  assert.equal((await request(runtime, '/api/ping')).ok, true);
  await host.dispose(); assert.equal(fs.existsSync(path.join(dir, 'runtime.json')), false);
  await assert.rejects(request(runtime, '/api/ping'));
});

test('retained panel reconnects across plugin toggles and Host replacement without boot globals', async t => {
  const dir = directory(t); let host = nativeContext();
  t.after(() => host.dispose());
  // The same API closure is kept by the page across all three activations.
  const api = createPanelApi(() => host.connection);
  let previousRuntime;
  for (let cycle = 0; cycle < 3; cycle++) {
    await apply(host.ctx, { dataDir: dir });
    const runtime = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json')));
    if (previousRuntime) assert.notEqual(runtime.token, previousRuntime.token);
    const state = await api('/api/state'); assert.ok(state.integration.toml); assert.equal('token' in state, false);
    const config = await api('/api/config', { maxConcurrent: 2 }, 'PUT'); assert.equal(config.maxConcurrent, 2);
    const route = host.routes.get(`${PANEL_CHANNEL}/${PANEL_ENDPOINT}`);
    const invalid = await route.fetch(new Request(`http://localhost${route.path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'invalid-test', method: 'wrong-method', payload: {} }),
    }));
    const envelope = await invalid.json();
    assert.equal(envelope.rpcId, 'invalid-test'); assert.equal(envelope.result.ok, false);
    assert.match(envelope.result.error.message, /无效的委派请求/);
    await assert.rejects(api('/api/missing'), /接口不存在/);
    await assert.rejects(api('/api/config', { maxConcurrent: 9 }, 'PUT'), /并发范围/);
    await host.dispose();
    await assert.rejects(api('/api/state'), /正在重新连接/);
    assert.equal(fs.existsSync(path.join(dir, 'server.lock')), false);
    previousRuntime = runtime;
    if (cycle === 1) host = nativeContext();
  }
});

test('disabling during plugin startup drains the listener before another activation', async t => {
  const dir = directory(t), host = nativeContext(); t.after(() => host.dispose());
  const starting = apply(host.ctx, { dataDir: dir });
  await host.dispose(); await starting;
  assert.equal(host.routes.size, 0);
  assert.equal(fs.existsSync(path.join(dir, 'runtime.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'server.lock')), false);
  await apply(host.ctx, { dataDir: dir });
  assert.equal((await createPanelApi(() => host.connection)('/api/ping')).ok, true);
});
test('recovers a stale lock without an owner', async t => {
  const dir = directory(t), lock = path.join(dir, 'server.lock');
  fs.mkdirSync(lock);
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, past, past);
  const app = await startServer(dir, { launch: launcher('ok'), lockGraceMs: 0 });
  t.after(() => app.close());
  const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
  assert.equal(owner.pid, process.pid);
  assert.ok(owner.startedAt);
});

test('recovers a stale lock with a corrupt owner file', async t => {
  const dir = directory(t), lock = path.join(dir, 'server.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), '{not-json');
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, past, past);
  const app = await startServer(dir, { launch: launcher('ok'), lockGraceMs: 0 });
  t.after(() => app.close());
  assert.equal(JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')).pid, process.pid);
});

test('recovers a lock owned by a dead pid', async t => {
  const dir = directory(t), lock = path.join(dir, 'server.lock');
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  await once(child, 'exit');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
  const app = await startServer(dir, { launch: launcher('ok'), lockGraceMs: 0 });
  t.after(() => app.close());
  assert.equal(JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')).pid, process.pid);
});

test('keeps an active lock even when startedAt is old', async t => {
  const dir = directory(t), lock = path.join(dir, 'server.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date(0).toISOString() }));
  await assert.rejects(startServer(dir, { launch: launcher('ok') }), /已在运行/);
});

test('rejects a freshly created lock without an owner during the grace period', async t => {
  const dir = directory(t), lock = path.join(dir, 'server.lock');
  fs.mkdirSync(lock);
  await assert.rejects(startServer(dir, { launch: launcher('ok') }), /已在运行/);
});

test('ignores non-JSON harness banner lines and still completes', async t => {
  const m = manager(t, 'noise');
  const task = await finish(m, m.delegate({ prompt: 'noise' }).id);
  assert.equal(task.status, 'completed');
  assert.equal(task.answer, 'answer:noise');
  assert.match(task.stderr, /banner: starting harness/);
});

test('malformed JSON output still fails the task', async t => {
  const m = manager(t, 'bad-json');
  const task = await finish(m, m.delegate({ prompt: 'bad' }).id);
  assert.equal(task.status, 'failed');
  assert.match(task.error, /不是有效 JSON/);
});

test('loopback API requires bearer and rejects hostile origins', async t => {
  const dir = directory(t), app = await startServer(dir, { launch: launcher('ok') }); t.after(() => app.close());
  app.manager.settings({ cwd: dir, reuseProviders: false });
  assert.equal((await fetch(app.runtime.origin + '/api/state')).status, 401);
  assert.equal((await fetch(app.runtime.origin + '/api/state', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${app.runtime.token}` } })).status, 403);
  const desktop = await fetch(app.runtime.origin + '/api/state', { headers: { Origin: 'null', Authorization: `Bearer ${app.runtime.token}` } });
  assert.equal(desktop.status, 200); assert.equal(desktop.headers.get('access-control-allow-origin'), 'null');
  const appOrigin = { Origin: 'dsh-app://app', Authorization: `Bearer ${app.runtime.token}` };
  const native = await fetch(app.runtime.origin + '/api/state', { headers: appOrigin });
  assert.equal(native.status, 200); assert.equal(native.headers.get('access-control-allow-origin'), 'dsh-app://app');
  const preflight = await fetch(app.runtime.origin + '/api/state', { method: 'OPTIONS', headers: { Origin: 'dsh-app://app', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'dsh-app://app');
  assert.equal((await fetch(app.runtime.origin + '/api/state', { headers: { Origin: 'dsh-app://evil', Authorization: `Bearer ${app.runtime.token}` } })).status, 403);
  const task = await request(app.runtime, '/api/tasks', { prompt: 'from UI' }); await finish(app.manager, task.id);
  const result = await request(app.runtime, '/api/tool', { name: 'get_task', arguments: { taskId: task.id } });
  assert.equal(result.answer, 'answer:from UI');
});
test('stdio bridge initializes while offline, reports offline tool error, then discovers plugin', async t => {
  const dir = directory(t);
  const child = spawn(process.execPath, ['src/cli.mjs', 'mcp'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DEEPSEEK_MCP_DATA: dir }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.stdin.end(); child.kill(); });
  let buffer = ''; const pending = new Map();
  child.stdout.on('data', chunk => { buffer += chunk; let at; while ((at = buffer.indexOf('\n')) >= 0) { const msg = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); pending.get(msg.id)?.(msg); pending.delete(msg.id); } });
  const rpc = (id, method, params) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('RPC timed out')), 8000); pending.set(id, msg => { clearTimeout(timer); resolve(msg); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18' }); assert.equal(init.result.protocolVersion, '2025-06-18');
  const offline = await rpc(2, 'tools/call', { name: 'list_tasks' }); assert.equal(offline.result.isError, true); assert.match(offline.result.content[0].text, /插件未运行/);
  const app = await startServer(dir, { launch: launcher('ok') }); t.after(() => app.close());
  const online = await rpc(3, 'tools/call', { name: 'list_tasks' }); assert.deepEqual(JSON.parse(online.result.content[0].text).tasks, []);
  assert.deepEqual(online.result.structuredContent, JSON.parse(online.result.content[0].text));
  await app.close(); child.stdin.end(); await once(child, 'close');
});
