import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskManager } from '../src/tasks.mjs';
import { SCHEMA_VERSION } from '../src/store.mjs';

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-delegate-storage-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ cwd: dir, reuseProviders: false }));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function task(dir, id, overrides = {}) {
  return {
    id, prompt: `prompt ${id}`, cwd: dir, modelRoute: 'fixture/model',
    reasoningEffort: 'default', permissionMode: 'read-only',
    status: 'completed', createdAt: `2026-01-01T00:00:0${id.charCodeAt(0) % 10}.000Z`,
    endedAt: '2026-01-01T00:00:09.000Z', sessionId: `session-${id}`,
    answer: `answer ${id}`, stderr: '', events: [], usage: null, contextUsage: null,
    config: { cwd: dir, modelRoute: 'fixture/model', reasoningEffort: 'default', permissionMode: 'read-only', timeoutSeconds: 1200 },
    ...overrides,
  };
}
function manager(dir, options = {}) {
  return new TaskManager(dir, { launch: () => { throw new Error('should not launch'); }, ...options });
}
function storedTasks(dir) {
  return fs.readdirSync(path.join(dir, 'tasks')).filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, 'tasks', name), 'utf8')))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

test('migrates legacy tasks.json into per-task files and keeps a backup', async t => {
  const dir = directory(t);
  const legacy = [task(dir, 'a'), task(dir, 'b'), task(dir, 'c')];
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(legacy));

  const m = manager(dir);
  t.after(() => m.close());
  assert.equal(m.tasks.length, 3);
  assert.equal(storedTasks(dir).length, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schemaVersion, SCHEMA_VERSION);
  assert.ok(fs.readdirSync(dir).some(name => name.startsWith('tasks.json.bak-')));
  assert.equal(fs.existsSync(path.join(dir, 'tasks.json')), false);
  assert.equal(storedTasks(dir).find(item => item.id === 'a').answer, 'answer a');
});

test('resumes a partially completed migration without overwriting existing task files', async t => {
  const dir = directory(t);
  fs.mkdirSync(path.join(dir, 'tasks'));
  const legacy = [task(dir, 'a', { answer: 'legacy a' }), task(dir, 'b')];
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(dir, 'tasks', 'a.json'), JSON.stringify(task(dir, 'a', { answer: 'existing a' })));

  const m = manager(dir);
  t.after(() => m.close());
  assert.equal(m.tasks.length, 2);
  assert.equal(storedTasks(dir).find(item => item.id === 'a').answer, 'existing a');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).schemaVersion, SCHEMA_VERSION);
});

test('quarantines a corrupt task file and keeps loading the rest', async t => {
  const dir = directory(t);
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(dir, 'tasks', 'bad.json'), '{broken');
  fs.writeFileSync(path.join(dir, 'tasks', 'good.json'), JSON.stringify(task(dir, 'good')));

  const m = manager(dir);
  t.after(() => m.close());
  assert.deepEqual(m.tasks.map(item => item.id), ['good']);
  assert.ok(fs.readdirSync(path.join(dir, 'tasks')).some(name => name.startsWith('bad.json.corrupt-')));
  assert.ok(m.storageWarnings.length >= 1);
});

test('refuses a newer schema without deleting data', async t => {
  const dir = directory(t);
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 3, createdAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(dir, 'tasks', 'a.json'), JSON.stringify(task(dir, 'a')));
  assert.throws(() => manager(dir), /版本过新/);
  assert.equal(fs.existsSync(path.join(dir, 'tasks', 'a.json')), true);
});

test('history pruning deletes old task files instead of rewriting everything', async t => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([task(dir, 'a'), task(dir, 'b'), task(dir, 'c')]));
  const m = manager(dir);
  t.after(() => m.close());
  m.settings({ historyLimit: 1 });
  assert.equal(m.tasks.length, 1);
  assert.equal(storedTasks(dir).length, 1);
});

test('event persistence writes only the changed task file', async t => {
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([task(dir, 'a'), task(dir, 'b')]));
  const m = manager(dir, { persistDelayMs: 20 });
  t.after(() => m.close());
  const beforeB = fs.readFileSync(path.join(dir, 'tasks', 'b.json'), 'utf8');
  m.event(m.get('a'), 'text', 'only a');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.ok(storedTasks(dir).find(item => item.id === 'a').events.some(event => event.text === 'only a'));
  assert.equal(fs.readFileSync(path.join(dir, 'tasks', 'b.json'), 'utf8'), beforeB);
});

test('loads 1000 tasks under three seconds', async t => {
  const dir = directory(t);
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() }));
  for (let i = 0; i < 1000; i++) {
    const id = `task-${i}`;
    fs.writeFileSync(path.join(dir, 'tasks', `${id}.json`), JSON.stringify(task(dir, id, { createdAt: new Date(2026, 0, 1, 0, 0, 0, i).toISOString() })));
  }
  const started = Date.now();
  const m = manager(dir);
  t.after(() => m.close());
  const elapsed = Date.now() - started;
  assert.equal(m.tasks.length, 1000);
  assert.ok(elapsed < 3000, `loading took ${elapsed}ms`);
});
