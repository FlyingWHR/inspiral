import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import { seedPiece, extendPiece, lineage } from "../src/pieces/repo.js";
import { hide } from "../src/pieces/moderation.js";
import { dispatch, enqueue, pending, preferencesFor, setPreference, unsubscribe } from "../src/notify/dispatch.js";
import type { Delivery, NotifyChannel } from "../src/notify/contract.js";

setLogLevel("silent");

/** Records what it was asked to deliver. Optionally refuses. */
class Spy implements NotifyChannel {
  readonly name: string;
  sent: Delivery[] = [];
  constructor(name = "spy", private readonly fail = false) { this.name = name; }
  async send(d: Delivery): Promise<void> {
    if (this.fail) throw new Error("channel down");
    this.sent.push(d);
  }
}

/** A piece with `by` having left one contribution, ready to be built on. */
function world(by = "ada") {
  const repo = CanonRepo.open(":memory:", new VirtualClock("2026-03-01T09:00:00.000Z"));
  const p = seedPiece(repo, { title: "Five Ingredients", brief: "make something" });
  const seed = lineage(repo, p.piece_id)!.seed_event_id;
  const mine = extendPiece(repo, {
    piece_id: p.piece_id, parent_event_id: seed, fan_id: by, body: "braise the fennel",
    display_name: "Ada",
  }).extension.event_id;
  return { repo, piece: p, mine };
}

const buildOn = (repo: CanonRepo, piece: string, parent: string, who: string, body: string) =>
  extendPiece(repo, { piece_id: piece, parent_event_id: parent, fan_id: who, body, display_name: who });

describe("notifications", () => {
  it("queues one per person per event, however many times asked", () => {
    const { repo, piece, mine } = world();
    const r = buildOn(repo, piece.piece_id, mine, "maya", "shave it raw instead");
    expect(enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id })).toBe(true);
    // A retry, or two workers racing, must not tell somebody twice.
    expect(enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id })).toBe(false);
    expect(pending(repo)).toHaveLength(1);
    repo.close();
  });

  it("carries the sentence, because that is the reason to come back", async () => {
    const { repo, piece, mine } = world();
    const r = extendPiece(repo, {
      piece_id: piece.piece_id, parent_event_id: mine, fan_id: "maya", display_name: "Maya",
      body: "shave it raw", changed: "Maya kept your fennel and cut it with acid instead.",
    });
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id });
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "ada@x" });

    const spy = new Spy();
    const out = await dispatch(repo, [spy], { baseUrl: "https://x.test" });
    expect(out.sent).toBe(1);
    expect(spy.sent[0]!.body).toContain("cut it with acid");
    expect(spy.sent[0]!.headline).toContain("Maya");
    expect(spy.sent[0]!.url).toContain("fan=ada");
    expect(spy.sent[0]!.address).toBe("ada@x");
    repo.close();
  });

  it("batches: three people in one window is one message", async () => {
    const { repo, piece, mine } = world();
    for (const who of ["maya", "tomas", "wren"]) {
      const r = buildOn(repo, piece.piece_id, mine, who, `${who} had a go at it`);
      enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id });
    }
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "a" });
    const spy = new Spy();
    expect((await dispatch(repo, [spy])).sent).toBe(1);
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0]!.headline).toContain("3 people");
    expect(spy.sent[0]!.ids).toHaveLength(3);
    expect(pending(repo)).toHaveLength(0);
    repo.close();
  });

  it("respects the quiet window, and sends once it passes", async () => {
    const { repo, piece, mine } = world();
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "a", quiet_minutes: 30 });
    const spy = new Spy();

    const first = buildOn(repo, piece.piece_id, mine, "maya", "first change here");
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: first.extension.event_id });
    let t = Date.parse("2026-03-01T09:00:00.000Z");
    await dispatch(repo, [spy], { now: () => t });
    expect(spy.sent).toHaveLength(1);

    const second = buildOn(repo, piece.piece_id, mine, "tomas", "second change here");
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: second.extension.event_id });
    t += 5 * 60_000;
    expect((await dispatch(repo, [spy], { now: () => t })).skipped.quiet).toBe(1);
    expect(spy.sent).toHaveLength(1); // held, not dropped
    expect(pending(repo)).toHaveLength(1);

    t += 40 * 60_000;
    await dispatch(repo, [spy], { now: () => t });
    expect(spy.sent).toHaveLength(2);
    repo.close();
  });

  it("does not send to somebody who opted out, and does not lose it either", async () => {
    const { repo, piece, mine } = world();
    const r = buildOn(repo, piece.piece_id, mine, "maya", "a change of some kind");
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id });
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "a" });
    unsubscribe(repo, "ada");
    expect(preferencesFor(repo, "ada")[0]!.enabled).toBe(false);

    const spy = new Spy();
    expect((await dispatch(repo, [spy])).skipped.disabled).toBe(1);
    expect(spy.sent).toHaveLength(0);
    // Still pending: if they add an address tomorrow they should still hear.
    expect(pending(repo)).toHaveLength(1);
    repo.close();
  });

  it("a takedown stops a ping that has not gone out yet", async () => {
    const { repo, piece, mine } = world();
    const r = buildOn(repo, piece.piece_id, mine, "troll", "this is garbage and so are you");
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id });
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "a" });
    hide(repo, r.extension.event_id, "creator");

    const spy = new Spy();
    const out = await dispatch(repo, [spy]);
    expect(out.skipped.hidden).toBe(1);
    expect(spy.sent).toHaveLength(0);
    expect(pending(repo)).toHaveLength(0); // suppressed, not left to retry
    repo.close();
  });

  it("records a failure and keeps it pending for the next round", async () => {
    const { repo, piece, mine } = world();
    const r = buildOn(repo, piece.piece_id, mine, "maya", "a change of some kind");
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id });
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "a" });

    const out = await dispatch(repo, [new Spy("spy", true)]);
    expect(out.failed).toBe(1);
    const still = pending(repo);
    expect(still).toHaveLength(1);
    expect(still[0]!.attempts).toBe(1);
    expect(still[0]!.error).toContain("channel down");
    repo.close();
  });

  it("gives up after MAX_ATTEMPTS so one bad address cannot spin forever", async () => {
    const { repo, piece, mine } = world();
    const r = buildOn(repo, piece.piece_id, mine, "maya", "a change of some kind");
    enqueue(repo, { fan_id: "ada", kind: "extended", piece_id: piece.piece_id, event_id: r.extension.event_id });
    setPreference(repo, { fan_id: "ada", channel: "spy", address: "a" });
    const dead = new Spy("spy", true);
    for (let i = 0; i < 6; i++) await dispatch(repo, [dead], { now: () => Date.now() + i * 3600_000 });
    expect(pending(repo)).toHaveLength(0); // dropped out of the queue
    repo.close();
  });
});
