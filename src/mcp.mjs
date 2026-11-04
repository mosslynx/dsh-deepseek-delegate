import readline from 'node:readline';
import { TOOLS } from './protocol.mjs';
import { redact, VERSION } from './config.mjs';
import { request, ensureServer } from './client.mjs';

export function serveStdio(runtime) {
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = obj => process.stdout.write(JSON.stringify(obj) + '\n');
  let protocolVersion = '2025-11-25';
  lines.on('line', async line => {
    let msg;
    try { msg = JSON.parse(line); }
    catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      write({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid request' } }); return;
    }
    if (!Object.hasOwn(msg, 'id')) return;
    const result = value => write({ jsonrpc: '2.0', id: msg.id, result: value });
    try {
      switch (msg.method) {
        case 'initialize': {
          const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
          protocolVersion = supported.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : '2025-11-25';
          return result({ protocolVersion,
            capabilities: { tools: {} }, serverInfo: { name: 'deepseek-delegate', version: VERSION },
            instructions: 'DeepSeek Harness (DSH) task queue. When the user asks for this plugin, DSH, or the Harness sidebar task list, call the tool from this server (Codex names it mcp__deepseek_delegate__delegate_to_deepseek). Other MCP servers, including codex_plus_collaboration, expose similarly named tools (for example their own delegate_to_deepseek) that do not create, read or cancel tasks here. Use delegate_to_deepseek, then wait_task until terminal status; wait_task returns concise progress and the answer, while get_task returns full diagnostics. A timed-out task (errorCode=timeout) or an interrupted task with a session can be resumed with resume_task; cancelled and ordinary failed tasks cannot. Use retry_task only for a fresh attempt. Nothing is retried automatically. Manage settings in the DeepSeek Harness sidebar. Harness must be running with dsh-deepseek-delegate enabled.' });
        }
        case 'ping': return result({});
        case 'tools/list': return result({ tools: protocolVersion >= '2025-06-18' ? TOOLS : TOOLS.map(({ outputSchema, ...tool }) => tool) });
        case 'tools/call': {
          try {
            const activeRuntime = runtime || await ensureServer();
            const value = await request(activeRuntime, '/api/tool', { name: msg.params?.name, arguments: msg.params?.arguments || {} });
            return result({ content: [{ type: 'text', text: JSON.stringify(value) }],
              ...(protocolVersion >= '2025-06-18' ? { structuredContent: value } : {}) });
          } catch (e) { return result({ isError: true, content: [{ type: 'text', text: redact(e.message) }] }); }
        }
        default: write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
      }
    } catch (e) { write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: redact(e.message) } }); }
  });
}
