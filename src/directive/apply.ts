import type { CanonRepo } from "../canon/repo.js";
import { ACTION_EVENT_TYPE, type CanonDelta, type Directive } from "../types/directive.js";
import type { WorldEvent } from "../types/events.js";
import { fanId, isFanRef } from "./validate.js";
import { log } from "../log.js";

/**
 * Applying a directive is: log the event, then move canon.
 *
 * Order matters. The event is written first so every canon mutation can point
 * back at the event that caused it (`last_event_id`). That back-reference is
 * the entire reason an NPC can say "because of what you did on the fourth"
 * and be provably right rather than plausibly right.
 *
 * The whole thing runs in one transaction. A directive lands completely or
 * not at all -- there is no half-remembered grudge.
 */

export interface AppliedDirective {
  directive: Directive;
  event: WorldEvent;
  deltasApplied: number;
}

function summarise(d: Directive, repo: CanonRepo): string {
  const actor = repo.getCharacter(d.actor);
  const actorName = actor?.name ?? d.actor;
  const targetName = d.target
    ? isFanRef(d.target)
      ? (repo.getVisitor(fanId(d.target))?.display_name || d.target)
      : (repo.getCharacter(d.target)?.name ?? d.target)
    : null;

  const verb: Record<string, string> = {
    confront: "confronted",
    post_notice: "posted a notice about",
    snub: "snubbed",
    offer_tribute: "offered tribute to",
    offer_alliance: "offered alliance to",
    accept_alliance: "accepted alliance with",
    break_alliance: "broke with",
    sabotage: "moved against",
    concede: "conceded to",
    spread_rumor: "spread word about",
    greet_visitor: "greeted",
    recruit_visitor: "made a claim on",
    hold: "held their peace regarding",
  };

  // Several verbs take an object. Without one they need a different form, or
  // the log fills up with "held their peace regarding: ...".
  const verbAlone: Record<string, string> = {
    confront: "made a scene",
    post_notice: "posted a notice",
    snub: "made a point of noticing nobody",
    spread_rumor: "spread word",
    offer_tribute: "sent something useful",
    concede: "gave ground",
    hold: "held their peace",
  };

  const v = targetName ? (verb[d.action] ?? d.action) : (verbAlone[d.action] ?? verb[d.action] ?? d.action);
  const tail = targetName ? ` ${targetName}` : "";
  return `${actorName} ${v}${tail}: ${d.dialogue_intent}`;
}

function applyDelta(delta: CanonDelta, repo: CanonRepo, event: WorldEvent): void {
  switch (delta.op) {
    case "relationship_delta": {
      repo.adjustRelationship(
        delta.from_id,
        delta.to_id,
        {
          affinity: delta.affinity,
          trust: delta.trust,
          tension: delta.tension,
          note: delta.note,
        },
        event.event_id,
      );
      break;
    }

    case "arc_open": {
      repo.upsertArc({
        arc_id: delta.arc_id,
        title: delta.title,
        status: "open",
        participants: delta.participants,
        stage: 0,
        tension: delta.tension,
        summary: delta.summary,
        resolution: null,
      });
      repo.appendEvent({
        source: "tick",
        actors: delta.participants,
        type: "arc_opened",
        payload: { arc_id: delta.arc_id, title: delta.title, summary: delta.summary },
        significance_hint: 0.6,
      });
      break;
    }

    case "arc_advance": {
      const arc = repo.getArc(delta.arc_id);
      if (!arc) break; // validator guarantees this, belt and braces
      const tension = Math.max(0, Math.min(100, arc.tension + delta.tension));
      repo.upsertArc({
        ...arc,
        stage: Math.min(100, arc.stage + delta.stage_delta),
        tension,
        // An arc that crosses 70 is escalating, and the digest says so.
        status: tension >= 70 ? "escalating" : arc.status === "escalating" ? "open" : arc.status,
        summary: delta.summary ?? arc.summary,
      });
      break;
    }

    case "arc_resolve": {
      const arc = repo.getArc(delta.arc_id);
      if (!arc) break;
      repo.upsertArc({
        ...arc,
        status: "resolved",
        resolution: delta.resolution,
        tension: Math.max(0, arc.tension - 40),
      });
      repo.appendEvent({
        source: "tick",
        actors: arc.participants,
        type: "arc_resolved",
        payload: { arc_id: arc.arc_id, resolution: delta.resolution, summary: delta.resolution },
        significance_hint: 0.8,
      });
      break;
    }

    case "visitor_stance": {
      repo.adjustStance(delta.fan_id, delta.character_id, delta.sentiment);
      repo.addInteraction(delta.fan_id, {
        event_id: event.event_id,
        ts: event.ts,
        character_id: delta.character_id,
        kind: "stance_change",
        detail: `${delta.sentiment > 0 ? "+" : ""}${delta.sentiment} with ${delta.character_id}`,
      });
      if (delta.moment) {
        repo.addMoment(delta.fan_id, {
          event_id: event.event_id,
          ts: event.ts,
          summary: delta.moment,
          weight: delta.moment_weight,
          // Only those present remember it.
          witnesses: [delta.character_id],
        });
      }
      break;
    }

    case "character_mood": {
      repo.setMood(delta.character_id, delta.mood);
      break;
    }

    case "world_fact": {
      repo.addFact(delta.statement, delta.about, event.event_id);
      break;
    }
  }
}

/**
 * Apply one directive. Transactional.
 * `source` lets visitor-driven directives be logged as such.
 */
export function applyDirective(
  repo: CanonRepo,
  d: Directive,
  opts: { source?: WorldEvent["source"] } = {},
): AppliedDirective {
  return repo.tx(() => {
    const actors: string[] = [d.actor];
    if (d.target && d.target !== d.actor) actors.push(d.target);

    const event = repo.appendEvent({
      source: opts.source ?? "tick",
      actors,
      type: ACTION_EVENT_TYPE[d.action],
      payload: {
        summary: summarise(d, repo),
        action: d.action,
        dialogue_intent: d.dialogue_intent,
        arc_id: d.arc_id,
        target: d.target,
      },
      significance_hint: d.significance_hint,
    });

    for (const delta of d.canon_deltas) {
      try {
        applyDelta(delta, repo, event);
      } catch (e) {
        // A single bad delta must not lose the rest of the tick. It is logged
        // and skipped; the event stands.
        log.warn(`delta ${delta.op} failed to apply: ${(e as Error).message}`);
      }
    }

    // Any character present in a visitor-facing action also witnesses it.
    if (d.target && isFanRef(d.target)) {
      const fan = fanId(d.target);
      if (repo.visitorExists(fan)) {
        repo.touchVisitor(fan);
        repo.addInteraction(fan, {
          event_id: event.event_id,
          ts: event.ts,
          character_id: d.actor,
          kind: d.action,
          detail: d.dialogue_intent,
        });
      }
    }

    return { directive: d, event, deltasApplied: d.canon_deltas.length };
  });
}

/** Apply a whole validated batch, in order. */
export function applyBatch(
  repo: CanonRepo,
  directives: Directive[],
  opts: { source?: WorldEvent["source"] } = {},
): AppliedDirective[] {
  return directives.map((d) => applyDirective(repo, d, opts));
}
