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
import { callTool, TOOLS } from '../src/protocol.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixture-harness.mjs', import.meta.url));
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delegate-features-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cwd: dir, reuseProviders: false }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function taskFiles(dir) {
  return fs.readdirSync(path.join(dir, 'tasks')).filter(name => name.endsWith('.json')).sort()
    .map(name => path.join(dir, 'tasks', name));
}
function storedTasks(dir) {
  return taskFiles(dir).map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
function storedTaskText(dir) { return taskFiles(dir).map(file => fs.readFileSync(file, 'utf8')).join('\n'); }
function launcher(mode, launches = []) {
  return (config, overlay, session) => {
    launches.push({ config, session });
    return spawn(process.execPath, [fixture, mode], { windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  };
}
function manager(t, mode = 'ok', launches) {
  const m = new TaskManager(directory(t), { launch: launcher(mode, launches) });
  t.after(() => m.close());
  return m;
}
async function finish(m, id) {
  const result = await m.wait(id, 5000);
  assert.ok(!['queued', 'running'].includes(result.status), 'fixture should finish');
  return result;
}
function savedTask(id, config, changes = {}) {
  return { id, prompt: `prompt ${id}`, cwd: config.cwd, modelRoute: config.modelRoute,
    permissionMode: config.permissionMode, reasoningEffort: config.reasoningEffort,
    status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:00.000Z',
    sessionId: `session-${id}`, answer: 'answer', stderr: 'diagnostic', events: [], config, ...changes };
}

test('idempotent dispatch survives settings changes and restart without exposing hashes or raw secrets', async t => {
  const launches = [], m = manager(t, 'ok', launches);
  const args = { prompt: '检查 sk-abcdefghijklmnop', idempotencyKey: 'request:one' };
  const first = m.delegate(args);
  const duplicate = m.delegate(args);
  assert.equal(duplicate.id, first.id);
  m.settings({ reasoningEffort: 'high', modelRoute: 'other/model' });
  assert.equal(m.delegate(args).id, first.id);
  assert.equal(m.delegate(args).reasoningEffort, 'default');
  assert.equal((await finish(m, first.id)).status, 'completed');
  assert.equal(launches.length, 1);
  await m.close();
  const reloaded = new TaskManager(m.dir, { launch: () => { throw new Error('must not execute'); } });
  t.after(() => reloaded.close());
  assert.equal(reloaded.delegate(args).id, first.id);
  assert.equal(reloaded.delegate(args).status, 'completed');
  for (const task of [first, reloaded.publicTask(reloaded.get(first.id)), reloaded.list()[0]]) {
    assert.equal('idempotencyKeyHash' in task, false);
    assert.equal('requestFingerprint' in task, false);
    assert.equal('config' in task, false);
  }
  const persisted = storedTaskText(m.dir);
  assert.equal(persisted.includes('sk-abcdefghijklmnop'), false);
  assert.equal(persisted.includes('request:one'), false);
  assert.match(persisted, /requestFingerprint/);
});

test('same idempotency key rejects changed arguments and failed tasks require explicit retry', async t => {
  const launches = [], m = manager(t, 'error', launches);
  const args = { prompt: 'original', idempotencyKey: 'same-key' };
  const original = m.delegate(args);
  assert.throws(() => m.delegate({ ...args, prompt: 'different' }), /幂等键已用于不同/);
  assert.throws(() => m.delegate({ ...args, reasoningEffort: 'high' }), /幂等键已用于不同/);
  const failed = await finish(m, original.id);
  assert.equal(failed.status, 'failed');
  assert.equal(m.delegate(args).id, original.id);
  assert.equal(launches.length, 1);
  const retried = m.retry(original.id);
  assert.notEqual(retried.id, original.id);
  assert.equal('idempotencyKeyHash' in m.get(retried.id), false);
  await finish(m, retried.id);
  assert.equal(m.delegate(args).id, original.id);
  assert.equal(launches.length, 2);
});

test('idempotent replay works even when the active queue is full', async t => {
  const m = manager(t, 'hang');
  const args = { prompt: 'in flight', idempotencyKey: 'queue-key' };
  const original = m.delegate(args);
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 99; i++) m.tasks.push(savedTask(`queued-${i}`, m.config, { status: 'queued' }));
  assert.equal(m.delegate(args).id, original.id);
  assert.throws(() => m.delegate({ prompt: 'another' }), /队列已满/);
  assert.equal(m.children.size, 1);
});

test('idempotency keys are optional and invalid keys are rejected before dispatch', async t => {
  const m = manager(t);
  for (const idempotencyKey of ['', 'has space', 123, 'x'.repeat(129)]) assert.throws(() => m.delegate({ prompt: 'test', idempotencyKey }), /幂等键/);
  const first = m.delegate({ prompt: 'same prompt' });
  const second = m.delegate({ prompt: 'same prompt' });
  assert.notEqual(first.id, second.id);
  await finish(m, second.id);
});

test('task pages are bounded, newest first, filter before slicing and omit full diagnostics', async t => {
  const m = manager(t);
  m.tasks = Array.from({ length: 105 }, (_, i) => savedTask(`task-${i}`, m.config, {
    status: i % 2 ? 'failed' : 'completed', prompt: 'p'.repeat(600), events: [{ type: 'text', text: 'long log' }],
  }));
  const first = await callTool(m, 'list_tasks');
  assert.equal(first.tasks.length, 50);
  assert.equal(first.total, 105);
  assert.equal(first.nextOffset, 50);
  assert.equal(first.tasks[0].id, 'task-104');
  const second = m.listPage({ limit: 50, offset: first.nextOffset });
  assert.equal(second.tasks[0].id, 'task-54');
  const last = m.listPage({ limit: 50, offset: second.nextOffset });
  assert.equal(last.tasks.length, 5);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, null);
  const filtered = m.listPage({ status: 'failed', offset: 2, limit: 1 });
  assert.equal(filtered.total, 52);
  assert.equal(filtered.tasks[0].id, 'task-99');
  const summary = first.tasks[0];
  assert.equal(summary.prompt.length, 500);
  assert.equal(summary.promptTruncated, true);
  for (const field of ['events', 'stderr', 'answer', 'config']) assert.equal(field in summary, false);
  assert.equal(m.get(summary.id).prompt.length, 600);
  assert.deepEqual(m.listPage({ offset: 10000 }).tasks, []);
  for (const args of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { offset: 0.5 }, { status: 'invalid' }]) assert.throws(() => m.listPage(args));
});

test('history retention keeps recently ended tasks and protects active and draining processes', async t => {
  const m = manager(t);
  m.tasks = [
    savedTask('long-running-recently-ended', m.config, { endedAt: '2026-03-01T00:00:00.000Z' }),
    savedTask('old', m.config),
    savedTask('newer', m.config, { endedAt: '2026-02-01T00:00:00.000Z' }),
    savedTask('queued', m.config, { status: 'queued' }),
    savedTask('draining', m.config, { status: 'cancelled' }),
    savedTask('running', m.config, { status: 'running' }),
  ];
  // Protect a cancelled task until its owned process actually exits.
  m.children.set('draining', {}); m.children.set('running', {});
  m.persist();
  m.settings({ historyLimit: 2 });
  assert.deepEqual(m.tasks.map(task => task.id), ['long-running-recently-ended', 'newer', 'queued', 'draining', 'running']);
  assert.deepEqual(storedTasks(m.dir).map(task => task.id), m.tasks.map(task => task.id));
  assert.throws(() => m.get('old'), /任务不存在/);
  m.children.clear();
  // Do not launch the fabricated queue during test teardown.
  m.closing = true;
});

test('unlimited history disables pruning and old configuration receives the default', async t => {
  const m = manager(t);
  assert.equal(m.config.historyLimit, 1000);
  m.settings({ historyLimit: 0 });
  m.tasks = Array.from({ length: 1002 }, (_, i) => savedTask(`t-${i}`, m.config));
  m.persist();
  const reloaded = new TaskManager(m.dir, { launch: launcher('ok') });
  t.after(() => reloaded.close());
  assert.equal(reloaded.tasks.length, 1002);
  reloaded.settings({ historyLimit: 2 });
  assert.deepEqual(reloaded.tasks.map(task => task.id), ['t-1000', 't-1001']);
  await assert.rejects(callTool(m, 'list_tasks', { limit: '10' }), /类型无效/);
  await assert.rejects(callTool(m, 'list_tasks', { offset: -1 }), /超出范围/);
  await assert.rejects(callTool(m, 'wait_task', { taskId: 't-1', includeLogs: 'yes' }), /类型无效/);
  for (const historyLimit of [-1, 10001, 1.5, '2']) assert.throws(() => m.settings({ historyLimit }), /历史保留范围/);
});

test('history is pruned after completion and its idempotency key expires with the record', async t => {
  const launches = [], m = manager(t, 'ok', launches);
  m.settings({ historyLimit: 1 });
  const args = { prompt: 'first', idempotencyKey: 'expires-with-history' };
  const first = await finish(m, m.delegate(args).id);
  const next = await finish(m, m.delegate({ prompt: 'second' }).id);
  assert.deepEqual(m.tasks.map(task => task.id), [next.id]);
  assert.throws(() => m.get(first.id), /任务不存在/);
  const repeated = m.delegate(args);
  assert.notEqual(repeated.id, first.id);
  await finish(m, repeated.id);
  assert.equal(launches.length, 3);
  assert.deepEqual(storedTasks(m.dir).map(task => task.id), [repeated.id]);
});

test('startup retention applies to old configuration while recovering interrupted work', async t => {
  const dir = directory(t);
  const seed = new TaskManager(dir, { launch: launcher('ok') });
  const tasks = Array.from({ length: 1002 }, (_, i) => savedTask(`old-${i}`, seed.config));
  tasks.push(savedTask('unfinished', seed.config, { status: 'running', endedAt: undefined }));
  await seed.close();
  fs.rmSync(path.join(dir, 'meta.json'), { force: true });
  fs.rmSync(path.join(dir, 'tasks'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(tasks));
  const recovered = new TaskManager(dir, { launch: launcher('ok') });
  t.after(() => recovered.close());
  assert.equal(recovered.tasks.length, 1000);
  assert.equal(recovered.get('unfinished').status, 'interrupted');
  assert.equal(recovered.get('old-1001').status, 'completed');
  assert.throws(() => recovered.get('old-0'), /任务不存在/);
});

test('idempotent continuation reuses an active continuation instead of rejecting its own session', async t => {
  const launches = [], m = manager(t, 'ok', launches);
  const original = await finish(m, m.delegate({ prompt: 'original' }).id);
  const args = { prompt: 'continue', continueTaskId: original.id, idempotencyKey: 'continuation-key' };
  const continuation = m.delegate(args);
  assert.equal(m.delegate(args).id, continuation.id);
  await finish(m, continuation.id);
  assert.equal(launches.length, 2);
  assert.equal(launches[1].session, original.sessionId);
});

test('wait tool returns concise progress by default and can opt in to complete diagnostics', async t => {
  const m = manager(t);
  const task = await finish(m, m.delegate({ prompt: 'progress' }).id);
  const concise = await callTool(m, 'wait_task', { taskId: task.id });
  assert.equal(concise.answer, 'answer:progress');
  assert.equal('events' in concise, false);
  assert.equal('stderr' in concise, false);
  assert.equal('prompt' in concise, false);
  assert.equal('cwd' in concise, false);
  assert.equal('sessionId' in concise, false);
  assert.equal(concise.resumable, false);
  assert.ok(Number.isInteger(concise.progress.elapsedSeconds));
  assert.equal(concise.progress.timeoutSeconds, 1200);
  assert.equal(concise.progress.eventCount, task.events.length);
  assert.deepEqual(concise.progress.latestEvent, task.events.at(-1));
  const full = await callTool(m, 'wait_task', { taskId: task.id, includeLogs: true });
  assert.deepEqual(full.events, task.events);
  assert.equal(full.stderr, task.stderr);
  assert.equal(TOOLS.find(tool => tool.name === 'wait_task').inputSchema.properties.timeoutMs.default, 30000);
});

test('wait tool reports queue position and retains full task details through get_task', async t => {
  const m = manager(t, 'hang');
  const running = m.delegate({ prompt: 'running' });
  await new Promise(resolve => setImmediate(resolve));
  const queued = m.delegate({ prompt: 'waiting' });
  const response = await callTool(m, 'wait_task', { taskId: queued.id, timeoutMs: 0 });
  assert.equal(response.status, 'queued');
  assert.equal(response.progress.queuePosition, 1);
  assert.equal(response.progress.latestEvent, null);
  assert.equal((await callTool(m, 'wait_task', { taskId: running.id, timeoutMs: 0 })).progress.queuePosition, null);
  assert.ok(Array.isArray((await callTool(m, 'get_task', { taskId: running.id })).events));
});

test('loopback and native panel routes share pagination and idempotent dispatch', async t => {
  const launches = [], app = await startServer(directory(t), { launch: launcher('ok', launches) });
  t.after(() => app.close());
  const args = { prompt: 'one execution', idempotencyKey: 'api-key' };
  const [first, second] = await Promise.all([
    request(app.runtime, '/api/tasks', args),
    request(app.runtime, '/api/tool', { name: 'delegate_to_deepseek', arguments: args }),
  ]);
  assert.equal(first.id, second.id);
  await finish(app.manager, first.id);
  assert.equal(launches.length, 1);
  const page = await request(app.runtime, '/api/tasks?limit=1&offset=0&status=completed');
  assert.equal(page.tasks[0].id, first.id);
  assert.equal(page.total, 1);
  const native = await app.dispatch('GET', '/api/state?limit=1&offset=1');
  assert.equal(native.value.taskPage.offset, 1);
  assert.deepEqual(native.value.tasks, []);
  const state = await request(app.runtime, '/api/state?limit=1&offset=0&status=failed');
  assert.equal(state.taskPage.total, 0);
  await assert.rejects(request(app.runtime, '/api/tasks?limit='), /分页参数无效/);
  await assert.rejects(request(app.runtime, '/api/tasks?offset=-1'), /分页参数无效/);
});

async function bridge(t, dir, version) {
  const child = spawn(process.execPath, ['src/cli.mjs', 'mcp'], { cwd: root, env: { ...process.env, DEEPSEEK_MCP_DATA: dir }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let buffer = '', sequence = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk; let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
      pending.get(message.id)?.(message); pending.delete(message.id);
    }
  });
  t.after(async () => {
    if (child.exitCode === null) { const closed = once(child, 'close'); child.stdin.end(); await closed; }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timed out')); }, 8000);
    pending.set(id, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const init = await rpc('initialize', { protocolVersion: version });
  assert.equal(init.result.protocolVersion, version);
  assert.equal(init.result.serverInfo.version, '1.3.0');
  return rpc;
}

test('MCP returns matching structured and text results, and omits new fields for older protocols', async t => {
  const dir = directory(t), app = await startServer(dir, { launch: launcher('ok') });
  t.after(() => app.close());
  for (const version of ['2025-06-18', '2024-11-05']) {
    const rpc = await bridge(t, dir, version);
    const list = (await rpc('tools/list', {})).result;
    assert.equal(list.tools.every(tool => !!tool.outputSchema), version === '2025-06-18');
    const result = (await rpc('tools/call', { name: 'list_tasks', arguments: { limit: 1 } })).result;
    const text = JSON.parse(result.content[0].text);
    assert.deepEqual(text.tasks, []);
    assert.equal(text.limit, 1);
    if (version === '2025-06-18') assert.deepEqual(result.structuredContent, text);
    else assert.equal('structuredContent' in result, false);
    const failure = (await rpc('tools/call', { name: 'list_tasks', arguments: { limit: -1 } })).result;
    assert.equal(failure.isError, true);
    assert.equal('structuredContent' in failure, false);
  }
});
