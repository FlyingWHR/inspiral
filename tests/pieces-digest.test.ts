import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import type { HostRequest, HostResponse, HostRuntime } from "../src/host/HostRuntime.js";
import { creatorDigest, renderDigest } from "../src/pieces/digest.js";
import { hide } from "../src/pieces/moderation.js";
import { extendPiece, lineage, seedPiece } from "../src/pieces/repo.js";

setLogLevel("silent");

/** A host that answers, refuses, or counts how often it was bothered. */
class Says implements HostRuntime {
  readonly name = "says";
  asked = 0;
  lastPrompt = "";
  constructor(private readonly reply: string | { fail: true }) {}
  async init(): Promise<void> {}
  async ask(req: HostRequest): Promise<HostResponse> {
    this.asked += 1;
    this.lastPrompt = req.prompt;
    if (typeof this.reply !== "string") {
      return { ok: false, reason: "error", message: "down", latencyMs: 1 };
    }
    return { ok: true, text: this.reply, latencyMs: 1 };
  }
  async budgetRemaining(): Promise<number | undefined> {
    return undefined;
  }
  async close(): Promise<void> {}
}

function world(): { repo: CanonRepo; clock: VirtualClock } {
  const clock = new VirtualClock("2026-03-01T09:00:00.000Z");
  return { repo: CanonRepo.open(":memory:", clock), clock };
}

const seed = (repo: CanonRepo, title: string) =>
  seedPiece(repo, { title, brief: "Make something good." });

/** Take one extension and hand back its event id. */
function extend(
  repo: CanonRepo,
  pieceId: string,
  parent: string,
  fan: string,
  body: string,
  name?: string,
): string {
  return extendPiece(repo, {
    piece_id: pieceId,
    parent_event_id: parent,
    fan_id: fan,
    body,
    display_name: name,
  }).extension.event_id;
}

const seedOf = (repo: CanonRepo, pieceId: string) => lineage(repo, pieceId)!.seed_event_id;

describe("creator digest -- counts come from the log", () => {
  it("a dead host costs the paragraph, never the numbers", async () => {
    const { repo } = world();
    const p = seed(repo, "Five Ingredients");
    const root = seedOf(repo, p.piece_id);
    const ada = extend(repo, p.piece_id, root, "ada", "Start with the fennel.", "Ada");
    extend(repo, p.piece_id, ada, "maya", "Cut it with acid instead.", "Maya");

    const down = new Says({ fail: true });
    const d = await creatorDigest(repo, down, { hours: 24 });

    expect(d.summary).toBeUndefined();
    expect(d.totals.extensions).toBe(2);
    expect(d.totals.contributors).toBe(2);
    expect(d.totals.pieces_touched).toBe(1);
    expect(d.moved).toHaveLength(1);
    expect(d.moved[0]!.extensions).toBe(2);
    expect(d.moved[0]!.contributors).toEqual(["ada", "maya"]);
    // The facts still render without the Mind.
    expect(renderDigest(d)).toContain("2 contribution(s) from 2 person/people");
    repo.close();
  });

  it("no host at all is the same answer, minus the paragraph", async () => {
    const { repo } = world();
    const p = seed(repo, "Five Ingredients");
    extend(repo, p.piece_id, seedOf(repo, p.piece_id), "ada", "Start with the fennel.");

    const d = await creatorDigest(repo, undefined, { hours: 24 });
    expect(d.summary).toBeUndefined();
    expect(d.totals.extensions).toBe(1);
    repo.close();
  });

  it("says nothing happened, and does not ask the host to say otherwise", async () => {
    const { repo, clock } = world();
    seed(repo, "Five Ingredients");
    clock.advanceHours(48);

    const eager = new Says("Loads of exciting activity in your world today!");
    const d = await creatorDigest(repo, eager, { hours: 24 });

    expect(d.nothing_happened).toBe(true);
    expect(d.moved).toEqual([]);
    expect(d.newcomers).toEqual([]);
    expect(d.unanswered).toEqual([]);
    expect(d.summary).toBeUndefined();
    // Structural, not a line in a prompt: an empty window is the one input a
    // model will reliably invent activity from, so it is never shown one.
    expect(eager.asked).toBe(0);

    const text = renderDigest(d);
    expect(text).toContain("Nothing happened.");
    expect(text).not.toContain("exciting");
    // A seeded piece nobody has touched is a real fact, not invented activity.
    expect(d.quiet).toHaveLength(1);
    expect(d.quiet[0]!.never_touched).toBe(true);
    repo.close();
  });

  it("finds the contributions nobody has built on, longest wait first", async () => {
    const { repo, clock } = world();
    const p = seed(repo, "Five Ingredients");
    const root = seedOf(repo, p.piece_id);

    const ada = extend(repo, p.piece_id, root, "ada", "Start with the fennel.", "Ada");
    clock.advanceHours(1);
    const maya = extend(repo, p.piece_id, ada, "maya", "Cut it with acid.", "Maya");
    clock.advanceHours(1);
    const wren = extend(repo, p.piece_id, root, "wren", "Char the leeks first.", "Wren");
    clock.advanceHours(2);

    const d = await creatorDigest(repo, undefined, { hours: 24 });

    // Ada was answered by Maya. Maya and Wren are the leaves.
    expect(d.unanswered.map((u) => u.event_id)).toEqual([maya, wren]);
    expect(d.unanswered[0]!.display_name).toBe("Maya");
    expect(d.unanswered[0]!.waiting_hours).toBe(3);
    expect(d.unanswered[1]!.waiting_hours).toBe(2);
    expect(renderDigest(d)).toContain("this is the one to fix");
    repo.close();
  });

  it("never tells the creator to answer something they just hid", async () => {
    const { repo, clock } = world();
    const p = seed(repo, "Five Ingredients");
    const root = seedOf(repo, p.piece_id);
    const ada = extend(repo, p.piece_id, root, "ada", "Start with the fennel.", "Ada");
    clock.advanceHours(1);
    const junk = extend(repo, p.piece_id, root, "spam", "BUY FOLLOWERS", "spam");

    hide(repo, junk, "creator");
    const d = await creatorDigest(repo, undefined, { hours: 24 });

    expect(d.unanswered.map((u) => u.event_id)).toEqual([ada]);
    expect(d.totals.extensions).toBe(1);
    repo.close();
  });

  it("a newcomer is somebody's FIRST contribution, not their newest", async () => {
    const { repo, clock } = world();
    const p = seed(repo, "Five Ingredients");
    const root = seedOf(repo, p.piece_id);
    const ada = extend(repo, p.piece_id, root, "ada", "Start with the fennel.", "Ada");

    // Ada's first contribution falls out of the window; her second does not.
    clock.advanceHours(48);
    extend(repo, p.piece_id, ada, "ada", "And then reduce it further.", "Ada");
    extend(repo, p.piece_id, ada, "maya", "Cut it with acid.", "Maya");

    const d = await creatorDigest(repo, undefined, { hours: 24 });
    expect(d.newcomers.map((n) => n.fan_id)).toEqual(["maya"]);
    repo.close();
  });

  it("a piece that has gone quiet is reported as quiet, not as movement", async () => {
    const { repo, clock } = world();
    const cold = seed(repo, "Cold Piece");
    extend(repo, cold.piece_id, seedOf(repo, cold.piece_id), "ada", "One idea, long ago.");
    clock.advanceHours(72);
    const warm = seed(repo, "Warm Piece");
    extend(repo, warm.piece_id, seedOf(repo, warm.piece_id), "maya", "Something today.");

    const d = await creatorDigest(repo, undefined, { hours: 24 });
    expect(d.moved.map((m) => m.piece_id)).toEqual([warm.piece_id]);
    expect(d.quiet.map((q) => q.piece_id)).toEqual([cold.piece_id]);
    expect(d.quiet[0]!.silent_hours).toBe(72);
    expect(d.quiet[0]!.never_touched).toBe(false);
    repo.close();
  });

  it("takes the Mind's paragraph, and only the facts go into the prompt", async () => {
    const { repo } = world();
    const p = seed(repo, "Five Ingredients");
    extend(repo, p.piece_id, seedOf(repo, p.piece_id), "ada", "Start with the fennel.", "Ada");

    const h = new Says("```\nAda's fennel has been sitting unanswered for an hour.\n```");
    const d = await creatorDigest(repo, h, { hours: 24 });

    expect(d.summary).toBe("Ada's fennel has been sitting unanswered for an hour.");
    expect(renderDigest(d)).toContain("Ada's fennel");
    expect(h.lastPrompt).toContain("Never invent a person");
    expect(h.lastPrompt).toContain("Five Ingredients");
    repo.close();
  });

  it("refuses a host that answered the wrong question", async () => {
    const { repo } = world();
    const p = seed(repo, "Five Ingredients");
    extend(repo, p.piece_id, seedOf(repo, p.piece_id), "ada", "Start with the fennel.");

    const wrong = new Says('{"directives": [{"actor": "vance", "action": "confront"}]}');
    const d = await creatorDigest(repo, wrong, { hours: 24 });
    // Silence beats showing a directive batch as "what happened in your world".
    expect(d.summary).toBeUndefined();
    expect(d.totals.extensions).toBe(1);
    repo.close();
  });
});
