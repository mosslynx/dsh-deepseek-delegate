import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_POLL_MS, IDLE_POLL_MS, HIDDEN_POLL_MS, pollDelay } from '../src/ui/poll.mjs';

test('pollDelay uses the active interval while tasks are queued or running', () => {
  assert.equal(pollDelay([{ status: 'completed' }, { status: 'running' }]), ACTIVE_POLL_MS);
  assert.equal(pollDelay([{ status: 'queued' }]), ACTIVE_POLL_MS);
});

test('pollDelay backs off to the idle interval for terminal tasks', () => {
  assert.equal(pollDelay([]), IDLE_POLL_MS);
  assert.equal(pollDelay([{ status: 'completed' }, { status: 'failed' }, { status: 'cancelled' }]), IDLE_POLL_MS);
  assert.equal(pollDelay(), IDLE_POLL_MS);
});

test('pollDelay never schedules network polling while the page is hidden', () => {
  assert.equal(pollDelay([{ status: 'running' }], true), HIDDEN_POLL_MS);
});
