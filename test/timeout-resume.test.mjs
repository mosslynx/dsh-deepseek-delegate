import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TaskManager } from '../src/tasks.mjs';
import { callTool } from '../src/protocol.mjs';

const fixture = fileURLToPath(new URL('./fixture-harness.mjs', import.meta.url));

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delegate-timeout-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cwd: dir, reuseProviders: false }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function storedTasks(dir) {
  return fs.readdirSync(path.join(dir, 'tasks')).filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, 'tasks', name), 'utf8')))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

function launcherFor(modes, sessions) {
  return (_config, _overlay, session) => {
    sessions.push(session || null);
    const mode = modes.length ? modes.shift() : 'ok';
    return spawn(process.execPath, [fixture, mode, ...(session ? [session] : [])], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
    });
  };
}

function harness(t, modes = [], options = {}) {
  const dir = directory(t), sessions = [];
  const manager = new TaskManager(dir, {
    launch: launcherFor(modes, sessions),
    persistDelayMs: options.persistDelayMs ?? 20,
    stopGraceMs: options.stopGraceMs ?? 20,
  });
  manager.settings({ cwd: dir, reuseProviders: false, reasoningEffort: 'max' });
  t.after(() => manager.close());
  return { manager, dir, sessions, modes };
}

async function finish(manager, id, timeoutMs = 5000) {
  for (let i = 0; i < 10; i++) {
    const task = await manager.wait(id, Math.min(1000, timeoutMs));
    if (!['running', 'queued'].includes(task.status)) return task;
  }
  throw new Error('fixture did not finish');
}

function startTimed(manager, prompt, timeoutSeconds = 1) {
  return manager.create({ prompt, config: { ...manager.config, timeoutSeconds } });
}

test('per-task timeout overrides the manager default and rejects invalid values', async t => {
  const { manager } = harness(t, ['hang']);
  const defaultTask = manager.delegate({ prompt: 'default timeout' });
  assert.equal(defaultTask.timeoutSeconds, 1200);
  const overridden = manager.delegate({ prompt: 'long task', timeoutSeconds: 60 });
  assert.equal(overridden.timeoutSeconds, 60);
  assert.equal(manager.get(overridden.id).config.timeoutSeconds, 60);
  for (const timeoutSeconds of [5, 3601, '60', 1.5]) {
    assert.throws(() => manager.delegate({ prompt: 'invalid', timeoutSeconds }), /超时范围/);
  }
});

test('legacy timeout records are recognized on load', async t => {
  const dir = directory(t);
  const seed = new TaskManager(dir, { launch: launcherFor([], []) });
  await seed.close();
  fs.rmSync(path.join(dir, 'meta.json'), { force: true });
  fs.rmSync(path.join(dir, 'tasks'), { recursive: true, force: true });
  const stored = {
    id: 'legacy-timeout', status: 'failed', error: '运行超时', sessionId: 'session-legacy',
    cwd: dir, modelRoute: seed.config.modelRoute, reasoningEffort: 'max', permissionMode: 'read-only',
    createdAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    events: [], answer: '', stderr: '', config: seed.config,
  };
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([stored]));
  const reloaded = new TaskManager(dir, { launch: launcherFor([], []) });
  t.after(() => reloaded.close());
  assert.equal(reloaded.get('legacy-timeout').errorCode, 'timeout');
  assert.equal(reloaded.publicTask(reloaded.get('legacy-timeout')).resumable, true);
});

test('timeout marks the task failed, keeps the session and partial output', async t => {
  const { manager } = harness(t, ['hang-text']);
  const task = startTimed(manager, 'timeout me');
  const done = await finish(manager, task.id, 6000);
  assert.equal(done.status, 'failed');
  assert.equal(done.errorCode, 'timeout');
  assert.match(done.error, /运行超时/);
  assert.ok(done.sessionId);
  assert.equal(done.resumable, true);
  assert.equal(done.answer, '');
  assert.match(done.partialAnswer, /partial output before timeout/);
  assert.equal(done.timeoutSeconds, 1);
});

test('resume continues the original session instead of starting a new one', async t => {
  const { manager, sessions } = harness(t, ['hang-text', 'ok']);
  const source = startTimed(manager, 'timed out task');
  const failed = await finish(manager, source.id, 6000);
  assert.equal(failed.status, 'failed');
  const originalSession = failed.sessionId;

  const resumed = manager.resume(failed.id, { prompt: '继续完成', timeoutSeconds: 10 });
  assert.equal(resumed.continueTaskId, failed.id);
  assert.equal(resumed.sessionId, originalSession);
  assert.equal(resumed.timeoutSeconds, 10);
  const done = await finish(manager, resumed.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.answer, 'answer:继续完成');
  assert.equal(done.continueTaskId, failed.id);
  assert.deepEqual(sessions, [null, originalSession]);
  // The parent record is preserved.
  assert.equal(manager.get(failed.id).status, 'failed');
  assert.equal(manager.get(failed.id).errorCode, 'timeout');
});

test('resume rejects non-resumable states and concurrent sessions', async t => {
  const { manager } = harness(t, ['ok']);
  const completed = await finish(manager, manager.delegate({ prompt: 'done' }).id);
  assert.throws(() => manager.resume(completed.id), /已完成/);

  const cancelled = manager.create({ prompt: 'cancel me', config: manager.config });
  manager.cancel(cancelled.id);
  assert.throws(() => manager.resume(cancelled.id), /已取消/);

  const base = {
    cwd: manager.config.cwd, modelRoute: manager.config.modelRoute, reasoningEffort: 'max',
    permissionMode: 'read-only', createdAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    events: [], answer: '', stderr: '', config: manager.config,
  };
  manager.tasks.push({ ...base, id: 'ordinary-failed', status: 'failed', errorCode: null, sessionId: 'session-ordinary' });
  assert.throws(() => manager.resume('ordinary-failed'), /只有超时/);

  manager.tasks.push({ ...base, id: 'no-session', status: 'interrupted', errorCode: 'interrupted', sessionId: null });
  assert.throws(() => manager.resume('no-session'), /只有超时/);

  manager.tasks.push({ ...base, id: 'timed-out', status: 'failed', errorCode: 'timeout', sessionId: 'session-busy' });
  manager.tasks.push({ ...base, id: 'already-running', status: 'running', errorCode: null, sessionId: 'session-busy' });
  assert.throws(() => manager.resume('timed-out'), /已有未结束任务/);
});

test('resume is idempotent when the same key and arguments are replayed', async t => {
  const { manager } = harness(t, ['ok']);
  manager.tasks.push({
    id: 'seed-timeout', status: 'failed', errorCode: 'timeout', sessionId: 'session-seed',
    prompt: 'source', cwd: manager.config.cwd, modelRoute: manager.config.modelRoute,
    reasoningEffort: 'max', permissionMode: 'read-only', createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(), events: [], answer: '', stderr: '', config: manager.config,
  });
  const args = { taskId: 'seed-timeout', prompt: '继续', timeoutSeconds: 10, idempotencyKey: 'resume-key-1' };
  const first = manager.resume('seed-timeout', args);
  const second = manager.resume('seed-timeout', args);
  assert.equal(second.id, first.id);
  await finish(manager, first.id);
  assert.throws(() => manager.resume('seed-timeout', { ...args, prompt: 'different' }), /幂等键/);
});

test('scheduled persistence writes events before close', async t => {
  const { manager, dir } = harness(t, ['ok'], { persistDelayMs: 20 });
  const task = await finish(manager, manager.delegate({ prompt: 'persist me' }).id);
  manager.event(manager.get(task.id), 'text', 'scheduled update');
  await new Promise(resolve => setTimeout(resolve, 80));
  const stored = storedTasks(dir);
  const row = stored.find(item => item.id === task.id);
  assert.ok(row.events.some(event => event.text === 'scheduled update'));
});

test('allowedRoots blocks cwd outside the configured roots', async t => {
  const { manager, dir } = harness(t, ['ok']);
  manager.settings({ allowedRoots: [dir] });
  const inside = await finish(manager, manager.delegate({ prompt: 'inside' }).id);
  assert.equal(inside.status, 'completed');
  assert.throws(() => manager.delegate({ prompt: 'outside', cwd: os.tmpdir() }), /允许范围/);
  assert.throws(() => manager.settings({ allowedRoots: ['relative/path'] }), /绝对路径/);
  assert.throws(() => manager.settings({ allowedRoots: [path.join(os.tmpdir(), `missing-${Date.now()}`)] }), /不存在/);
});

test('wait_task exposes progress but not prompt or session details', async t => {
  const { manager } = harness(t, ['ok']);
  const task = await finish(manager, manager.delegate({ prompt: 'projection' }).id);
  const concise = await callTool(manager, 'wait_task', { taskId: task.id });
  assert.equal(concise.answer, 'answer:projection');
  assert.equal('prompt' in concise, false);
  assert.equal('cwd' in concise, false);
  assert.equal('sessionId' in concise, false);
  assert.equal(concise.resumable, false);
  assert.ok(Number.isInteger(concise.progress.elapsedSeconds));
  assert.equal(concise.progress.timeoutSeconds, 1200);
  const full = await callTool(manager, 'get_task', { taskId: task.id });
  assert.equal(full.prompt, 'projection');
  assert.ok(full.sessionId);
});
