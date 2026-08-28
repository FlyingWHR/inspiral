import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import {
  describeDiff,
  diffMoves,
  extendPiece,
  ExtendError,
  getPiece,
  lineage,
  listPieces,
  seedPiece,
  waitingFor,
} from "../src/pieces/repo.js";

setLogLevel("silent");

const link = (id: string) => `https://x.test/e/${id}`;
const world = () => CanonRepo.open(":memory:", new VirtualClock("2026-03-01T09:00:00.000Z"));

/** Seed a piece and take one extension from `who`, returning that event id. */
function firstTake(repo: CanonRepo, who: string, body: string) {
  const piece = seedPiece(repo, { title: "Five Ingredients", brief: "Make something good." });
  const seed = getPiece(repo, piece.piece_id)!;
  const r = extendPiece(repo, {
    piece_id: seed.piece_id,
    parent_event_id: lineage(repo, seed.piece_id)!.seed_event_id,
    fan_id: who,
    body,
  });
  return { piece: seed, mine: r.extension.event_id, notifies: r.notifies };
}

describe("pieces", () => {
  it("seeds a piece nobody has touched yet", () => {
    const repo = world();
    const p = seedPiece(repo, { title: "Five Ingredients", brief: "Make something good." });
    expect(p.generation).toBe(0);
    expect(p.contributors).toEqual([]);
    expect(listPieces(repo)).toHaveLength(1);
    expect(lineage(repo, p.piece_id)!.seed_event_id).toBeTruthy();
    repo.close();
  });

  it("extending the creator's seed notifies nobody", () => {
    const repo = world();
    const { notifies } = firstTake(repo, "ada", "Start with the fennel.");
    // Inventing a recipient here is the first step toward fake activity.
    expect(notifies).toBeNull();
    repo.close();
  });

  it("THE PRODUCT: building on somebody's work notifies them, and they can see it", () => {
    const repo = world();
    const { piece, mine } = firstTake(repo, "ada", "Start with the fennel.");

    const r = extendPiece(repo, {
      piece_id: piece.piece_id,
      parent_event_id: mine,
      fan_id: "maya",
      body: "Cut it with acid instead of reducing.",
      changed: "Maya kept your base and cut it with acid instead of reducing.",
      display_name: "Maya",
    });
    expect(r.notifies).toBe("ada");

    const waiting = waitingFor(repo, "ada", link);
    expect(waiting.items).toHaveLength(1);
    const it0 = waiting.items[0]!;
    expect(it0.your_event_id).toBe(mine);
    expect(it0.your_body).toBe("Start with the fennel.");
    expect(it0.their_display_name).toBe("Maya");
    expect(it0.changed).toContain("acid");
    expect(it0.permalink).toContain(it0.their_event_id);
    repo.close();
  });

  it("says nothing rather than inventing a reason to come back", () => {
    const repo = world();
    firstTake(repo, "ada", "Start with the fennel.");
    expect(waitingFor(repo, "ada", link).items).toEqual([]);
    expect(waitingFor(repo, "nobody", link).items).toEqual([]);
    repo.close();
  });

  it("does not tell you about your own work", () => {
    const repo = world();
    const { piece, mine } = firstTake(repo, "ada", "Start with the fennel.");
    extendPiece(repo, {
      piece_id: piece.piece_id, parent_event_id: mine, fan_id: "ada", body: "Actually, roast it.",
    });
    expect(waitingFor(repo, "ada", link).items).toEqual([]);
    repo.close();
  });

  it("counts generations and contributors without ranking anyone", () => {
    const repo = world();
    const { piece, mine } = firstTake(repo, "ada", "a");
    extendPiece(repo, { piece_id: piece.piece_id, parent_event_id: mine, fan_id: "maya", body: "b" });
    extendPiece(repo, { piece_id: piece.piece_id, parent_event_id: mine, fan_id: "ada", body: "c" });
    const p = getPiece(repo, piece.piece_id)!;
    expect(p.generation).toBe(3);
    expect(p.contributors).toEqual(["ada", "maya"]); // order of first appearance, no counts
    repo.close();
  });

  it("refuses a parent from a different lineage", () => {
    const repo = world();
    const a = firstTake(repo, "ada", "a");
    const b = seedPiece(repo, { title: "Another Thing", brief: "..." });
    expect(() =>
      extendPiece(repo, { piece_id: b.piece_id, parent_event_id: a.mine, fan_id: "maya", body: "x" }),
    ).toThrow(ExtendError);
    repo.close();
  });

  it("refuses a closed piece and a missing parent", () => {
    const repo = world();
    const { piece, mine } = firstTake(repo, "ada", "a");
    expect(() =>
      extendPiece(repo, { piece_id: piece.piece_id, parent_event_id: "evt_nope", fan_id: "m", body: "x" }),
    ).toThrow(/nothing to build on/);
    expect(() =>
      extendPiece(repo, { piece_id: "nosuch", parent_event_id: mine, fan_id: "m", body: "x" }),
    ).toThrow(/no piece/);
    repo.close();
  });

  it("keeps the work when the host writes no sentence", () => {
    const repo = world();
    const { piece, mine } = firstTake(repo, "ada", "a");
    const r = extendPiece(repo, {
      piece_id: piece.piece_id, parent_event_id: mine, fan_id: "maya", body: "b",
    });
    expect(r.extension.changed).toBeUndefined();
    // Losing the narration must never lose the contribution.
    expect(lineage(repo, piece.piece_id)!.extensions).toHaveLength(2);
    expect(waitingFor(repo, "ada", link).items).toHaveLength(1);
    repo.close();
  });

  it("lineage is append-only: the database refuses to rewrite attribution", () => {
    const repo = world();
    const { mine } = firstTake(repo, "ada", "a");
    expect(() =>
      (repo as unknown as { db: { prepare(s: string): { run(...a: unknown[]): unknown } } }).db
        .prepare("UPDATE events SET payload = ? WHERE event_id = ?")
        .run('{"fan_id":"thief"}', mine),
    ).toThrow();
    repo.close();
  });
});

/**
 * Lineage order was reversed and nothing caught it for a whole layer.
 *
 * `eventsInvolving` returns newest-first and Array.sort is stable, so sorting
 * on `ts` alone left equal timestamps in arrival order -- backwards. Under a
 * VirtualClock every event shares a timestamp, so this was the normal case in
 * every test, and it means an argument read in reverse with the second speaker
 * appearing to have gone first.
 */
describe("lineage order", () => {
  it("is oldest-first even when every timestamp is identical", () => {
    const repo = world(); // VirtualClock: no time passes between these
    const p = seedPiece(repo, { title: "Order", brief: "b" });
    let parent = lineage(repo, p.piece_id)!.seed_event_id;
    for (const who of ["ada", "maya", "tomas"]) {
      parent = extendPiece(repo, {
        piece_id: p.piece_id, parent_event_id: parent, fan_id: who, body: `${who} was here`,
      }).extension.event_id;
    }
    const bodies = lineage(repo, p.piece_id)!.extensions.map((e) => e.body);
    expect(bodies).toEqual(["ada was here", "maya was here", "tomas was here"]);
    repo.close();
  });
});

/**
 * A MOVE IS CHOICES. The textarea was wrong four ways: not IP-specific, the
 * diff had to be guessed, nothing structured to render, and a blank page is
 * why the 1% who create stay 1%.
 */
describe("moves", () => {
  const SCHEMA = [
    { key: "main", label: "Main", options: ["fennel", "leek", "celeriac"], required: true },
    { key: "method", label: "Method", options: ["braise", "raw", "roast"], required: true },
    { key: "finish", label: "Finish", options: ["lemon", "vinegar", "none"], required: false },
  ];

  const kitchen = () => {
    const repo = world();
    const p = seedPiece(repo, { title: "Service", brief: "one dish", schema: SCHEMA });
    const seed = lineage(repo, p.piece_id)!.seed_event_id;
    const first = extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: seed, fan_id: "ada", display_name: "Ada",
      body: "sweet before anything else",
      values: { main: "fennel", method: "braise", finish: "lemon" },
    });
    return { repo, piece: p, mine: first.extension.event_id };
  };

  it("stores what was picked and hands it back", () => {
    const { repo, piece, mine } = kitchen();
    expect(getPiece(repo, piece.piece_id)!.schema).toHaveLength(3);
    const x = lineage(repo, piece.piece_id)!.extensions.find((e) => e.event_id === mine)!;
    expect(x.values).toEqual({ main: "fennel", method: "braise", finish: "lemon" });
    repo.close();
  });

  it("computes the diff instead of guessing it", () => {
    const d = diffMoves(SCHEMA,
      { main: "fennel", method: "braise", finish: "lemon" },
      { main: "fennel", method: "raw", finish: "vinegar" });
    expect(d.kept).toEqual([{ key: "main", label: "Main", value: "fennel" }]);
    expect(d.changed.map((c) => `${c.key}:${c.from}>${c.to}`))
      .toEqual(["method:braise>raw", "finish:lemon>vinegar"]);
    expect(describeDiff(d)).toContain("KEPT Main: fennel");
    repo_noop();
  });

  it("never stores a value the schema does not offer", () => {
    const { repo, piece, mine } = kitchen();

    // On an OPTIONAL slot, an unknown value is dropped and the move stands.
    const ok = extendPiece(repo, {
      piece_id: piece.piece_id, parent_event_id: mine, fan_id: "maya", body: "smuggled finish",
      values: { main: "fennel", method: "raw", finish: "a squeeze of yuzu" },
    });
    expect(ok.extension.values.finish).toBeUndefined();
    expect(ok.extension.values.method).toBe("raw");

    // On a REQUIRED one it is a refusal, not a silent drop -- dropping it
    // would store a half-move and call it complete.
    expect(() => extendPiece(repo, {
      piece_id: piece.piece_id, parent_event_id: mine, fan_id: "maya", body: "smuggled method",
      values: { main: "fennel", method: "sous-vide" },
    })).toThrow(/pick a method/);

    repo.close();
  });

  it("refuses a move that leaves a required slot empty", () => {
    const { repo, piece, mine } = kitchen();
    expect(() => extendPiece(repo, {
      piece_id: piece.piece_id, parent_event_id: mine, fan_id: "maya", body: "half a move",
      values: { main: "leek" },
    })).toThrow(/pick a method/);
    repo.close();
  });

  it("ignores a slot added after somebody moved, rather than accusing them", () => {
    // A schema that gained a slot must not retroactively report a removal.
    const d = diffMoves(SCHEMA, { main: "fennel" }, { main: "fennel", method: "raw" });
    expect(d.changed).toEqual([]);
    expect(d.kept).toEqual([{ key: "main", label: "Main", value: "fennel" }]);
    repo_noop();
  });

  it("still takes a free-text piece, so nothing already written breaks", () => {
    const repo = world();
    const p = seedPiece(repo, { title: "Open", brief: "say anything" });
    expect(p.schema).toEqual([]);
    const seed = lineage(repo, p.piece_id)!.seed_event_id;
    const r = extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: seed, fan_id: "ada", body: "a whole paragraph",
    });
    expect(r.extension.values).toEqual({});
    repo.close();
  });
});

/** diffMoves is pure; these cases need no database. */
function repo_noop(): void {}

/**
 * The palette disables its own button on a no-op, but a rule enforced in one
 * client is not enforced. An API caller could post an identical move and the
 * parent's author would be told somebody built on their work when nobody had
 * -- the one thing this product must never do.
 */
describe("a move that changes nothing", () => {
  const SCHEMA = [
    { key: "main", label: "Main", options: ["fennel", "chicory"], required: true },
    { key: "method", label: "Method", options: ["braise", "raw"], required: true },
  ];

  it("is refused, however the caller reaches it", () => {
    const repo = world();
    const p = seedPiece(repo, { title: "Dish", brief: "one thing", schema: SCHEMA });
    const seed = lineage(repo, p.piece_id)!.seed_event_id;
    const first = extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: seed, fan_id: "ada", body: "as it stands",
      values: { main: "fennel", method: "braise" },
    }).extension.event_id;

    expect(() => extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: first, fan_id: "maya", body: "identical",
      values: { main: "fennel", method: "braise" },
    })).toThrow(/change one thing/);

    // One slot different is enough.
    const ok = extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: first, fan_id: "maya", body: "raw instead",
      values: { main: "fennel", method: "raw" },
    });
    expect(ok.notifies).toBe("ada");
    repo.close();
  });

  it("does not apply to free text, where repeating yourself is rude, not false", () => {
    const repo = world();
    const p = seedPiece(repo, { title: "Open", brief: "say anything" });
    const seed = lineage(repo, p.piece_id)!.seed_event_id;
    const a = extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: seed, fan_id: "ada", body: "the same words",
    }).extension.event_id;
    expect(() => extendPiece(repo, {
      piece_id: p.piece_id, parent_event_id: a, fan_id: "maya", body: "the same words",
    })).not.toThrow();
    repo.close();
  });
});
