import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import { extendPiece, ExtendError, getPiece, lineage, listPieces, seedPiece, waitingFor } from "../src/pieces/repo.js";

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
