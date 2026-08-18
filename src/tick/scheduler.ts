import { runTick, type TickContext, type TickOutcome } from "./runTick.js";
import { log } from "../log.js";

/**
 * The world tick. Every 4 hours by default, configurable, and always manually
 * triggerable -- a demo you cannot fire on cue is not a demo.
 *
 * Ticks never overlap. If one is still running when the timer fires, the timer
 * is ignored rather than queued: a slow host must not be able to stack up
 * pending world updates and then apply six of them at once.
 */

export interface SchedulerOptions extends TickContext {
  intervalMinutes: number;
  /** Fire one immediately on start. */
  runOnStart?: boolean;
  onOutcome?: (outcome: TickOutcome) => void;
}

export class TickScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private readonly opts: SchedulerOptions;

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get intervalMs(): number {
    return Math.max(1, this.opts.intervalMinutes) * 60_000;
  }

  /** Fire a tick now. Safe to call at any time; returns null if one is in flight. */
  async trigger(): Promise<TickOutcome | null> {
    if (this.running) {
      log.warn("tick already in flight; manual trigger ignored");
      return null;
    }
    this.running = true;
    try {
      const outcome = await runTick(this.opts);
      this.opts.onOutcome?.(outcome);
      return outcome;
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    log.info(`scheduler started: every ${this.opts.intervalMinutes} minute(s)`);

    const loop = () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        void this.trigger().finally(loop);
      }, this.intervalMs);
      // Do not hold the process open purely for the next tick.
      this.timer.unref?.();
    };

    if (this.opts.runOnStart) {
      void this.trigger().finally(loop);
    } else {
      loop();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    log.info("scheduler stopped");
  }
}
