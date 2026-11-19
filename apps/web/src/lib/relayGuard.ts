// Spaces out WizardConnect relay reconnects.
//
// In @wizardconnect/core (0.2.3 through 0.2.11, checked 2026-11-19), when a relay can't be reached
// the subscription closes ("Subscription closed") and the connection manager calls connect() again
// at once: its reconnectInterval only applies when connect() throws, and it never does. Against an
// unreachable relay that is about 2,000 reconnects a second (41,940 in 20 s in a local repro), which
// drains a judge's phone while the tab is open. This wraps RelayClient.connect so quick repeats back
// off (1 s, 2 s, 4 s … 30 s). The first connect, and one after a stable minute, go straight through.
// A disconnect() while a delayed connect waits cancels it, so a closed session stays closed.
import { RelayClient } from '@wizardconnect/core';

/** A connect this soon after the previous one counts as a failed attempt. */
export const QUICK_RETRY_MS = 15_000;
/** After this long without a reconnect, the next one starts from scratch. */
export const STABLE_MS = 60_000;
export const MAX_DELAY_MS = 30_000;

export interface GuardState {
  lastStart: number;
  failures: number;
}

/** How long to wait before this connect, and the state after it starts. Pure, for tests. */
export function nextConnect(state: GuardState | undefined, now: number): { delay: number; state: GuardState } {
  if (!state || now - state.lastStart >= STABLE_MS) return { delay: 0, state: { lastStart: now, failures: 0 } };
  const failures = now - state.lastStart < QUICK_RETRY_MS ? state.failures + 1 : 0;
  const delay = failures === 0 ? 0 : Math.min(MAX_DELAY_MS, 1000 * 2 ** (failures - 1));
  return { delay, state: { lastStart: now + delay, failures } };
}

type Connect = (...args: unknown[]) => Promise<void>;
const GUARDED = Symbol.for('hongbao.relayGuard');

export function installRelayGuard(Client: { prototype: object } = RelayClient): void {
  const proto = Client.prototype as Record<string | symbol, unknown> & { connect: Connect; disconnect: Connect };
  if (proto[GUARDED]) return;
  proto[GUARDED] = true;
  const states = new WeakMap<object, GuardState>();
  const generations = new WeakMap<object, number>();
  const connect = proto.connect;
  const disconnect = proto.disconnect;

  proto.connect = async function (this: object, ...args: unknown[]) {
    const { delay, state } = nextConnect(states.get(this), Date.now());
    states.set(this, state);
    if (delay > 0) {
      const gen = generations.get(this) ?? 0;
      await new Promise((r) => setTimeout(r, delay));
      if ((generations.get(this) ?? 0) !== gen) return; // disconnected while waiting: stay closed
    }
    return connect.apply(this, args);
  };
  proto.disconnect = async function (this: object, ...args: unknown[]) {
    generations.set(this, (generations.get(this) ?? 0) + 1);
    return disconnect.apply(this, args);
  };
}

installRelayGuard();
