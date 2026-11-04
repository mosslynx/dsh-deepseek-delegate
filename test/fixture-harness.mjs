const mode = process.argv[2];
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
const emit = object => process.stdout.write(JSON.stringify(object) + '\n');
// A continuation passes the session id back as argv[3]. Without it every
// process reports its own id, so tests can tell a fresh attempt from a resume.
emit({ type: 'session', sessionId: process.argv[3] || `fixture-session-${process.pid}-${Date.now().toString(36)}` });
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'hang-text') {
  emit({ type: 'text', text: 'partial output before timeout' });
  setInterval(() => {}, 1000);
}
else if (mode === 'error') {
  emit({ type: 'status', phase: 'turn_end', reason: { kind: 'error', error: { message: 'provider rejected' } } });
  emit({ type: 'final', text: '' });
  setTimeout(() => { process.stderr.write('late diagnostic'); process.exitCode = 1; }, 50);
} else if (mode === 'incomplete') {
  emit({ type: 'final', text: 'plausible answer without completion' });
} else if (mode === 'usage' || mode === 'usage-nested' || mode === 'usage-real' || mode === 'usage-context' || mode === 'usage-invalid') {
  emit({ type: 'text', text: '正在处理中文 🐳' });
  const usage = { totalTokens: 1234, inputTokens: 900, outputTokens: 334, thoughtTokens: 80, cachedReadTokens: 12, cachedWriteTokens: 4 };
  const status = { type: 'status', phase: 'turn_end', reason: { kind: 'completed' } };
  if (mode === 'usage') status.usage = usage;
  if (mode === 'usage-nested') status.data = { usage };
  if (mode === 'usage-real') {
    emit({ type: 'status', phase: 'step_end', usage: { uncachedInputTokens: 100, outputTokens: 50, totalTokens: 170, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 10 } });
    emit({ type: 'status', phase: 'step_end', usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 2 } });
  }
  if (mode === 'usage-context') emit({ sessionUpdate: 'usage_update', used: 1234, size: 128000 });
  if (mode === 'usage-invalid') status.usage = { totalTokens: '1234', inputTokens: -1, outputTokens: null };
  emit(status);
  emit({ type: 'final', text: `answer:${prompt}` });
} else {
  emit({ type: 'text', text: '正在处理中文 🐳' });
  emit({ type: 'status', phase: 'turn_end', reason: { kind: 'completed' } });
  emit({ type: 'final', text: `answer:${prompt}` });
}
