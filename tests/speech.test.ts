import { describe, expect, it } from "vitest";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { performDirective } from "../src/runtime/character.js";
import { HOUR_MS } from "../src/clock.js";
import { freshWorld } from "./helpers.js";

/**
 * A speech bubble contains spoken words. It used to contain the directive's
 * action description -- "gives ground, badly, and makes sure it costs
 * Chancellor Ferrox something to accept" -- rendered as if the character said
 * it out loud, which shipped in a demo screenshot.
 *
 * Stage direction is narration and belongs in `stage`.
 */

/**
 * Two shapes that are never speech:
 *  - a bare third-person present verb, how a directive's action reads
 *    ("makes the omission obvious...")
 *  - a sentence ABOUT the speaker ("He means to stand at the Ledger door...").
 *    A live Mind writes relationship notes this way; the mock happened not to,
 *    which is why quoting them went unnoticed for so long.
 */
const STAGE_VERB =
  /^(makes|gives|says|puts|lets|sends|arranges|ends|reopens|takes|holds|notices|declines|marks|proposes|accepts|greets|warns|stops|keeps|brings|reads)\b/i;
function stageLike(line: string): boolean {
  return STAGE_VERB.test(line.trim());
}

// NOT tested as a leak: a third-person sentence. A character raising a
// grievance ("He walked out of the arrangement") or quoting an ingested post
// verbatim is genuinely speaking, and the post-reaction beat depends on it.

describe("speech bubbles contain only speech", () => {
  it("never renders the directive's action description as a spoken line", async () => {
    const { repo, clock } = freshWorld();
    const surface = new MemorySurface();
    const ctx: TickContext = {
      repo, clock, surface,
      host: new MockHostRuntime({ seed: 3 }),
      dailyBudget: 500,
      advanceMs: 4 * HOUR_MS,
    };
    for (let i = 0; i < 20; i++) await runTick(ctx);
    expect(surface.presented.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const b of surface.presented) {
      // the exact stage string must never appear among the spoken lines
      if (b.stage && b.lines.includes(b.stage)) offenders.push(`[exact] ${b.stage}`);
      for (const line of b.lines) if (stageLike(line)) offenders.push(`[shape] ${line}`);
    }
    expect(offenders, `stage direction leaked into speech:\n${offenders.join("\n")}`).toEqual([]);
    repo.close();
  });

  it("still carries the narration, just not as dialogue", () => {
    const { repo } = freshWorld();
    const b = performDirective(repo, {
      actor: "vance",
      action: "snub",
      target: "okonkwo",
      dialogue_intent: "makes the omission obvious enough that everyone counts it",
      arc_id: "arc_kiln_debt",
      significance_hint: 0.5,
      canon_deltas: [],
    })!;
    expect(b.stage).toBe("makes the omission obvious enough that everyone counts it");
    expect(b.lines).not.toContain(b.stage);
    repo.close();
  });

  it("a silent action produces no spoken words at all", () => {
    const { repo } = freshWorld();
    // snub has no opener and no history to cite: the character says nothing.
    const b = performDirective(repo, {
      actor: "quill",
      action: "hold",
      target: "vance",
      dialogue_intent: "says nothing and lets the silence be the message",
      arc_id: "arc_almshouse_lease",
      significance_hint: 0.2,
      canon_deltas: [],
    })!;
    expect(b.lines).toEqual([]);
    expect(b.stage).toBeTruthy();
    repo.close();
  });

  it("spoken lines survive -- this is not just deleting dialogue", () => {
    const { repo } = freshWorld();
    const b = performDirective(repo, {
      actor: "vance",
      action: "confront",
      target: "okonkwo",
      dialogue_intent: "says the thing out loud, in front of witnesses",
      arc_id: "arc_kiln_debt",
      significance_hint: 0.7,
      canon_deltas: [],
    })!;
    expect(b.lines.length).toBeGreaterThan(0);
    expect(b.lines[0]).toContain("Okonkwo"); // the opener addresses them by name
    // and the narration is still carried, just not spoken
    expect(b.stage).toContain("says the thing out loud");
    repo.close();
  });
});

describe("a character addressing someone speaks to them, not about them", () => {
  it("uses second person for the visitor's own remembered moment", async () => {
    const { repo, clock } = freshWorld();
    const surface = new MemorySurface();
    const ctx: TickContext = {
      repo, clock, surface,
      host: new MockHostRuntime({ seed: 1 }),
      dailyBudget: 500, advanceMs: 4 * HOUR_MS,
    };
    const { onboardVisitor, visitorAction } = await import("../src/tick/runTick.js");
    await onboardVisitor(ctx, "wren", "Wren");
    clock.advance(3 * HOUR_MS);
    await visitorAction(ctx, "wren", "backed okonkwo against vance in front of the whole ward");
    repo.setPresence("wren", false);
    for (let i = 0; i < 18; i++) await runTick(ctx);
    repo.setPresence("wren", true);

    const before = surface.presented.length;
    await visitorAction(ctx, "wren", "returned to the ward after days away");
    const said = surface.presented.slice(before).flatMap((b) => b.lines);
    expect(said.length).toBeGreaterThan(0);

    // "They took my side" said to Wren's face shipped in a screenshot.
    const thirdPerson = said.filter((l) => /\b(they|them|their)\b/i.test(l));
    expect(thirdPerson, `spoke about the listener in the third person:\n${thirdPerson.join("\n")}`)
      .toEqual([]);
    repo.close();
  });
});

describe("the host writes the dialogue", () => {
  it("renders the host's speech rather than a canned opener", () => {
    const { repo } = freshWorld();
    const b = performDirective(repo, {
      actor: "vance",
      action: "confront",
      target: "okonkwo",
      speech: ["You have had three weeks.", "I am not asking again."],
      dialogue_intent: "says it in front of the queue",
      arc_id: "arc_kiln_debt",
      significance_hint: 0.7,
      canon_deltas: [],
    })!;
    expect(b.lines).toContain("You have had three weeks.");
    expect(b.lines).toContain("I am not asking again.");
    expect(b.hostLines).toBe(2);
    repo.close();
  });

  it("falls back to a canned opener only when the host wrote nothing", () => {
    const { repo } = freshWorld();
    const b = performDirective(repo, {
      actor: "vance", action: "confront", target: "okonkwo",
      dialogue_intent: "says it in front of the queue",
      arc_id: "arc_kiln_debt", significance_hint: 0.7, canon_deltas: [],
    })!;
    expect(b.hostLines).toBe(0);
    expect(b.lines.length).toBeGreaterThan(0); // still speaks, just not the host's words
    repo.close();
  });

  it("host speech is still tone-checked and voice-capped", () => {
    const { repo } = freshWorld();
    const b = performDirective(repo, {
      actor: "vance", action: "confront", target: "okonkwo",
      speech: ["As you know, little did they know, this is a banned phrase."],
      dialogue_intent: "says it", arc_id: "arc_kiln_debt",
      significance_hint: 0.5, canon_deltas: [],
    })!;
    // the tone filter runs on host output exactly as on our own
    expect(b.lines.join(" ")).not.toMatch(/as you know/i);
    repo.close();
  });
});
