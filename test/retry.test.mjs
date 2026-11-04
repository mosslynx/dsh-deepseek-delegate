import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TaskManager } from '../src/tasks.mjs';
import { startServer } from '../src/server.mjs';
import { request } from '../src/client.mjs';
import { TOOLS, callTool } from '../src/protocol.mjs';

const fixture = fileURLToPath(new URL('./fixture-harness.mjs', import.meta.url));
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delegate-retry-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cwd: dir, reuseProviders: false }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// `modes` lets one manager fail the first attempt and succeed on the retry.
// `sessions` records the session id handed to each spawn: null means "fresh".
function launcherFor(modes, sessions) {
  return (_config, _overlay, session) => {
    sessions.push(session || null);
    const mode = modes.length ? modes.shift() : 'ok';
    return spawn(process.execPath, [fixture, mode, ...(session ? [session] : [])], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
  };
}
function harness(t, modes = []) {
  const dir = directory(t), sessions = [];
  const manager = new TaskManager(dir, { launch: launcherFor(modes, sessions) });
  manager.settings({ cwd: dir, reuseProviders: false, reasoningEffort: 'max' });
  t.after(() => manager.close());
  return { manager, dir, sessions, modes };
}
async function finish(manager, id) {
  for (let i = 0; i < 10; i++) {
    const task = await manager.wait(id, 1000);
    if (!['running', 'queued'].includes(task.status)) return task;
  }
  throw new Error('fixture did not finish');
}
function storedTasks(dir) {
  return fs.readdirSync(path.join(dir, 'tasks')).filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, 'tasks', name), 'utf8')))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

test('failed task retries as a new attempt that copies the snapshot and starts a fresh session', async t => {
  const { manager, sessions, modes } = harness(t);
  modes.push('error', 'ok');
  const failed = await finish(manager, manager.delegate({ prompt: '写一份报告' }).id);
  assert.equal(failed.status, 'failed');
  const original = manager.get(failed.id);
  const snapshot = JSON.stringify(original);

  const retry = manager.retry(failed.id);
  assert.notEqual(retry.id, failed.id);
  assert.equal(retry.status, 'queued');
  assert.equal(retry.retryOf, failed.id);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.prompt, failed.prompt);
  assert.equal(retry.cwd, failed.cwd);
  assert.equal(retry.modelRoute, failed.modelRoute);
  assert.equal(retry.reasoningEffort, 'max');
  assert.equal(retry.permissionMode, failed.permissionMode);
  // A retry is a new run, never a continuation: no session and no continueTaskId.
  assert.equal(retry.sessionId, null);
  assert.equal(retry.continueTaskId, null);
  // The original record is preserved byte for byte.
  assert.equal(JSON.stringify(manager.get(failed.id)), snapshot);
  assert.equal(manager.get(failed.id).status, 'failed');

  const done = await finish(manager, retry.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.answer, 'answer:写一份报告');
  assert.equal(done.retryOf, failed.id);
  assert.equal(done.attempt, 2);
  // Two spawns, and neither was given a session id to resume.
  assert.deepEqual(sessions, [null, null]);
  assert.ok(done.sessionId);
  assert.notEqual(done.sessionId, failed.sessionId);
  const stored = storedTasks(manager.dir);
  assert.equal(stored.find(task => task.id === retry.id).retryOf, failed.id);
  assert.equal(stored.find(task => task.id === failed.id).status, 'failed');
});

test('interrupted tasks stay retryable after a restart and the retry relation is persisted', async t => {
  const dir = directory(t);
  const first = new TaskManager(dir, { launch: () => { throw new Error('unused'); } });
  first.settings({ cwd: dir, reuseProviders: false });
  const config = first.config, now = new Date().toISOString();
  await first.close();
  fs.rmSync(path.join(dir, 'meta.json'), { force: true });
  fs.rmSync(path.join(dir, 'tasks'), { recursive: true, force: true });
  // A task that was running when the plugin died is rewritten to `interrupted`.
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([{
    id: 'task-interrupted', prompt: '重启后继续', cwd: config.cwd, modelRoute: config.modelRoute,
    permissionMode: config.permissionMode, status: 'running', createdAt: now, continueTaskId: null,
    sessionId: 'old-session-id', answer: '', stderr: '', events: [], exitCode: null, error: null, config,
  }]));

  const sessions = [], modes = [];
  const second = new TaskManager(dir, { launch: launcherFor(modes, sessions) });
  t.after(() => second.close());
  const recovered = second.get('task-interrupted');
  assert.equal(recovered.status, 'interrupted');
  const retry = second.retry('task-interrupted');
  assert.equal(retry.retryOf, 'task-interrupted');
  assert.equal(retry.attempt, 2);
  assert.equal(retry.sessionId, null);
  assert.equal(retry.permissionMode, config.permissionMode);
  assert.equal(retry.modelRoute, config.modelRoute);
  const done = await finish(second, retry.id);
  assert.equal(done.status, 'completed');
  assert.deepEqual(sessions, [null]);
  assert.notEqual(done.sessionId, 'old-session-id');

  const third = new TaskManager(dir, { launch: launcherFor([], []) });
  t.after(() => third.close());
  const persisted = third.tasks.find(task => task.id === retry.id);
  assert.equal(persisted.retryOf, 'task-interrupted');
  assert.equal(persisted.attempt, 2);
  assert.equal(persisted.status, 'completed');
  assert.equal(third.tasks.find(task => task.id === 'task-interrupted').status, 'interrupted');
  assert.equal(third.list().find(task => task.id === retry.id).retryOf, 'task-interrupted');
});

test('queued, running, completed and cancelled tasks are refused without spawning', async t => {
  const { manager, sessions, modes } = harness(t, ['hang']);
  const running = manager.delegate({ prompt: '占住并发位' });
  await new Promise(resolve => setImmediate(resolve));
  const queued = manager.delegate({ prompt: '排队中' });
  assert.equal(manager.children.size, 1);
  assert.throws(() => manager.retry(running.id), /只有失败或已中断/);
  assert.throws(() => manager.retry(queued.id), /只有失败或已中断/);
  assert.equal(manager.children.size, 1);
  assert.equal(sessions.length, 1);
  assert.equal(manager.tasks.length, 2);

  manager.cancel(queued.id); manager.cancel(running.id);
  assert.throws(() => manager.retry(running.id), /只有失败或已中断.*取消/);
  assert.throws(() => manager.retry(queued.id), /只有失败或已中断.*取消/);
  assert.equal(manager.children.size, 1);
  assert.equal(sessions.length, 1);

  const other = manager.delegate({ prompt: '会成功' });
  const completed = await finish(manager, other.id);
  assert.equal(completed.status, 'completed');
  assert.throws(() => manager.retry(completed.id), /只有失败或已中断.*已完成/);
  assert.throws(() => manager.retry('missing-task'), /任务不存在/);
  assert.equal(manager.tasks.length, 3);
});

test('retry_task is exposed through MCP dispatch and the panel API with the same guard', async t => {
  const dir = directory(t), sessions = [], modes = ['error', 'ok'];
  const app = await startServer(dir, { launch: launcherFor(modes, sessions) });
  t.after(() => app.close());
  app.manager.settings({ cwd: dir, reuseProviders: false });

  const tool = TOOLS.find(candidate => candidate.name === 'retry_task');
  assert.ok(tool, 'retry_task must be advertised');
  assert.deepEqual(tool.inputSchema.required, ['taskId']);
  assert.match(tool.description, /failed or interrupted/i);

  const failed = await finish(app.manager, (await request(app.runtime, '/api/tasks', { prompt: 'ship it' })).id);
  assert.equal(failed.status, 'failed');

  const viaPanel = await request(app.runtime, `/api/tasks/${failed.id}/retry`, {});
  assert.equal(viaPanel.retryOf, failed.id);
  const viaTool = await request(app.runtime, '/api/tool', { name: 'retry_task', arguments: { taskId: failed.id } });
  assert.equal(viaTool.retryOf, failed.id);
  assert.notEqual(viaTool.id, viaPanel.id);

  const done = await finish(app.manager, viaPanel.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.sessionId && done.sessionId !== failed.sessionId, true);
  await assert.rejects(request(app.runtime, `/api/tasks/${done.id}/retry`, {}), /只有失败或已中断/);
  await assert.rejects(callTool(app.manager, 'retry_task', { taskId: done.id }), /只有失败或已中断/);
  await assert.rejects(callTool(app.manager, 'retry_task', { taskId: done.id, force: true }), /未知参数/);
  // The failed original is still failed and still listed next to its retries.
  assert.equal(app.manager.get(failed.id).status, 'failed');
  const { tasks: listed } = await request(app.runtime, '/api/tool', { name: 'list_tasks', arguments: {} });
  assert.deepEqual(listed.map(task => task.id).sort(), [failed.id, viaPanel.id, viaTool.id].sort());
  assert.equal(listed.find(task => task.id === viaTool.id).retryOf, failed.id);
});
