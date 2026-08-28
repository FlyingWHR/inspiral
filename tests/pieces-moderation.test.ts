import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import {
  extendRate,
  hide,
  hiddenOn,
  isHidden,
  ModerationError,
  report,
  reportsOn,
  withoutHidden,
} from "../src/pieces/moderation.js";
import { extendPiece, lineage, seedPiece } from "../src/pieces/repo.js";

setLogLevel("silent");

function world(): { repo: CanonRepo; clock: VirtualClock } {
  const clock = new VirtualClock("2026-03-01T09:00:00.000Z");
  return { repo: CanonRepo.open(":memory:", clock), clock };
}

/** A piece with one contribution from Ada and one from Maya on top of it. */
function scene(repo: CanonRepo) {
  const piece = seedPiece(repo, { title: "Five Ingredients", brief: "Make something good." });
  const root = lineage(repo, piece.piece_id)!.seed_event_id;
  const ada = extendPiece(repo, {
    piece_id: piece.piece_id,
    parent_event_id: root,
    fan_id: "ada",
    body: "Start with the fennel.",
    display_name: "Ada",
  }).extension.event_id;
  const maya = extendPiece(repo, {
    piece_id: piece.piece_id,
    parent_event_id: ada,
    fan_id: "maya",
    body: "Cut it with acid instead.",
    display_name: "Maya",
  }).extension.event_id;
  return { piece, root, ada, maya };
}

describe("report -- recorded, never dropped", () => {
  it("a report is appended to the log as its own event", () => {
    const { repo } = world();
    const { piece, maya } = scene(repo);

    const before = repo.eventCount();
    const r = report(repo, { fan_id: "ada", event_id: maya, reason: "That is a copy of my post." });

    expect(repo.eventCount()).toBe(before + 1);
    const e = repo.getEvent(r.event_id)!;
    expect(e.type).toBe("piece_reported");
    expect(e.payload.target_event_id).toBe(maya);
    expect(e.payload.reason).toBe("That is a copy of my post.");
    expect(r.piece_id).toBe(piece.piece_id);

    // And the creator can read it back. A write-only report is a dropped one.
    expect(reportsOn(repo, piece.piece_id).map((x) => x.event_id)).toEqual([r.event_id]);
    repo.close();
  });

  it("reporting changes nothing about what is visible", () => {
    const { repo } = world();
    const { piece, maya } = scene(repo);
    report(repo, { fan_id: "ada", event_id: maya, reason: "Not ok." });

    // The module records and reports. It does not decide.
    expect(isHidden(repo, maya)).toBe(false);
    expect(withoutHidden(repo, lineage(repo, piece.piece_id)!).extensions).toHaveLength(2);
    repo.close();
  });

  it("refuses a report that would sit in the log pointing at nothing", () => {
    const { repo } = world();
    const { root, maya } = scene(repo);

    expect(() => report(repo, { fan_id: "ada", event_id: "evt_nope", reason: "x" })).toThrow(
      ModerationError,
    );
    // The creator's seed is a brief, not a person's contribution.
    expect(() => report(repo, { fan_id: "ada", event_id: root, reason: "x" })).toThrow(
      /only a contribution/,
    );
    expect(() => report(repo, { fan_id: "ada", event_id: maya, reason: "   " })).toThrow(
      /needs a reason/,
    );
    repo.close();
  });
});

describe("hide -- additive, never a mutation", () => {
  it("hiding adds an event and leaves the original untouched", () => {
    const { repo } = world();
    const { maya } = scene(repo);

    const original = repo.getEvent(maya)!;
    const before = repo.eventCount();

    const h = hide(repo, maya, "creator");

    expect(repo.eventCount()).toBe(before + 1);
    expect(h.event_id).not.toBe(maya);
    expect(repo.getEvent(h.event_id)!.type).toBe("piece_hidden");

    // ATTRIBUTION SURVIVES. The log refuses UPDATE and DELETE by design, and
    // this is the assertion that says hiding respects that rather than routing
    // around it: Maya's work, her name and her receipt are all still there.
    const after = repo.getEvent(maya)!;
    expect(after).toEqual(original);
    expect(after.payload.fan_id).toBe("maya");
    expect(after.payload.body).toBe("Cut it with acid instead.");
    repo.close();
  });

  it("hidden contributions drop out of a lineage, and only those", () => {
    const { repo } = world();
    const { piece, ada, maya } = scene(repo);
    hide(repo, maya, "creator");

    const raw = lineage(repo, piece.piece_id)!;
    expect(raw.extensions.map((x) => x.event_id)).toEqual([ada, maya]);

    const shown = withoutHidden(repo, raw);
    expect(shown.extensions.map((x) => x.event_id)).toEqual([ada]);
    expect(isHidden(repo, maya)).toBe(true);
    expect(isHidden(repo, ada)).toBe(false);
    expect([...hiddenOn(repo, piece.piece_id)]).toEqual([maya]);

    // Visibility is a read-time decision, not a rewrite of who was there.
    expect(shown.piece.generation).toBe(2);
    expect(shown.piece.contributors).toEqual(["ada", "maya"]);
    repo.close();
  });

  it("a lineage with nothing hidden comes back as it went in", () => {
    const { repo } = world();
    const { piece } = scene(repo);
    const raw = lineage(repo, piece.piece_id)!;
    expect(withoutHidden(repo, raw)).toBe(raw);
    repo.close();
  });
});

describe("rate limit -- a cap, not a punishment", () => {
  const cap = { max: 3, hours: 1 };

  it("triggers on the cap and releases when the window slides", () => {
    const { repo, clock } = world();
    const piece = seedPiece(repo, { title: "Five Ingredients", brief: "Make something good." });
    let parent = lineage(repo, piece.piece_id)!.seed_event_id;

    const take = (body: string): string => {
      parent = extendPiece(repo, {
        piece_id: piece.piece_id,
        parent_event_id: parent,
        fan_id: "flood",
        body,
      }).extension.event_id;
      return parent;
    };

    expect(extendRate(repo, "flood", cap).ok).toBe(true);
    take("one");
    take("two");
    expect(extendRate(repo, "flood", cap)).toMatchObject({ ok: true, recent: 2, limit: 3 });

    take("three");
    const capped = extendRate(repo, "flood", cap);
    expect(capped.ok).toBe(false);
    expect(capped.recent).toBe(3);
    // Honest about when, so a caller can say so instead of "try again later".
    expect(capped.retry_after).toBe("2026-03-01T10:00:00.000Z");

    // RELEASES ON ITS OWN. Nothing is scheduled and nothing is swept: the
    // window slides and the oldest extension ages out of the count.
    clock.advanceHours(1.5);
    expect(extendRate(repo, "flood", cap)).toMatchObject({ ok: true, recent: 0 });
    repo.close();
  });

  it("counts one person, not the piece", () => {
    const { repo } = world();
    const { piece, ada } = scene(repo);
    let parent = ada;
    for (const body of ["a body", "another body", "a third body"]) {
      parent = extendPiece(repo, {
        piece_id: piece.piece_id,
        parent_event_id: parent,
        fan_id: "flood",
        body,
      }).extension.event_id;
    }
    expect(extendRate(repo, "flood", cap).ok).toBe(false);
    // Ada has one contribution and is not collateral damage.
    expect(extendRate(repo, "ada", cap)).toMatchObject({ ok: true, recent: 1 });
    repo.close();
  });

  it("reports do not count against the extension cap", () => {
    const { repo } = world();
    const { maya } = scene(repo);
    report(repo, { fan_id: "ada", event_id: maya, reason: "Not ok." });
    report(repo, { fan_id: "ada", event_id: maya, reason: "Still not ok." });
    expect(extendRate(repo, "ada", cap)).toMatchObject({ ok: true, recent: 1 });
    repo.close();
  });
});
