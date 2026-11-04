export const ACTIVE_POLL_MS = 1500;
export const IDLE_POLL_MS = 5000;
export const HIDDEN_POLL_MS = 10000;

export function pollDelay(tasks = [], hidden = false) {
  if (hidden) return HIDDEN_POLL_MS;
  return Array.isArray(tasks) && tasks.some(task => task?.status === 'queued' || task?.status === 'running')
    ? ACTIVE_POLL_MS
    : IDLE_POLL_MS;
}
