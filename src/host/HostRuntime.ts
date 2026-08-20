/**
 * THE SOVEREIGNTY SEAM.
 *
 * Everything above this interface is ours: canon, events, arcs, memory, the
 * validator. Everything below it is a rented opinion. The host is asked a
 * question and returns text. It holds no state we depend on, and if it
 * disappears the world keeps its history and a different host is dropped in
 * behind the same four methods.
 *
 * SWAP COST IS ONE FILE. To move off Minds, write one new class implementing
 * this interface and change the switch in `src/host/index.ts`. Nothing else in
 * the codebase imports a vendor SDK.
 */

export type HostCallKind = "tick" | "onboard" | "fan-event" | "qc" | "repair";

export interface HostRequest {
  kind: HostCallKind;
  /** The rendered digest or question. */
  prompt: string;
  /**
   * Continuation of a prior exchange in the same lane -- used for the single
   * repair attempt, so the host sees its own rejected output.
   */
  continuation?: boolean;
}

export type HostResponse =
  | { ok: true; text: string; latencyMs: number }
  | { ok: false; reason: "timeout" | "error" | "budget"; message: string; latencyMs: number };

export interface HostRuntime {
  /** Short name for logs and the README. */
  readonly name: string;

  /**
   * True when the same prompt always yields the same answer.
   *
   * This is not trivia: it decides whether retrying a bad answer is worth an
   * invocation. Asking the deterministic stand-in twice returns the identical
   * response and burns a call for nothing, so callers that retry on a poor
   * result must check this first.
   */
  readonly deterministic?: boolean;

  /**
   * Called once before the first ask. Establishes conversations/aliases.
   * Must be idempotent and must not throw on a world that is already set up.
   */
  init(): Promise<void>;

  /**
   * Ask the host for narrative output. MUST NOT THROW. Failure is returned as
   * `{ok:false}` so the tick loop can degrade instead of crashing.
   */
  ask(req: HostRequest): Promise<HostResponse>;

  /**
   * Remaining metered cognition, if the host exposes it. `undefined` when the
   * concept does not apply (the mock) or the call fails.
   */
  budgetRemaining(): Promise<number | undefined>;

  /** Release sockets, SSE subscriptions, timers. */
  close(): Promise<void>;
}
