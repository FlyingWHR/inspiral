import type { CanonRepo } from "../canon/repo.js";
import { compileDigest, renderDigest } from "../canon/digest.js";
import type { HostRuntime } from "../host/HostRuntime.js";
import { buildFanEventPrompt, buildOnboardPrompt, buildTickPrompt } from "../host/prompt.js";
import { issuesToRepairPrompt, validateDirectives, type ValidationIssue } from "../directive/validate.js";
import { applyBatch, type AppliedDirective } from "../directive/apply.js";
import { performDirective } from "../runtime/character.js";
import type { SurfaceAdapter } from "../runtime/surface.js";
import type { Directive } from "../types/directive.js";
import type { Clock } from "../clock.js";
import { log } from "../log.js";

/**
 * ONE TICK.
 *
 *   compile digest -> ask host -> validate -> apply deltas -> dispatch
 *
 * Every failure mode along that path degrades instead of throwing:
 *
 *   host times out        -> log a tick_skipped event, replay last directives
 *   host returns garbage  -> re-prompt ONCE, then skip the tick
 *   host invents a person -> referential validation rejects it, same path
 *   a single delta throws -> that delta is dropped, the rest of the tick lands
 *   budget exhausted      -> tick is skipped, world stays consistent
 *
 * A world that has been accumulating history for six days must not lose it to
 * a 500 from someone else's API.
 */

export type TickOutcome =
  | { status: "applied"; applied: AppliedDirective[]; repaired: boolean; hostLatencyMs: number }
  | { status: "replayed"; applied: AppliedDirective[]; reason: string }
  | { status: "skipped"; reason: string; issues?: ValidationIssue[] };

export interface TickContext {
  repo: CanonRepo;
  host: HostRuntime;
  surface?: SurfaceAdapter;
  dailyBudget: number;
  /**
   * Optional world clock. When supplied, the tick advances it by `advanceMs`
   * before compiling the digest, which is how the demo covers ten days in a
   * few seconds and how tests stay deterministic.
   */
  clock?: Clock;
  advanceMs?: number;
}

const SEQ_KEY = "last_tick_seq";
const TICK_KEY = "tick_no";

function nextTickNo(repo: CanonRepo): number {
  return Number(repo.getMeta(TICK_KEY) ?? "0") + 1;
}

function budgetExceeded(repo: CanonRepo, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const since = new Date(Date.parse(repo.now()) - 24 * 3600_000).toISOString();
  return repo.hostInvocationsSince(since) >= limit;
}

/** Dispatch rendered behavior to the engine surface. Never throws upward. */
async function dispatch(
  repo: CanonRepo,
  applied: AppliedDirective[],
  surface: SurfaceAdapter | undefined,
): Promise<void> {
  if (!surface) return;
  for (const a of applied) {
    try {
      const behavior = performDirective(repo, a.directive);
      if (!behavior) continue;
      await surface.present(behavior);
      if (behavior.post_draft && surface.postNotice) {
        await surface.postNotice(behavior.post_draft, a.directive.actor);
      }
      if (surface.onEvent) await surface.onEvent(a.event);
    } catch (e) {
      log.warn(`surface dispatch failed: ${(e as Error).message}`);
    }
  }
}

/**
 * Fall back to the last directives that validated. The world keeps moving on
 * its own momentum rather than freezing because a vendor had a bad minute.
 */
async function replayLast(
  ctx: TickContext,
  reason: string,
): Promise<TickOutcome> {
  const { repo, surface } = ctx;

  repo.appendEvent({
    source: "system",
    actors: ["system"],
    type: "tick_skipped",
    payload: { reason, summary: `The tick did not resolve (${reason}). The ward carried on.` },
    significance_hint: 0.1,
  });

  const last = repo.loadLastDirectives<Directive[]>();
  if (!last || last.length === 0) {
    log.warn(`tick skipped (${reason}); no previous directives to replay`);
    return { status: "skipped", reason };
  }

  // Replay is a diminished echo, not a repeat: deltas are dropped so a broken
  // host cannot ratchet relationships by failing repeatedly.
  const echo: Directive[] = last.map((d) => ({ ...d, canon_deltas: [], significance_hint: 0.15 }));
  const applied = applyBatch(repo, echo, { source: "system" });
  await dispatch(repo, applied, surface);

  log.warn(`tick skipped (${reason}); replayed ${echo.length} directive(s) without deltas`);
  return { status: "replayed", applied, reason };
}

/** Ask the host, validate, and repair once. Returns validated directives. */
async function askAndValidate(
  ctx: TickContext,
  kind: "tick" | "onboard" | "fan-event",
  prompt: string,
): Promise<
  | { ok: true; directives: Directive[]; repaired: boolean; latencyMs: number }
  | { ok: false; reason: string; issues?: ValidationIssue[] }
> {
  const { repo, host } = ctx;

  const first = await host.ask({ kind, prompt });
  repo.recordHostInvocation({
    alias: kind,
    kind,
    ok: first.ok,
    latencyMs: first.latencyMs,
    ...(first.ok ? {} : { error: first.message }),
  });

  if (!first.ok) return { ok: false, reason: first.reason };

  const v1 = validateDirectives(first.text, repo);
  if (v1.ok) {
    for (const w of v1.warnings) log.debug(`validator warning ${w.path}: ${w.message}`);
    return { ok: true, directives: v1.batch.directives, repaired: false, latencyMs: first.latencyMs };
  }

  // ---- ONE repair attempt. Not two. ----
  log.warn(
    `directive rejected (${v1.issues.length} issue(s)); re-prompting once. First: ${v1.issues[0]?.path} ${v1.issues[0]?.message}`,
  );
  repo.appendEvent({
    source: "host",
    actors: ["system"],
    type: "directive_rejected",
    payload: {
      issues: v1.issues.slice(0, 6),
      summary: `A directive was refused by the validator: ${v1.issues[0]?.message ?? "unknown"}`,
    },
    significance_hint: 0.05,
  });

  const repairPrompt = `${issuesToRepairPrompt(v1.issues)}\n\n=== ORIGINAL REQUEST ===\n${prompt}`;
  const second = await ctx.host.ask({ kind: "repair", prompt: repairPrompt, continuation: true });
  repo.recordHostInvocation({
    alias: kind,
    kind: "repair",
    ok: second.ok,
    latencyMs: second.latencyMs,
    ...(second.ok ? {} : { error: second.message }),
  });

  if (!second.ok) return { ok: false, reason: `repair ${second.reason}` };

  const v2 = validateDirectives(second.text, repo);
  if (v2.ok) {
    log.info("repair accepted");
    return {
      ok: true,
      directives: v2.batch.directives,
      repaired: true,
      latencyMs: first.latencyMs + second.latencyMs,
    };
  }

  log.warn(`repair also rejected (${v2.issues.length} issue(s)); skipping`);
  return { ok: false, reason: "invalid-after-repair", issues: v2.issues };
}

/**
 * Fire one world tick. Manually triggerable; this is what the scheduler calls.
 */
export async function runTick(ctx: TickContext): Promise<TickOutcome> {
  const { repo, surface } = ctx;

  try {
    if (budgetExceeded(repo, ctx.dailyBudget)) {
      return replayLast(ctx, "budget");
    }

    const tickNo = nextTickNo(repo);
    const sinceSeq = Number(repo.getMeta(SEQ_KEY) ?? "0");
    const digest = compileDigest(repo, {
      tickNo,
      sinceSeq,
      dailyBudget: ctx.dailyBudget,
    });

    const result = await askAndValidate(ctx, "tick", buildTickPrompt(renderDigest(digest)));

    // Advance the log cursor regardless of outcome, so a failed tick does not
    // re-feed the host the same events forever.
    repo.setMeta(TICK_KEY, String(tickNo));
    repo.setMeta(SEQ_KEY, String(repo.maxSeq()));

    if (!result.ok) {
      const outcome = await replayLast(ctx, result.reason);
      repo.setMeta(SEQ_KEY, String(repo.maxSeq()));
      if (outcome.status === "skipped" && result.issues) {
        return { status: "skipped", reason: result.reason, issues: result.issues };
      }
      return outcome;
    }

    const applied = applyBatch(repo, result.directives, { source: "tick" });
    repo.saveLastDirectives(result.directives);
    repo.setMeta(SEQ_KEY, String(repo.maxSeq()));

    await dispatch(repo, applied, surface);

    return {
      status: "applied",
      applied,
      repaired: result.repaired,
      hostLatencyMs: result.latencyMs,
    };
  } catch (e) {
    // Absolute backstop. A tick may fail; the process may not die.
    log.error(`tick threw, absorbed: ${(e as Error).message}`);
    try {
      ctx.repo.appendEvent({
        source: "system",
        actors: ["system"],
        type: "tick_skipped",
        payload: { reason: "exception", summary: `Tick failed: ${(e as Error).message}` },
        significance_hint: 0.05,
      });
    } catch {
      /* if even this fails, still do not throw */
    }
    return { status: "skipped", reason: `exception: ${(e as Error).message}` };
  } finally {
    // Time moves at the END of a tick, not the start: a tick's events happened
    // during the interval it consumed, not after it. Advancing first pushed the
    // final tick of a run onto the next calendar day, so a six-day demo printed
    // a day 7. In `finally` so a skipped or replayed tick still burns its time.
    if (ctx.clock && ctx.advanceMs && ctx.advanceMs > 0) {
      ctx.clock.advance(ctx.advanceMs);
    }
  }
}

// ---------------------------------------------------------------------------
// Visitor-driven entry points. Same pipeline, different prompt.
// ---------------------------------------------------------------------------

/** A visitor arrives for the first time. Costs one host invocation. */
export async function onboardVisitor(
  ctx: TickContext,
  fanId: string,
  displayName = "",
): Promise<TickOutcome> {
  const { repo, surface } = ctx;
  try {
    repo.ensureVisitor(fanId, displayName);
    const arrival = repo.appendEvent({
      source: "visitor",
      actors: [`fan:${fanId}`],
      type: "visitor_arrived",
      payload: {
        summary: `${displayName || fanId} came into the ward for the first time.`,
      },
      significance_hint: 0.4,
    });
    repo.addInteraction(fanId, {
      event_id: arrival.event_id,
      ts: arrival.ts,
      character_id: null,
      kind: "arrival",
      detail: "first visit",
    });

    if (budgetExceeded(repo, ctx.dailyBudget)) return { status: "skipped", reason: "budget" };

    const digest = compileDigest(repo, {
      tickNo: Number(repo.getMeta(TICK_KEY) ?? "0"),
      sinceSeq: Number(repo.getMeta(SEQ_KEY) ?? "0"),
      dailyBudget: ctx.dailyBudget,
      visitorIds: [fanId],
    });
    const result = await askAndValidate(
      ctx,
      "onboard",
      buildOnboardPrompt(renderDigest(digest), fanId, displayName),
    );
    if (!result.ok) return { status: "skipped", reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) };

    const applied = applyBatch(repo, result.directives, { source: "visitor" });
    repo.setMeta(SEQ_KEY, String(repo.maxSeq()));
    await dispatch(repo, applied, surface);
    return { status: "applied", applied, repaired: result.repaired, hostLatencyMs: result.latencyMs };
  } catch (e) {
    log.error(`onboard threw, absorbed: ${(e as Error).message}`);
    return { status: "skipped", reason: `exception: ${(e as Error).message}` };
  }
}

/** A visitor does something consequential -- taking a side, for instance. */
export async function visitorAction(
  ctx: TickContext,
  fanId: string,
  what: string,
): Promise<TickOutcome> {
  const { repo, surface } = ctx;
  try {
    if (!repo.visitorExists(fanId)) repo.ensureVisitor(fanId);

    const evt = repo.appendEvent({
      source: "visitor",
      actors: [`fan:${fanId}`],
      type: "visitor_pledged",
      payload: { summary: what, what },
      significance_hint: 0.9,
    });
    repo.addInteraction(fanId, {
      event_id: evt.event_id,
      ts: evt.ts,
      character_id: null,
      kind: "action",
      detail: what,
    });

    if (budgetExceeded(repo, ctx.dailyBudget)) return { status: "skipped", reason: "budget" };

    const digest = compileDigest(repo, {
      tickNo: Number(repo.getMeta(TICK_KEY) ?? "0"),
      sinceSeq: Number(repo.getMeta(SEQ_KEY) ?? "0"),
      dailyBudget: ctx.dailyBudget,
      visitorIds: [fanId],
    });
    const result = await askAndValidate(
      ctx,
      "fan-event",
      buildFanEventPrompt(renderDigest(digest), fanId, what),
    );
    if (!result.ok) return { status: "skipped", reason: result.reason, ...(result.issues ? { issues: result.issues } : {}) };

    const applied = applyBatch(repo, result.directives, { source: "visitor" });
    repo.setMeta(SEQ_KEY, String(repo.maxSeq()));
    await dispatch(repo, applied, surface);
    return { status: "applied", applied, repaired: result.repaired, hostLatencyMs: result.latencyMs };
  } catch (e) {
    log.error(`visitorAction threw, absorbed: ${(e as Error).message}`);
    return { status: "skipped", reason: `exception: ${(e as Error).message}` };
  }
}
