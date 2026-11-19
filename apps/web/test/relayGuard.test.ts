// WizardConnect reconnects with no delay when a relay is unreachable; the guard spaces it out.
import { describe, expect, it, vi } from 'vitest';
import { installRelayGuard, nextConnect, MAX_DELAY_MS, STABLE_MS } from '../src/lib/relayGuard';

describe('nextConnect', () => {
  it('lets the first connect and one after a stable minute through at once', () => {
    expect(nextConnect(undefined, 1000).delay).toBe(0);
    const s = nextConnect(undefined, 0).state;
    expect(nextConnect(s, STABLE_MS).delay).toBe(0);
  });

  it('backs off quick repeats 1 s, 2 s, 4 s … up to 30 s', () => {
    let state = nextConnect(undefined, 0).state;
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = nextConnect(state, state.lastStart + 10); // the relay closed almost at once
      delays.push(r.delay);
      state = r.state;
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, MAX_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS]);
  });
});

describe('installRelayGuard', () => {
  class FakeClient {
    connects = 0;
    async connect() { this.connects++; }
    async disconnect() {}
  }

  it('turns a tight reconnect loop into a few attempts', async () => {
    vi.useFakeTimers();
    installRelayGuard(FakeClient);
    const c = new FakeClient();
    let stop = false;
    const loop = (async () => { while (!stop) await c.connect(); })(); // what the library does when a relay is down
    await vi.advanceTimersByTimeAsync(20_000);
    stop = true;
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
    await loop;
    vi.useRealTimers();
    expect(c.connects).toBeLessThanOrEqual(6); // 0 + 1 + 2 + 4 + 8 s fit in 20 s
  });

  it('drops a delayed connect when the session is disconnected meanwhile', async () => {
    vi.useFakeTimers();
    installRelayGuard(FakeClient);
    const c = new FakeClient();
    await c.connect(); // immediate
    const second = c.connect(); // delayed by 1 s
    await c.disconnect();
    await vi.advanceTimersByTimeAsync(2000);
    await second;
    vi.useRealTimers();
    expect(c.connects).toBe(1);
  });
});
