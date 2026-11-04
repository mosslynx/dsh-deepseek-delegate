import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { atomicJSON, loadJSON, validateConfig, DEFAULTS, redact } from './config.mjs';
import { buildOverlay, spawnHarness, stopTree } from './harness.mjs';
import { TaskStore } from './store.mjs';

export const ACTIVE = new Set(['queued', 'running']);
export const TASK_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'];
// Only terminal states that never produced a definitive answer may be retried,
// and only when a human asks for it. Nothing retries automatically.
export const RETRYABLE = new Set(['failed', 'interrupted']);
const MAX_OUTPUT = 16 * 1024 * 1024;
const RETRY_REJECT = { queued: '任务还在排队中', running: '任务正在运行中', completed: '任务已完成，请使用续聊', cancelled: '任务已被取消' };
const DEFAULT_RESUME_PROMPT = '继续完成原任务。上次执行因超时中断，请从当前进度继续，不要重复已经完成的工作；完成后给出最终交付说明。';
const USAGE_FIELDS = ['totalTokens', 'inputTokens', 'outputTokens', 'thoughtTokens', 'cachedReadTokens', 'cachedWriteTokens'];
const USAGE_ALIASES = {
  totalTokens: ['totalTokens', 'total_tokens'],
  inputTokens: ['inputTokens', 'input_tokens', 'uncachedInputTokens', 'uncached_input_tokens'],
  outputTokens: ['outputTokens', 'output_tokens'],
  thoughtTokens: ['thoughtTokens', 'thought_tokens', 'reasoningTokens', 'reasoning_tokens'],
  cachedReadTokens: ['cachedReadTokens', 'cached_read_tokens', 'cacheReadTokens', 'cache_read_tokens'],
  cachedWriteTokens: ['cachedWriteTokens', 'cached_write_tokens', 'cacheWriteTokens', 'cache_write_tokens'],
};

// Harness currently forwards ACP usage as camelCase integer token counts. Keep
// this parser deliberately tolerant of partial updates because older/newer
// Harness releases may omit optional counters or wrap usage in another event.
export function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = {};
  for (const key of USAGE_FIELDS) {
    const valueForKey = USAGE_ALIASES[key].map(alias => value[alias]).find(item => item !== undefined);
    if (Number.isSafeInteger(valueForKey) && valueForKey >= 0) usage[key] = valueForKey;
  }
  return Object.keys(usage).length ? usage : null;
}

function addUsage(previous, next) {
  if (!next) return previous || null;
  const usage = {};
  for (const key of USAGE_FIELDS) {
    const a = previous?.[key], b = next[key];
    if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && a + b <= Number.MAX_SAFE_INTEGER) usage[key] = a + b;
    else if (Number.isSafeInteger(b)) usage[key] = b;
    else if (Number.isSafeInteger(a)) usage[key] = a;
  }
  return Object.keys(usage).length ? usage : null;
}

function normalizeContextUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const used = value.used, size = value.size;
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(size) || size < 0) return null;
  return { used, size };
}

// ACP reports totalTokens = inputTokens + outputTokens + cachedReadTokens.
// Keep that raw value, but expose the tokens that are actually new to the model.
export function withBillable(usage) {
  if (!usage) return null;
  const hasBreakdown = Number.isSafeInteger(usage.inputTokens) || Number.isSafeInteger(usage.outputTokens);
  const billableTokens = hasBreakdown
    ? (usage.inputTokens || 0) + (usage.outputTokens || 0)
    : (Number.isSafeInteger(usage.totalTokens) ? usage.totalTokens : null);
  return { ...usage, billableTokens };
}

export class TaskManager extends EventEmitter {
  constructor(dir, { launch = spawnHarness, persistDelayMs = 3000, stopGraceMs = 5000 } = {}) {
    super();
    this.dir = dir; this.launch = launch; this.children = new Map(); this.closing = false;
    this.persistDelayMs = persistDelayMs; this.stopGraceMs = stopGraceMs; this.persistTimer = null;
    fs.mkdirSync(dir, { recursive: true });
    this.config = validateConfig(loadJSON(path.join(dir, 'config.json'), DEFAULTS));
    this.store = new TaskStore(dir);
    this.tasks = this.store.load();
    this.tasks.forEach((task, index) => { if (!Number.isSafeInteger(task.seq)) task.seq = index; });
    this.dirty = new Set();
    const recovered = [];
    for (const t of this.tasks) {
      if (t.usage) t.usage = normalizeUsage(t.usage);
      if (!t.contextUsage) t.contextUsage = null;
      if (!t.errorCode) t.errorCode = null;
      if (!t.partialAnswer) t.partialAnswer = '';
      // Older records predate errorCode; a timeout is recorded as this exact error.
      if (!t.errorCode && t.status === 'failed' && /^运行超时/.test(t.error || '')) t.errorCode = 'timeout';
      if (!ACTIVE.has(t.status)) continue;
      t.status = 'interrupted'; t.errorCode = 'interrupted'; t.error = '服务重启，任务状态不确定。请检查工作目录后再决定是否重新派发。'; t.endedAt = new Date().toISOString();
      recovered.push(t);
    }
    this.pruneHistory();
    this.nextSeq = this.tasks.length ? Math.max(...this.tasks.map(task => task.seq)) + 1 : 0;
    for (const t of recovered) this.store.writeTask(t);
  }
  persist() {
    if (this.persistTimer) { clearTimeout(this.persistTimer); this.persistTimer = null; }
    this.pruneHistory();
    this.store.writeAll(this.tasks);
    this.dirty.clear();
  }
  pruneHistory() {
    // Active tasks and children that are still draining never count against the
    // history limit. Keep the most recently ended tasks, not just newest IDs.
    if (!this.config.historyLimit) return;
    const history = this.tasks.map((task, index) => ({ task, index }))
      .filter(({ task }) => !ACTIVE.has(task.status) && !this.children.has(task.id))
      .sort((a, b) => String(b.task.endedAt || b.task.createdAt).localeCompare(String(a.task.endedAt || a.task.createdAt)) || b.index - a.index);
    const remove = new Set(history.slice(this.config.historyLimit).map(({ task }) => task.id));
    if (!remove.size) return;
    for (const id of remove) this.store.deleteTask(id);
    this.tasks = this.tasks.filter(task => !remove.has(task.id));
  }
  // Event/usage/answer updates are frequent; persist at most once per interval.
  // State transitions still persist immediately through changed().
  schedulePersist(task) {
    if (!task?.id) return;
    this.dirty.add(task.id);
    if (this.closing || this.persistTimer) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; this.flushDirty(); }, this.persistDelayMs);
    this.persistTimer.unref?.();
  }
  flushDirty() {
    for (const id of this.dirty) {
      const task = this.tasks.find(item => item.id === id);
      if (task) this.store.writeTask(task);
    }
    this.dirty.clear();
  }
  changed(t, persist = true) {
    if (persist && t) { this.store.writeTask(t); this.pruneHistory(); }
    this.emit('change', t?.id);
  }
  settings(input) {
    if (!input) return this.config;
    const next = validateConfig({ ...this.config, ...input });
    atomicJSON(path.join(this.dir, 'config.json'), next); this.config = next;
    this.pruneHistory(); this.emit('change'); this.pump(); return next;
  }
  get storageWarnings() { return this.store?.warnings || []; }
  get(id) { const t = this.tasks.find(t => t.id === id); if (!t) throw new Error('任务不存在'); return t; }
  list() { return [...this.tasks].reverse().map(t => this.taskSummary(t)); }
  taskSummary(task) {
    const { events, answer, stderr, prompt, ...t } = this.publicTask(task);
    return { ...t, prompt: prompt.slice(0, 500), promptTruncated: prompt.length > 500, preview: (answer || '').slice(0, 140) };
  }
  listPage({ limit = 50, offset = 0, status } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('每页条数范围为 1–100');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页偏移必须是非负整数');
    if (status !== undefined && !TASK_STATUSES.includes(status)) throw new Error('任务状态无效');
    const matches = [...this.tasks].reverse().filter(task => status === undefined || task.status === status);
    const tasks = matches.slice(offset, offset + limit).map(task => this.taskSummary(task));
    const hasMore = offset + tasks.length < matches.length;
    return { tasks, total: matches.length, limit, offset, hasMore, nextOffset: hasMore ? offset + tasks.length : null };
  }
  usageSummary() {
    const totals = Object.fromEntries(USAGE_FIELDS.map(key => [key, 0]));
    let reportedTaskCount = 0, billableTokens = 0;
    for (const task of this.tasks) {
      if (!task.usage) continue;
      reportedTaskCount++;
      const usage = withBillable(task.usage);
      if (Number.isSafeInteger(usage.billableTokens)) billableTokens += usage.billableTokens;
      for (const key of USAGE_FIELDS) if (Number.isSafeInteger(task.usage[key])) totals[key] += task.usage[key];
    }
    return { taskCount: this.tasks.length, reportedTaskCount, ...totals, billableTokens };
  }
  delegate(input) {
    if (this.closing) throw new Error('服务正在关闭');
    const { prompt, continueTaskId } = input;
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 65536) throw new Error('请输入任务，最大 64 KiB');
    if (input.cwd !== undefined && (typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd))) throw new Error('工作目录必须是绝对路径');
    if (continueTaskId !== undefined && (typeof continueTaskId !== 'string' || !continueTaskId)) throw new Error('续聊任务 ID 无效');
    if (input.reasoningEffort !== undefined && !['default', 'off', 'low', 'medium', 'high', 'max'].includes(input.reasoningEffort)) throw new Error('思考强度无效');
    if (input.timeoutSeconds !== undefined && (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 10 || input.timeoutSeconds > 3600)) throw new Error('超时范围为 10–3600 秒');
    let idempotencyKeyHash, requestFingerprint;
    if (input.idempotencyKey !== undefined) {
      if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) throw new Error('幂等键必须是 1–128 位字母、数字或 . _ : -');
      const hash = text => createHash('sha256').update(text).digest('hex');
      idempotencyKeyHash = hash(input.idempotencyKey);
      requestFingerprint = hash(JSON.stringify({ prompt, cwd: input.cwd === undefined ? null : path.resolve(input.cwd), continueTaskId: continueTaskId ?? null, reasoningEffort: input.reasoningEffort ?? null, timeoutSeconds: input.timeoutSeconds ?? null }));
      // Compare the submitted arguments before resolving current defaults or
      // checking capacity: a transport retry must still find the original task
      // after a settings change, or while the queue is full.
      const existing = this.tasks.find(task => task.idempotencyKeyHash === idempotencyKeyHash);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new Error('幂等键已用于不同的任务参数，请更换 idempotencyKey');
        return this.publicTask(existing);
      }
    }
    this.assertCapacity();
    const config = validateConfig({
      ...this.config,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {}),
      ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {}),
    });
    this.assertAllowedCwd(config.cwd);
    let sessionId;
    if (continueTaskId) {
      const parent = this.get(continueTaskId);
      if (parent.status !== 'completed' || !parent.sessionId) throw new Error('只能续聊已完成且有会话 ID 的任务');
      if (path.resolve(parent.cwd).toLowerCase() !== path.resolve(config.cwd).toLowerCase()) throw new Error('续聊必须使用原任务的工作目录');
      if (parent.modelRoute !== config.modelRoute) throw new Error('续聊必须使用原任务的模型路由');
      if (this.tasks.some(t => ACTIVE.has(t.status) && t.sessionId === parent.sessionId)) throw new Error('此会话已有未结束任务');
      sessionId = parent.sessionId;
    }
    const t = this.create({ prompt, config, sessionId, continueTaskId: continueTaskId || null, idempotencyKeyHash, requestFingerprint });
    return this.publicTask(t);
  }
  // Resume a session whose process was killed by a timeout or a service restart.
  // The original record is never mutated; the continuation is a new task linked
  // through continueTaskId, exactly like a completed-task continuation.
  resume(id, input = {}) {
    if (this.closing) throw new Error('服务正在关闭');
    const source = this.get(id);
    if (!this.isResumable(source)) {
      const reason = source.status === 'completed' ? '任务已完成，请使用续聊'
        : source.status === 'cancelled' ? '任务已取消'
        : '只有超时或中断的任务可以续跑';
      throw new Error(reason);
    }
    if (input.prompt !== undefined && (typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 65536)) throw new Error('请输入续跑提示，最大 64 KiB');
    if (input.timeoutSeconds !== undefined && (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 10 || input.timeoutSeconds > 3600)) throw new Error('超时范围为 10–3600 秒');
    const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt : DEFAULT_RESUME_PROMPT;
    const baseConfig = source.config || this.config;
    const timeoutSeconds = input.timeoutSeconds ?? baseConfig.timeoutSeconds ?? this.config.timeoutSeconds;
    this.assertAllowedCwd(source.cwd);
    let idempotencyKeyHash, requestFingerprint;
    if (input.idempotencyKey !== undefined) {
      if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) throw new Error('幂等键必须是 1–128 位字母、数字或 . _ : -');
      const hash = text => createHash('sha256').update(text).digest('hex');
      idempotencyKeyHash = hash(input.idempotencyKey);
      requestFingerprint = hash(JSON.stringify({ prompt, cwd: path.resolve(source.cwd), continueTaskId: source.id, reasoningEffort: baseConfig.reasoningEffort, timeoutSeconds }));
      const existing = this.tasks.find(task => task.idempotencyKeyHash === idempotencyKeyHash);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new Error('幂等键已用于不同的任务参数，请更换 idempotencyKey');
        return this.publicTask(existing);
      }
    }
    this.assertCapacity();
    if (this.tasks.some(t => ACTIVE.has(t.status) && t.sessionId === source.sessionId)) throw new Error('此会话已有未结束任务');
    const config = validateConfig({ ...baseConfig, timeoutSeconds });
    const t = this.create({
      prompt, config, sessionId: source.sessionId, continueTaskId: source.id,
      idempotencyKeyHash, requestFingerprint,
    });
    return this.publicTask(t);
  }
  // A manual retry is a brand-new execution attempt: it copies the recorded
  // execution snapshot of the failed task, never inherits its session, and
  // leaves the original record untouched so history stays auditable.
  retry(id) {
    if (this.closing) throw new Error('服务正在关闭');
    const source = this.get(id);
    if (!RETRYABLE.has(source.status)) {
      throw new Error(`只有失败或已中断的任务可以重试（当前状态：${RETRY_REJECT[source.status] || source.status}）`);
    }
    this.assertCapacity();
    const config = validateConfig(source.config);
    this.assertAllowedCwd(config.cwd);
    const t = this.create({
      prompt: source._prompt ?? source.prompt, config,
      sessionId: null, continueTaskId: null,
      retryOf: source.id, attempt: (source.attempt || 1) + 1,
    });
    return this.publicTask(t);
  }
  assertCapacity() {
    if (this.tasks.filter(t => ACTIVE.has(t.status)).length >= 100) throw new Error('任务队列已满');
  }
  assertAllowedCwd(cwd) {
    const roots = this.config.allowedRoots || [];
    if (!roots.length) return;
    const target = path.resolve(cwd).toLowerCase();
    const allowed = roots.some(root => {
      const base = path.resolve(root).toLowerCase();
      return target === base || target.startsWith(base.endsWith(path.sep) ? base : `${base}${path.sep}`);
    });
    if (!allowed) throw new Error('工作目录不在允许范围内');
  }
  create({ prompt, config, sessionId = null, continueTaskId = null, retryOf = null, attempt = 1, idempotencyKeyHash, requestFingerprint }) {
    const t = { id: randomUUID(), seq: this.nextSeq++, prompt: redact(prompt), cwd: config.cwd, modelRoute: config.modelRoute,
      reasoningEffort: config.reasoningEffort,
      permissionMode: config.permissionMode, status: 'queued', createdAt: new Date().toISOString(),
      continueTaskId, sessionId, answer: '', stderr: '', events: [], config,
      exitCode: null, error: null, errorCode: null, partialAnswer: '', usage: null, contextUsage: null, retryOf, attempt,
      ...(idempotencyKeyHash ? { idempotencyKeyHash, requestFingerprint } : {}) };
    // Keep the literal prompt only in memory until delivered; persisted task records are redacted.
    Object.defineProperty(t, '_prompt', { value: prompt, configurable: true });
    this.tasks.push(t);
    try { this.changed(t); }
    catch (e) { this.tasks = this.tasks.filter(task => task.id !== t.id); throw e; }
    queueMicrotask(() => this.pump());
    return t;
  }
  isResumable(t) {
    return Boolean(t.sessionId) && (t.status === 'interrupted' || (t.status === 'failed' && t.errorCode === 'timeout'));
  }
  publicTask(t) {
    const { config, idempotencyKeyHash, requestFingerprint, seq, ...visible } = t;
    return {
      ...visible,
      timeoutSeconds: config?.timeoutSeconds ?? this.config.timeoutSeconds,
      errorCode: t.errorCode || null,
      partialAnswer: t.partialAnswer || '',
      usage: withBillable(t.usage),
      resumable: this.isResumable(t),
    };
  }
  progressView(t, includeLogs = false) {
    const queued = this.tasks.filter(task => task.status === 'queued');
    const started = t.startedAt ? Date.parse(t.startedAt) : NaN;
    const ended = t.endedAt ? Date.parse(t.endedAt) : Date.now();
    return {
      id: t.id, status: t.status, answer: t.answer, partialAnswer: t.partialAnswer || '',
      error: t.error, errorCode: t.errorCode || null,
      usage: withBillable(t.usage), contextUsage: t.contextUsage || null,
      resumable: this.isResumable(t),
      progress: {
        eventCount: t.events.length,
        latestEvent: t.events.at(-1) || null,
        queuePosition: t.status === 'queued' ? queued.findIndex(task => task.id === t.id) + 1 : null,
        elapsedSeconds: Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 1000)) : 0,
        timeoutSeconds: t.config?.timeoutSeconds ?? this.config.timeoutSeconds,
      },
      ...(includeLogs ? { events: t.events, stderr: t.stderr } : {}),
    };
  }
  event(t, type, text) {
    t.events.push({ at: new Date().toISOString(), type, text: redact(text).slice(0, 4000) });
    if (t.events.length > 250) t.events.shift();
    this.schedulePersist(t);
    this.emit('change', t.id);
  }
  pump() {
    if (this.closing) return;
    for (const t of this.tasks) {
      if (this.children.size >= this.config.maxConcurrent) break;
      if (t.status === 'queued') this.run(t);
    }
  }
  run(t) {
    t.status = 'running'; t.startedAt = new Date().toISOString();
    const overlayPath = path.join(this.dir, `${t.id}.patch.json`);
    let child;
    try {
      atomicJSON(overlayPath, buildOverlay(t.config));
      child = this.launch(t.config, overlayPath, t.sessionId);
    } catch (e) {
      t.status = 'failed'; t.errorCode = 'spawn'; t.error = redact(e.message); t.endedAt = new Date().toISOString(); this.changed(t);
      fs.rmSync(overlayPath, { force: true }); queueMicrotask(() => this.pump()); return;
    }
    this.children.set(t.id, child); this.changed(t);
    let line = '', bytes = 0, errBytes = 0, completed = false, final = '', failure = '', stopReason, forceTimer;
    const decoder = new StringDecoder('utf8'); const errDecoder = new StringDecoder('utf8');
    const stop = (reason, graceful = false) => {
      if (stopReason) return;
      stopReason = reason;
      stopTree(child, { force: !graceful });
      if (graceful) forceTimer = setTimeout(() => stopTree(child, { force: true }), this.stopGraceMs);
    };
    child._stop = stop;
    const handleLine = raw => {
      raw = raw.replace(/\r$/, ''); if (!raw.trim()) return;
      let ev;
      try { ev = JSON.parse(raw); } catch {
        const trimmed = raw.trimStart();
        const looksLikeJson = trimmed.startsWith('{') || /^\[\s*[{"]/.test(trimmed);
        if (looksLikeJson) {
          failure ||= `CLI 输出不是有效 JSON：${redact(raw).slice(0, 600)}`;
        } else {
          // Harness may print banners/logs to stdout before the JSON stream.
          // Keep them as diagnostics instead of failing the whole task.
          t.stderr = (t.stderr + `\n[stdout] ${redact(raw).slice(0, 600)}`).slice(-8192);
        }
        return;
      }
      if (!ev || typeof ev !== 'object') { failure ||= 'CLI 返回无效事件'; return; }
      if (ev.type === 'session') t.sessionId = ev.sessionId || ev.session_id || t.sessionId;
      const usageEvent = ev.usage ?? ev.result?.usage ?? ev.data?.usage ?? ev.update?.usage ?? ev.reason?.usage ?? ev.event?.usage ?? (ev.type === 'usage' ? ev : null);
      const usage = normalizeUsage(usageEvent);
      if (usage) { t.usage = addUsage(t.usage, usage); this.schedulePersist(t); this.emit('change', t.id); }
      const contextUsage = normalizeContextUsage(ev.sessionUpdate === 'usage_update' || ev.type === 'usage_update' ? ev : null);
      if (contextUsage) { t.contextUsage = contextUsage; this.schedulePersist(t); this.emit('change', t.id); }
      if (ev.type === 'text') this.event(t, 'text', ev.text || '');
      if (ev.type === 'tool_call') this.event(t, 'tool', ev.name || ev.toolName || ev.tool?.name || '工具调用');
      if (ev.type === 'status') {
        this.event(t, 'status', [ev.phase, ev.step ? `step ${ev.step}` : '', ev.reason?.kind].filter(Boolean).join(' '));
        if (ev.phase === 'turn_end' && ev.reason?.kind === 'completed') completed = true;
        if (ev.phase === 'turn_end' && ev.reason?.kind === 'error') failure ||= ev.reason.error?.message || 'Harness 执行失败';
      }
      if (ev.type === 'final') {
        if (typeof ev.text !== 'string') failure ||= 'CLI final 事件没有文本';
        else if (Buffer.byteLength(ev.text) > 262144) failure ||= '最终回答超过 256 KiB';
        else { final = redact(ev.text); t.answer = final; this.schedulePersist(t); this.emit('change', t.id); }
      }
      if (ev.type === 'error') failure ||= ev.message || ev.error?.message || 'CLI 返回错误';
    };
    const consume = data => {
      line += data;
      let pos;
      while ((pos = line.indexOf('\n')) >= 0) { handleLine(line.slice(0, pos)); line = line.slice(pos + 1); }
    };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) { stop('输出超过 16 MiB'); return; }
      consume(decoder.write(chunk));
    });
    child.stderr.on('data', chunk => {
      errBytes += chunk.length;
      t.stderr = (t.stderr + redact(errDecoder.write(chunk))).slice(-8192);
      if (errBytes > 2 * 1024 * 1024) stop('错误日志超过 2 MiB');
    });
    child.on('error', e => { failure ||= e.message; });
    child.stdin.on('error', e => { if (e.code !== 'EPIPE') failure ||= e.message; });
    const timeout = setTimeout(() => { t.errorCode = 'timeout'; stop('运行超时', true); }, t.config.timeoutSeconds * 1000);
    child.once('close', (code, signal) => {
      clearTimeout(timeout); if (forceTimer) clearTimeout(forceTimer);
      consume(decoder.end()); if (line) handleLine(line);
      t.stderr = redact(t.stderr + errDecoder.end()).slice(-8192);
      t.exitCode = code; t.signal = signal; t.endedAt = new Date().toISOString();
      if (t.status === 'interrupted' || t.errorCode === 'timeout') {
        const last = [...t.events].reverse().find(event => event.type === 'text' && event.text.trim());
        if (last) t.partialAnswer = last.text.slice(0, 8192);
      }
      if (t.status === 'cancelled' || t.status === 'interrupted') { /* Preserve intentional terminal status. */ }
      else if (stopReason || failure || code !== 0 || !completed || !final.trim()) {
        t.status = 'failed';
        t.error = redact(stopReason || failure || (code !== 0 ? `CLI 退出码 ${code}${signal ? ` (${signal})` : ''}` : !completed ? 'CLI 退出前未收到完成事件' : 'CLI 返回空回答'));
        if (t.stderr.trim()) t.error += `\n${t.stderr}`;
      } else { t.status = 'completed'; t.error = null; }
      this.children.delete(t.id); fs.rmSync(overlayPath, { force: true }); this.changed(t); this.pump();
    });
    child.stdin.end(t._prompt ?? t.prompt);
    delete t._prompt;
  }
  cancel(id) {
    const t = this.get(id);
    if (!ACTIVE.has(t.status)) return this.publicTask(t);
    t.status = 'cancelled'; t.errorCode = 'cancelled'; t.endedAt = new Date().toISOString(); t.error = '任务已取消';
    this.children.get(id)?._stop('任务已取消'); delete t._prompt; this.changed(t); return this.publicTask(t);
  }
  async wait(id, timeoutMs = 10000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) throw new Error('等待时间范围为 0–30000 毫秒');
    const t = this.get(id);
    if (!ACTIVE.has(t.status) || timeoutMs === 0) return this.publicTask(t);
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.off('change', onChange); resolve(); };
      const onChange = changedId => { if (changedId === id && !ACTIVE.has(t.status)) done(); };
      const timer = setTimeout(done, timeoutMs); this.on('change', onChange);
    });
    return this.publicTask(t);
  }
  async close() {
    this.closing = true;
    const children = [...this.children.values()];
    const drained = Promise.all(children.map(child => new Promise(resolve => child.once('close', resolve))));
    for (const t of this.tasks) if (ACTIVE.has(t.status)) {
      t.status = 'interrupted'; t.errorCode = 'interrupted'; t.error = '服务已关闭，请检查任务结果后再决定是否重新派发。'; t.endedAt = new Date().toISOString();
      this.children.get(t.id)?._stop('服务已关闭');
    }
    this.persist();
    await drained;
    this.persist();
  }
}
