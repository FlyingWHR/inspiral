/**
 * World time is not wall time.
 *
 * A 10-day demo has to be watchable in 10 seconds, and tests must be
 * deterministic. Everything that stamps an event asks the clock, never
 * `new Date()` directly.
 */
export interface Clock {
  now(): Date;
  /** Move world time forward. No-op for a real-time clock. */
  advance(ms: number): void;
}

export const systemClock: Clock = {
  now: () => new Date(),
  advance: () => {
    /* real time advances on its own */
  },
};

/** Deterministic clock for demos and tests. */
export class VirtualClock implements Clock {
  private t: number;

  constructor(start: Date | string = "2026-01-01T09:00:00.000Z") {
    this.t = typeof start === "string" ? Date.parse(start) : start.getTime();
  }

  now(): Date {
    return new Date(this.t);
  }

  advance(ms: number): void {
    this.t += ms;
  }

  advanceHours(h: number): void {
    this.advance(h * 3_600_000);
  }
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
