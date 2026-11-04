import fs from 'node:fs';
import path from 'node:path';
import { atomicJSON } from './config.mjs';

export const SCHEMA_VERSION = 2;
const SAFE_ID = /^[\w-]+$/;

/**
 * Task storage: one JSON file per task plus a small schema-versioned meta file.
 * The legacy tasks.json is only a migration source and is renamed after a
 * successful migration; it is never written again.
 */
export class TaskStore {
  constructor(dir) {
    this.dir = dir;
    this.tasksDir = path.join(dir, 'tasks');
    this.metaPath = path.join(dir, 'meta.json');
    this.legacyPath = path.join(dir, 'tasks.json');
    this.warnings = [];
  }

  taskPath(id) { return path.join(this.tasksDir, `${id}.json`); }
  isSafeId(id) { return typeof id === 'string' && SAFE_ID.test(id); }

  load() {
    fs.mkdirSync(this.tasksDir, { recursive: true });
    let meta = this.readMeta();
    if (meta && meta.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`任务数据版本过新（schemaVersion=${meta.schemaVersion}），请升级插件`);
    }
    if (!meta) {
      if (fs.existsSync(this.legacyPath)) this.migrateLegacy();
      else this.writeMeta({});
    } else if (meta.schemaVersion < SCHEMA_VERSION) {
      this.writeMeta({});
    }
    return this.readTasks();
  }

  readMeta() {
    let raw;
    try { raw = fs.readFileSync(this.metaPath, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    try {
      const meta = JSON.parse(raw);
      if (!meta || typeof meta !== 'object' || !Number.isSafeInteger(meta.schemaVersion)) throw new Error('invalid meta');
      return meta;
    } catch {
      this.quarantine(this.metaPath, 'corrupt');
      return null;
    }
  }

  writeMeta(extra = {}) {
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(this.metaPath, 'utf8')); } catch { previous = null; }
    atomicJSON(this.metaPath, {
      schemaVersion: SCHEMA_VERSION,
      createdAt: previous?.createdAt || new Date().toISOString(),
      ...extra,
    });
  }

  migrateLegacy() {
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8')); }
    catch (e) { throw new Error(`无法读取旧任务文件：${e.message}`); }
    if (!Array.isArray(legacy)) throw new Error('旧任务文件不是数组');
    legacy.forEach((task, index) => {
      if (!task || typeof task !== 'object' || !this.isSafeId(task.id)) {
        this.warnings.push(`跳过无法迁移的任务记录：${task?.id || 'unknown'}`);
        return;
      }
      if (!Number.isSafeInteger(task.seq)) task.seq = index;
      const file = this.taskPath(task.id);
      if (!fs.existsSync(file)) atomicJSON(file, task);
    });
    this.writeMeta({ migratedAt: new Date().toISOString() });
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Date.now()}`;
    try { fs.renameSync(this.legacyPath, `${this.legacyPath}.bak-${stamp}`); }
    catch (e) { this.warnings.push(`旧任务文件备份失败：${e.message}`); }
  }

  readTasks() {
    const tasks = [];
    const seen = new Set();
    for (const name of fs.readdirSync(this.tasksDir).sort()) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      const file = path.join(this.tasksDir, name);
      if (!this.isSafeId(id)) { this.quarantine(file, 'bad-name'); continue; }
      let task;
      try { task = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { this.quarantine(file, 'corrupt'); continue; }
      if (!task || typeof task !== 'object' || task.id !== id) { this.quarantine(file, 'invalid'); continue; }
      if (seen.has(id)) { this.quarantine(file, 'duplicate'); continue; }
      seen.add(id);
      tasks.push(task);
    }
    // File names are UUIDs; creation order must come from the records so the
    // queue and pagination keep their previous behavior. seq is assigned on
    // create/migration; the timestamp/id fallback covers older files.
    const order = task => Number.isSafeInteger(task.seq) ? task.seq : Number.MAX_SAFE_INTEGER;
    tasks.sort((a, b) => order(a) - order(b)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
      || String(a.id).localeCompare(String(b.id)));
    return tasks;
  }

  quarantine(file, reason) {
    const target = `${file}.${reason}-${Date.now()}`;
    try {
      fs.renameSync(file, target);
      this.warnings.push(`已隔离损坏的任务文件：${path.basename(file)} -> ${path.basename(target)}`);
    } catch { /* best effort: keep the original if it cannot be moved */ }
  }

  writeTask(task) {
    if (!task || !this.isSafeId(task.id)) throw new Error('任务 ID 无效，无法写入');
    atomicJSON(this.taskPath(task.id), task);
  }

  writeAll(tasks) {
    this.writeMeta({});
    tasks.forEach((task, index) => {
      if (!Number.isSafeInteger(task.seq)) task.seq = index;
      this.writeTask(task);
    });
  }

  deleteTask(id) {
    if (!this.isSafeId(id)) return;
    try { fs.rmSync(this.taskPath(id), { force: true }); } catch { /* already gone */ }
  }
}
