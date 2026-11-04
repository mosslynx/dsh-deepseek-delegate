import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../src/config.mjs';
import { ensureServer, request } from '../src/client.mjs';
import { TOOLS } from '../src/protocol.mjs';

// This uses the real configured provider. Prompts request no tools or file access.
const runtime = await ensureServer();
const state = await request(runtime, '/api/state');
console.log(`Testing real Harness plugin: ${state.config.modelRoute}`);
const desktop = await fetch(runtime.origin + '/api/state', {
  headers: { Origin: 'dsh-app://app', Authorization: `Bearer ${runtime.token}` },
});
assert.equal(desktop.status, 200, 'Desktop application origin must reach the plugin');
assert.equal(desktop.headers.get('access-control-allow-origin'), 'dsh-app://app');

const bridge = spawn(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'mcp'], {
  cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map(); let sequence = 0, stderr = '';
bridge.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
const lines = readline.createInterface({ input: bridge.stdout });
lines.on('line', line => {
  const message = JSON.parse(line), waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); waiter.resolve(message); }
});
bridge.on('error', fail);
bridge.on('close', code => fail(new Error(`MCP bridge exited (${code}): ${stderr}`)));
function fail(error) { for (const p of pending.values()) p.reject(error); pending.clear(); }
function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}`)); }, 40000);
    pending.set(id, { resolve: message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }, reject: error => { clearTimeout(timer); reject(error); } });
    bridge.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
async function tool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  assert.equal(result.isError, undefined, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}
async function completed(id) {
  const deadline = Date.now() + (state.config.timeoutSeconds + 30) * 1000;
  while (Date.now() < deadline) {
    const task = await tool('wait_task', { taskId: id, timeoutMs: 30000 });
    if (['running', 'queued'].includes(task.status)) continue;
    assert.equal(task.status, 'completed', task.error || task.stderr);
    return task;
  }
  throw new Error('Task exceeded smoke test deadline');
}
const owned = new Set();
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-smoke', version: '1.0.0' } });
  assert.equal(init.serverInfo.name, 'deepseek-delegate');
  const tools = await rpc('tools/list', {}); assert.equal(tools.tools.length, TOOLS.length);
  const nonce = randomBytes(8).toString('hex');
  const first = await tool('delegate_to_deepseek', { prompt: `这是连通性测试。不要调用工具，不要读取或修改文件。请记住口令 ${nonce}，只回复 DEEPSEEK_PLUGIN_OK。` });
  owned.add(first.id);
  const answer = await completed(first.id);
  const firstFull = await tool('get_task', { taskId: first.id });
  assert.match(answer.answer, /DEEPSEEK_PLUGIN_OK/); assert.ok(firstFull.sessionId);
  console.log(`PASS: MCP delegation completed (${answer.id})`);
  const follow = await tool('delegate_to_deepseek', { prompt: '不要调用工具，不要读取或修改文件。上一条消息要求你记住的口令是什么？只回复口令。', cwd: firstFull.cwd, continueTaskId: answer.id });
  owned.add(follow.id);
  const continued = await completed(follow.id);
  const continuedFull = await tool('get_task', { taskId: continued.id });
  assert.equal(continuedFull.sessionId, firstFull.sessionId); assert.ok(continued.answer.includes(nonce), 'Native session must remember the first turn');
  console.log(`PASS: native session continuation (${continued.id})`);
  const cancel = await tool('delegate_to_deepseek', { prompt: '取消测试。不要调用工具，不要读取或修改文件。请解释二分查找。' });
  owned.add(cancel.id);
  const cancelled = await tool('cancel_task', { taskId: cancel.id });
  assert.equal(cancelled.status, 'cancelled');
  const listed = await tool('list_tasks'); assert.ok(listed.tasks.some(t => t.id === cancel.id));
  console.log(`PASS: cancellation and shared UI/MCP task list (${cancel.id})`);
} finally {
  for (const id of owned) {
    try { const task = await tool('get_task', { taskId: id }); if (['queued', 'running'].includes(task.status)) await tool('cancel_task', { taskId: id }); } catch { /* best-effort cleanup only for this run's tasks */ }
  }
  bridge.stdin.end(); lines.close();
}
