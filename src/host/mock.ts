import type { HostRequest, HostResponse, HostRuntime } from "./HostRuntime.js";

/**
 * THE DEFAULT HOST. No API key, no network, no account.
 *
 * This is not a stub that returns a fixed blob. It parses the digest it is
 * handed and applies a small escalation ladder to whatever the actual state of
 * canon is, deterministically from a seed. That means:
 *
 *   - the demo shows a real drama loop, not a canned transcript
 *   - the tick loop, validator and applier are exercised for real
 *   - the same seed always produces the same 10 days, so tests can assert on
 *     history and a reviewer can reproduce a bug exactly
 *
 * When the real Mind is plugged in, nothing above this file changes.
 */

/** mulberry32 -- small, fast, seedable, good enough for drama. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ParsedCast {
  id: string;
  name: string;
}
interface ParsedRel {
  from: string;
  to: string;
  affinity: number;
  trust: number;
  tension: number;
}
interface ParsedArc {
  id: string;
  status: string;
  stage: number;
  tension: number;
  participants: string[];
  title: string;
}
interface ParsedVisitor {
  fanId: string;
  stance: Record<string, number>;
}

interface ParsedDigest {
  tickNo: number;
  cast: ParsedCast[];
  rels: ParsedRel[];
  arcs: ParsedArc[];
  visitors: ParsedVisitor[];
  /** Set when the prompt is an arrival. */
  arrivingFan?: string;
  /** Set when the prompt is a visitor action. */
  fanEvent?: { fanId: string; what: string };
}

export function parseDigest(prompt: string): ParsedDigest {
  const tickNo = Number(prompt.match(/^TICK:\s*(\d+)/m)?.[1] ?? 0);

  const cast: ParsedCast[] = [];
  for (const m of prompt.matchAll(/^ {2}([a-z0-9_]+) {2}(.+?) -- /gm)) {
    cast.push({ id: m[1]!, name: m[2]! });
  }

  const rels: ParsedRel[] = [];
  for (const m of prompt.matchAll(
    /^ {2}([a-z0-9_]+) -> ([a-z0-9_]+) {2}affinity (-?\d+), trust (-?\d+), tension (-?\d+)/gm,
  )) {
    rels.push({
      from: m[1]!,
      to: m[2]!,
      affinity: Number(m[3]),
      trust: Number(m[4]),
      tension: Number(m[5]),
    });
  }

  const arcs: ParsedArc[] = [];
  for (const m of prompt.matchAll(
    /^ {2}(arc_[a-z0-9_]+) \[([a-z]+), stage (\d+), tension (\d+), between (.+?)\] (.+)$/gm,
  )) {
    arcs.push({
      id: m[1]!,
      status: m[2]!,
      stage: Number(m[3]),
      tension: Number(m[4]),
      participants: m[5]!.split(" and ").map((s) => s.trim()),
      title: m[6]!,
    });
  }

  const visitors: ParsedVisitor[] = [];
  const vBlock = prompt.split("VISITORS ON RECORD")[1];
  if (vBlock) {
    const lines = vBlock.split("\n");
    let cur: ParsedVisitor | null = null;
    for (const line of lines) {
      const fm = line.match(/^ {2}fan:([a-z0-9_]+)/i);
      if (fm) {
        cur = { fanId: fm[1]!, stance: {} };
        visitors.push(cur);
        continue;
      }
      const sm = line.match(/^ {6}standing: (.+)$/);
      if (sm && cur) {
        for (const pair of sm[1]!.split(",")) {
          const pm = pair.trim().match(/^([a-z0-9_]+) ([+-]?\d+)$/i);
          if (pm) cur.stance[pm[1]!] = Number(pm[2]);
        }
      }
      if (/^COGNITION BUDGET/.test(line)) break;
    }
  }

  const arriving = prompt.match(/A visitor has just arrived: fan:([a-z0-9_]+)/i)?.[1];
  const fanEvt = prompt.match(/^fan:([a-z0-9_]+) just did this: (.+)$/m);

  return {
    tickNo,
    cast,
    rels,
    arcs,
    visitors,
    ...(arriving ? { arrivingFan: arriving } : {}),
    ...(fanEvt ? { fanEvent: { fanId: fanEvt[1]!, what: fanEvt[2]! } } : {}),
  };
}

/**
 * Escalation ladder. Higher tension and later stage = nastier action.
 *
 * The top of the ladder bends back down on purpose: an arc that has been at
 * maximum tension for days has to break, or the world is just a shouting match
 * that never resolves. Stories need a shape.
 */
function ladder(tension: number, stage: number, r: number, avoid?: string): string {
  const pick = (): string => {
    if (tension >= 92 && stage >= 5) return "concede";
    if (stage >= 8 && tension < 55) return "concede";
    if (tension >= 82) return r < 0.5 ? "confront" : r < 0.8 ? "sabotage" : "break_alliance";
    if (tension >= 62) return r < 0.4 ? "confront" : r < 0.75 ? "spread_rumor" : "sabotage";
    if (tension >= 40) return r < 0.5 ? "post_notice" : "snub";
    return r < 0.6 ? "post_notice" : "hold";
  };
  const first = pick();
  if (first !== avoid) return first;
  // Same move twice running is boring. Step sideways.
  const alt: Record<string, string> = {
    confront: "sabotage",
    sabotage: "spread_rumor",
    spread_rumor: "confront",
    post_notice: "snub",
    snub: "post_notice",
    concede: "offer_alliance",
    break_alliance: "confront",
    hold: "post_notice",
  };
  return alt[first] ?? first;
}

/**
 * Subject-less on purpose. The event summary already names the actor, so an
 * intent that leads with the name produces "Vance confronted Okonkwo: Vance
 * says the thing out loud" -- which is how you can tell a system is stapling
 * strings together rather than writing.
 */
/**
 * What the stand-in host SAYS, as opposed to what it narrates.
 *
 * The real Mind writes these lines itself; this table is the mock's version of
 * the same job, so the offline demo has dialogue and so the host-derived line
 * ratio is measurable without a key. Deliberately plain -- the point of the
 * live comparison is that a Mind writes better ones.
 */
const SPEECH: Record<string, (a: string, b: string) => string[]> = {
  confront: (_a, b) => [`${b}.`, `We are doing this here, then.`],
  post_notice: () => [`Read it yourself.`],
  snub: () => [],
  spread_rumor: () => [`You didn't hear it from me.`],
  sabotage: () => [],
  concede: (_a, b) => [`${b}. You've made your point.`],
  offer_tribute: (_a, b) => [`${b}. Take it, don't thank me.`],
  offer_alliance: (_a, b) => [`${b}. An arrangement, then.`],
  accept_alliance: (_a, b) => [`${b}. Agreed, and I'll hold you to it.`],
  break_alliance: (_a, b) => [`${b}. We're finished.`],
  hold: () => [],
  greet_visitor: () => [`You're new. Everyone here is something to someone.`],
  recruit_visitor: () => [`You picked a side in front of witnesses. I don't forget that.`],
};
const speechFor = (action: string, a: string, b: string): string[] =>
  (SPEECH[action] ?? SPEECH.hold!)(a, b);

const INTENTS: Record<string, (a: string, b: string) => string> = {
  confront: () => `says the thing out loud, in front of witnesses, and does not soften it`,
  post_notice: (_a, b) => `puts it on the board where ${b} will have to walk past it`,
  snub: () => `makes the omission obvious enough that everyone counts it`,
  spread_rumor: () => `lets a version of it travel without ever having said it`,
  sabotage: (_a, b) => `arranges for ${b}'s week to become materially harder`,
  concede: (_a, b) => `gives ground, badly, and makes sure it costs ${b} something to accept`,
  offer_tribute: () => `sends something useful and refuses to call it a favour`,
  offer_alliance: () => `proposes an arrangement that sounds like charity and isn't`,
  break_alliance: (_a, b) => `ends the arrangement with ${b} and does not pretend to regret it`,
  hold: () => `says nothing and lets the silence be the message`,
};

export interface MockOptions {
  seed?: number;
  /** Force failures for a given tick number. Used by the tick-loop tests. */
  failOn?: Record<number, "timeout" | "malformed" | "error" | "bad-reference">;
  /** Simulated latency. Zero by default so the demo is instant. */
  latencyMs?: number;
}

export class MockHostRuntime implements HostRuntime {
  readonly name = "mock";
  /** Same prompt, same answer, every time -- that is the point of the mock. */
  readonly deterministic = true;
  private seed: number;
  private failOn: Record<number, "timeout" | "malformed" | "error" | "bad-reference">;
  private latencyMs: number;
  /** Counts repair attempts so a repair can succeed after a malformed first try. */
  private repairCount = 0;
  /** Last action each actor took, so the ladder does not repeat itself. */
  private lastAction: Record<string, string> = {};

  constructor(opts: MockOptions = {}) {
    this.seed = opts.seed ?? 1;
    this.failOn = opts.failOn ?? {};
    this.latencyMs = opts.latencyMs ?? 0;
  }

  async init(): Promise<void> {
    /* nothing to set up */
  }

  async budgetRemaining(): Promise<number | undefined> {
    return undefined; // the mock does not meter cognition
  }

  async close(): Promise<void> {
    /* nothing to release */
  }

  async ask(req: HostRequest): Promise<HostResponse> {
    const started = Date.now();
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));

    const d = parseDigest(req.prompt);
    const fail = this.failOn[d.tickNo];

    // A repair request follows a rejection: succeed on the retry so the
    // "reject -> re-prompt once -> accept" path is genuinely exercised.
    if (req.kind === "repair") {
      this.repairCount++;
      return {
        ok: true,
        text: JSON.stringify(this.compose(d, true)),
        latencyMs: Date.now() - started,
      };
    }

    if (fail === "timeout") {
      return {
        ok: false,
        reason: "timeout",
        message: `mock: forced timeout on tick ${d.tickNo}`,
        latencyMs: Date.now() - started,
      };
    }
    if (fail === "error") {
      return {
        ok: false,
        reason: "error",
        message: `mock: forced error on tick ${d.tickNo}`,
        latencyMs: Date.now() - started,
      };
    }
    if (fail === "malformed") {
      return {
        ok: true,
        text: "Sure! Here's the plan:\n{ directives: [ this is not json ",
        latencyMs: Date.now() - started,
      };
    }
    if (fail === "bad-reference") {
      // Shape-valid, canon-invalid: the exact failure zod alone cannot catch.
      return {
        ok: true,
        text: JSON.stringify({
          directives: [
            {
              actor: "lord_nonexistent",
              action: "confront",
              target: "vance",
              dialogue_intent: "a character who does not exist makes demands",
              canon_deltas: [],
            },
          ],
        }),
        latencyMs: Date.now() - started,
      };
    }

    return {
      ok: true,
      text: JSON.stringify(this.compose(d, false)),
      latencyMs: Date.now() - started,
    };
  }

  // -------------------------------------------------------------------------

  private compose(d: ParsedDigest, isRepair: boolean): unknown {
    const r = rng(this.seed * 7919 + d.tickNo * 31 + (isRepair ? 1 : 0));

    if (d.arrivingFan) return this.composeArrival(d, r);
    if (d.fanEvent) return this.composeFanReaction(d, r);
    return this.composeTick(d, r);
  }

  /** Ordinary world tick: advance the hottest arc, and let a third party react. */
  private composeTick(d: ParsedDigest, r: () => number): unknown {
    const directives: unknown[] = [];

    const arc = [...d.arcs].sort((a, b) => b.tension - a.tension)[0];
    const ids = d.cast.map((c) => c.id);
    const names = new Map(d.cast.map((c) => [c.id, c.name]));
    const nameOf = (id: string) => names.get(id) ?? id;

    // Every arc has resolved. A world with nothing running is a dead world, so
    // open a fresh one between whoever is currently most at odds.
    if (!arc) {
      const hot = [...d.rels].sort((a, b) => b.tension - a.tension)[0];
      if (hot) {
        const arcId = `arc_${hot.from}_${hot.to}_${d.tickNo}`;
        return {
          directives: [
            {
              actor: hot.from,
              action: "post_notice",
              target: hot.to,
              dialogue_intent: `${nameOf(hot.from)} reopens something everyone had agreed to stop mentioning`,
              arc_id: arcId,
              significance_hint: 0.6,
              canon_deltas: [
                {
                  op: "arc_open",
                  arc_id: arcId,
                  title: `${nameOf(hot.from)} and ${nameOf(hot.to)}, round ${1 + Math.floor(d.tickNo / 6)}`,
                  participants: [hot.from, hot.to],
                  summary: `The last quarrel was settled on paper and not in fact. ${nameOf(hot.from)} moved first.`,
                  tension: 35,
                },
                {
                  op: "relationship_delta",
                  from_id: hot.to,
                  to_id: hot.from,
                  affinity: -6,
                  trust: -4,
                  tension: 10,
                  note: `${nameOf(hot.from)} would not let it lie.`,
                },
              ],
            },
          ],
          note: `mock tick ${d.tickNo} (new arc)`,
        };
      }
    }

    if (arc) {
      // Only the people whose arc this is may act in it. Whoever holds the
      // most tension toward the other moves first.
      const valid = d.rels.filter((x) => ids.includes(x.from) && ids.includes(x.to));
      const inArc = valid.filter(
        (x) => arc.participants.includes(x.from) && arc.participants.includes(x.to),
      );
      const pair = (inArc.length > 0 ? inArc : valid).sort((a, b) => b.tension - a.tension)[0];

      if (pair) {
        const action = ladder(arc.tension, arc.stage, r(), this.lastAction[pair.from]);
        this.lastAction[pair.from] = action;
        const intent = (INTENTS[action] ?? INTENTS.hold!)(nameOf(pair.from), nameOf(pair.to));
        const escalating = action === "confront" || action === "sabotage";
        const tensionMove = action === "concede" ? -22 : escalating ? 12 : 6;

        const deltas: unknown[] = [
          {
            op: "relationship_delta",
            from_id: pair.to,
            to_id: pair.from,
            affinity: action === "concede" ? 6 : -Math.round(4 + r() * 8),
            trust: action === "concede" ? 4 : -Math.round(2 + r() * 5),
            tension: tensionMove,
            note: this.noteFor(action, nameOf(pair.from), nameOf(pair.to)),
          },
          {
            op: "arc_advance",
            arc_id: arc.id,
            stage_delta: 1,
            tension: tensionMove,
            summary: `${arc.title}: ${nameOf(pair.from)} chose to ${action.replace(/_/g, " ")}. Stage ${arc.stage + 1}.`,
          },
        ];

        if (action === "concede" && arc.stage >= 5) {
          deltas.push({
            op: "arc_resolve",
            arc_id: arc.id,
            resolution: `${nameOf(pair.from)} gave ground. Nothing is settled, but the ward stopped watching.`,
          });
        }

        if (escalating && r() < 0.5) {
          deltas.push({
            op: "character_mood",
            character_id: pair.from,
            mood: r() < 0.5 ? "hard" : "unrepentant",
          });
        }

        directives.push({
          actor: pair.from,
          action,
          target: pair.to,
          speech: speechFor(action, nameOf(pair.from), nameOf(pair.to)),
          dialogue_intent: intent,
          arc_id: arc.id,
          significance_hint: escalating ? 0.8 : 0.5,
          canon_deltas: deltas,
        });
      }
    }

    // A bystander with an opinion. This is what makes the district feel
    // inhabited rather than like a two-hander.
    const involved = new Set(directives.map((x) => (x as { actor: string }).actor));
    const bystander = ids.find((id) => !involved.has(id));
    if (bystander && r() < 0.7) {
      const subject = ids.find((id) => involved.has(id)) ?? bystander;
      const friendly = d.rels.find((x) => x.from === bystander && x.affinity > 0);
      const roll = r();
      let action =
        friendly && roll < 0.35
          ? "offer_tribute"
          : roll < 0.6
            ? "spread_rumor"
            : roll < 0.8
              ? "post_notice"
              : "hold";
      if (action === this.lastAction[bystander]) action = action === "hold" ? "spread_rumor" : "hold";
      this.lastAction[bystander] = action;
      const other = friendly?.to ?? subject;
      directives.push({
        actor: bystander,
        action,
        target: other === bystander ? null : other,
        speech: speechFor(action, nameOf(bystander), nameOf(other)),
        dialogue_intent: (INTENTS[action] ?? INTENTS.hold!)(nameOf(bystander), nameOf(other)),
        arc_id: null,
        significance_hint: 0.35,
        canon_deltas: [
          {
            op: "relationship_delta",
            from_id: other === bystander ? bystander : other,
            to_id: bystander,
            affinity: action === "offer_tribute" ? 5 : -3,
            trust: action === "offer_tribute" ? 4 : -2,
            tension: action === "offer_tribute" ? -3 : 4,
            note:
              action === "offer_tribute"
                ? `${nameOf(bystander)} helped without being asked, which is its own kind of pressure.`
                : `${nameOf(bystander)} did not keep it to themselves.`,
          },
        ],
      });
    }

    // A returning ally gets recognised, and the greeting carries a grievance.
    // The mock only sets the intent -- the character runtime looks up the
    // actual event and cites it, so the callback is grounded in the log.
    for (const v of d.visitors) {
      const ally = Object.entries(v.stance)
        .filter(([, n]) => n >= 20)
        .sort((a, b) => b[1] - a[1])[0];
      if (!ally) continue;
      if (directives.length >= 3) break;
      // Do not fawn. Greeting the same person every few hours is worse than
      // not greeting them at all.
      if (this.lastAction[ally[0]] === "greet_visitor") continue;
      if (r() < 0.7) continue;
      this.lastAction[ally[0]] = "greet_visitor";
      directives.push({
        actor: ally[0],
        action: "greet_visitor",
        target: `fan:${v.fanId}`,
        speech: [`You've been here before.`],
        dialogue_intent:
          "greet them as one of ours, then complain about what the rival did, citing it exactly",
        arc_id: null,
        significance_hint: 0.6,
        canon_deltas: [
          {
            op: "visitor_stance",
            fan_id: v.fanId,
            character_id: ally[0],
            sentiment: 4,
            moment: `${ally[0]} spoke to them as an ally and aired a grievance in front of them.`,
            moment_weight: 0.5,
          },
        ],
      });
    }

    if (directives.length === 0) {
      const who = ids[0] ?? "vance";
      directives.push({
        actor: who,
        action: "hold",
        target: null,
        dialogue_intent: `${who} lets the day pass without giving anyone anything to repeat`,
        arc_id: null,
        significance_hint: 0.2,
        canon_deltas: [],
      });
    }

    return { directives: directives.slice(0, 4), note: `mock tick ${d.tickNo}` };
  }

  private composeArrival(d: ParsedDigest, r: () => number): unknown {
    const fan = d.arrivingFan!;
    const ids = d.cast.map((c) => c.id);
    const names = new Map(d.cast.map((c) => [c.id, c.name]));
    const nameOf = (id: string) => names.get(id) ?? id;
    // The character under the most pressure notices a stranger first.
    const hottest = [...d.rels].sort((a, b) => b.tension - a.tension)[0];
    const first = hottest?.from ?? ids[0] ?? "vance";
    const second = ids.find((i) => i !== first) ?? first;

    return {
      directives: [
        {
          actor: first,
          action: "greet_visitor",
          target: `fan:${fan}`,
          dialogue_intent: `${nameOf(first)} takes the measure of a stranger and decides they might be useful`,
          arc_id: null,
          significance_hint: 0.5,
          canon_deltas: [
            {
              op: "visitor_stance",
              fan_id: fan,
              character_id: first,
              sentiment: 6,
              moment: `${nameOf(first)} was the first to speak to them, and made it sound like an assessment.`,
              moment_weight: 0.7,
            },
          ],
        },
        {
          actor: second,
          action: "greet_visitor",
          target: `fan:${fan}`,
          dialogue_intent: `${nameOf(second)} warns them, gently, about the company they have just been seen in`,
          arc_id: null,
          significance_hint: 0.4,
          canon_deltas: [
            {
              op: "visitor_stance",
              fan_id: fan,
              character_id: second,
              sentiment: 3,
              moment: `${nameOf(second)} warned them about ${nameOf(first)} before they had asked anyone anything.`,
              moment_weight: 0.6,
            },
          ],
        },
      ],
      note: "mock arrival",
    };
  }

  /**
   * A known visitor comes back. The one who counts them as theirs greets them;
   * the one they crossed does not.
   *
   * The greeting only sets the INTENT to air a grievance. The character runtime
   * looks the grievance up in the event log and cites it by id -- so the
   * complaint is true because canon says so, not because the host remembered
   * correctly.
   */
  private composeReturn(d: ParsedDigest, fanId: string, r: () => number): unknown {
    const names = new Map(d.cast.map((c) => [c.id, c.name]));
    const nameOf = (id: string) => names.get(id) ?? id;
    const v = d.visitors.find((x) => x.fanId === fanId);
    const stance = v?.stance ?? {};
    const ranked = Object.entries(stance).sort((a, b) => b[1] - a[1]);
    const ally = ranked[0];
    const enemy = ranked[ranked.length - 1];

    const directives: unknown[] = [];

    if (ally && ally[1] > 0) {
      directives.push({
        actor: ally[0],
        action: "greet_visitor",
        target: `fan:${fanId}`,
        speech: [`Good. I was hoping it would be you.`],
        dialogue_intent:
          "greet them as one of ours, then tell them exactly what the rival did while they were gone",
        arc_id: null,
        significance_hint: 0.7,
        canon_deltas: [
          {
            op: "visitor_stance",
            fan_id: fanId,
            character_id: ally[0],
            sentiment: 6,
            moment: `${nameOf(ally[0])} welcomed them back and told them what had happened in their absence.`,
            moment_weight: 0.7,
          },
        ],
      });
    }

    if (enemy && enemy[1] < 0 && enemy[0] !== ally?.[0]) {
      directives.push({
        actor: enemy[0],
        action: "snub",
        target: `fan:${fanId}`,
        speech: [],
        dialogue_intent: "make it clear their return changes nothing and costs them nothing",
        arc_id: null,
        significance_hint: 0.5,
        canon_deltas: [
          {
            op: "visitor_stance",
            fan_id: fanId,
            character_id: enemy[0],
            sentiment: -4,
            moment: `${nameOf(enemy[0])} looked straight through them on their return.`,
            moment_weight: 0.5,
          },
        ],
      });
    }

    if (directives.length === 0) {
      const who = d.cast[0]?.id ?? "vance";
      directives.push({
        actor: who,
        action: "greet_visitor",
        target: `fan:${fanId}`,
        dialogue_intent: "acknowledge a face they have seen before and leave it there",
        arc_id: null,
        significance_hint: 0.3,
        canon_deltas: [],
      });
    }

    return { directives, note: "mock return visit" };
  }

  private composeFanReaction(d: ParsedDigest, r: () => number): unknown {
    const { fanId, what } = d.fanEvent!;
    if (/\breturn(s|ed|ing)?\b|\bcame back\b|\bcomes back\b/i.test(what)) {
      return this.composeReturn(d, fanId, r);
    }
    const ids = d.cast.map((c) => c.id);
    const names = new Map(d.cast.map((c) => [c.id, c.name]));
    const nameOf = (id: string) => names.get(id) ?? id;
    // Who did they side with? Look for a cast id named in the action text.
    const sided = ids.find((id) => what.toLowerCase().includes(id)) ?? ids[0]!;
    const rival =
      [...d.rels]
        .filter((x) => x.to === sided && x.affinity < 0)
        .sort((a, b) => a.affinity - b.affinity)[0]?.from ??
      ids.find((i) => i !== sided) ??
      sided;
    const third = ids.find((i) => i !== sided && i !== rival);

    const directives: unknown[] = [
      {
        actor: sided,
        action: "recruit_visitor",
        target: `fan:${fanId}`,
        dialogue_intent: `${nameOf(sided)} accepts the support without thanking anyone for it, and makes it public`,
        arc_id: null,
        significance_hint: 0.85,
        canon_deltas: [
          {
            op: "visitor_stance",
            fan_id: fanId,
            character_id: sided,
            sentiment: 28,
            moment: `They took ${nameOf(sided)}'s side in public when it cost them something to do it.`,
            moment_weight: 0.95,
          },
          {
            op: "world_fact",
            statement: `A visitor is counted among ${nameOf(sided)}'s people.`,
            about: [sided],
          },
        ],
      },
      {
        actor: rival,
        action: "snub",
        target: `fan:${fanId}`,
        dialogue_intent: `${nameOf(rival)} marks them down as belonging to the other side and stops being polite`,
        arc_id: null,
        significance_hint: 0.7,
        canon_deltas: [
          {
            op: "visitor_stance",
            fan_id: fanId,
            character_id: rival,
            sentiment: -24,
            moment: `${nameOf(rival)} stopped speaking to them the day they sided with ${nameOf(sided)}.`,
            moment_weight: 0.85,
          },
        ],
      },
    ];

    if (third && r() < 0.7) {
      directives.push({
        actor: third,
        action: "hold",
        target: null,
        dialogue_intent: `${nameOf(third)} notices exactly what happened and declines to comment on it`,
        arc_id: null,
        significance_hint: 0.3,
        canon_deltas: [
          {
            op: "visitor_stance",
            fan_id: fanId,
            character_id: third,
            sentiment: 2,
            moment: `${nameOf(third)} saw them choose and said nothing about it, which was itself a kindness.`,
            moment_weight: 0.4,
          },
        ],
      });
    }

    return { directives, note: "mock fan reaction" };
  }

  private arcInvolves(arc: ParsedArc, id: string): boolean {
    // Participants are not printed in the arc line, so fall back to the title
    // and summary heuristics the digest does expose.
    return arc.title.toLowerCase().includes(id) || arc.id.includes(id) || true;
  }

  private noteFor(action: string, a: string, b: string): string {
    switch (action) {
      case "confront":
        return `${a} said it to my face in front of the ward.`;
      case "post_notice":
        return `${a} put it in writing where everyone walks past.`;
      case "snub":
        return `${a} left me out and made sure it was counted.`;
      case "sabotage":
        return `${a} made my week harder and kept their hands clean.`;
      case "spread_rumor":
        return `${a} did not say it, but everyone heard it from ${a}.`;
      case "concede":
        return `${a} gave ground. I am not sure yet what it cost me to take it.`;
      default:
        return `${a} acted and I noticed.`;
    }
  }
}
