import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
export const DATA = path.resolve(process.env.DEEPSEEK_MCP_DATA || path.join(os.homedir(), '.dsh', 'deepseek-delegate'));
export const DEFAULTS = {
  executable: '', modelRoute: 'codexauv/deepseek-v4.1-flash', reasoningEffort: 'default',
  cwd: ROOT, reuseSavedAuth: true, timeoutSeconds: 1200,
  permissionMode: 'read-only', maxConcurrent: 1, historyLimit: 1000,
  allowedRoots: [],
  reuseProviders: true, providerConfigPath: path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
};
export function atomicJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`无法读取 ${path.basename(file)}：${e.message}`); }
}
export function parseRoute(route) {
  if (typeof route !== 'string') throw new Error('模型路由必须是 provider/model');
  const i = route.indexOf('/');
  if (i < 1 || !/^[\w.-]+$/.test(route.slice(0, i)) || !route.slice(i + 1).trim() || /[\r\n\0]/.test(route))
    throw new Error('模型路由格式为 provider/model，例如 codexauv/deepseek-v4.1-flash');
  return { provider: route.slice(0, i), model: route.slice(i + 1) };
}
export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象');
  const c = {};
  for (const key of Object.keys(DEFAULTS)) if (Object.hasOwn(input, key)) c[key] = input[key];
  const merged = { ...DEFAULTS, ...c };
  parseRoute(merged.modelRoute);
  if (!['default', 'off', 'low', 'medium', 'high', 'max'].includes(merged.reasoningEffort)) throw new Error('思考强度无效');
  for (const key of ['cwd', 'executable', 'providerConfigPath']) if (typeof merged[key] !== 'string' || /[\0\r\n]/.test(merged[key])) throw new Error(`${key} 路径无效`);
  if (!path.isAbsolute(merged.cwd) || !fs.statSync(merged.cwd).isDirectory()) throw new Error('工作目录必须是存在的绝对路径');
  if (!Array.isArray(merged.allowedRoots)) throw new Error('工作目录允许列表必须是数组');
  merged.allowedRoots = [...new Set(merged.allowedRoots.map(root => {
    if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('工作目录允许列表必须是绝对路径');
    try { if (!fs.statSync(root).isDirectory()) throw new Error(); }
    catch { throw new Error(`工作目录允许列表中的目录不存在：${root}`); }
    return path.resolve(root);
  }))];
  if (typeof merged.reuseSavedAuth !== 'boolean') throw new Error('登录复用设置无效');
  if (typeof merged.reuseProviders !== 'boolean') throw new Error('供应商复用设置无效');
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(merged.permissionMode)) throw new Error('权限模式无效');
  if (!Number.isInteger(merged.timeoutSeconds) || merged.timeoutSeconds < 10 || merged.timeoutSeconds > 3600) throw new Error('超时范围为 10–3600 秒');
  if (!Number.isInteger(merged.maxConcurrent) || merged.maxConcurrent < 1 || merged.maxConcurrent > 4) throw new Error('并发范围为 1–4');
  if (!Number.isInteger(merged.historyLimit) || merged.historyLimit < 0 || merged.historyLimit > 10000) throw new Error('历史保留范围为 0–10000，0 表示不限');
  return merged;
}
export function redact(value) {
  return String(value)
    .replace(/\b(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization|secret)["']?\s*[:=]\s*["']?)[^\s,;"'\r\n}]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
}
