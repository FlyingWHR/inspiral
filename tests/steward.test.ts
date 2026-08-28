import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { setLogLevel } from "../src/log.js";
import { extendPiece, lineage, seedPiece } from "../src/pieces/repo.js";
import { setPreference } from "../src/notify/dispatch.js";
import { creatorOf, setCreator, setSteward, stewardOf, stewardRound } from "../src/pieces/steward.js";
import type { HostRequest, HostResponse, HostRuntime } from "../src/host/HostRuntime.js";
import type { Delivery, NotifyChannel } from "../src/notify/contract.js";

setLogLevel("silent");

class Says implements HostRuntime {
  readonly name = "says";
  asked = 0;
  lastPrompt = "";
  constructor(private readonly reply: string) {}
  async init(): Promise<void> {}
  async ask(req: HostRequest): Promise<HostResponse> {
    this.asked++;
    this.lastPrompt = req.prompt;
    return { ok: true, text: this.reply, latencyMs: 1 };
  }
  async budgetRemaining(): Promise<number | undefined> { return undefined; }
  async close(): Promise<void> {}
}

class Spy implements NotifyChannel {
  readonly name = "console";
  sent: Delivery[] = [];
  async send(d: Delivery): Promise<void> { this.sent.push(d); }
}

/** A world with one contribution nobody has answered. */
function world(withCreator = true) {
  const repo = CanonRepo.open(":memory:");
  repo.setMeta("world_name", "The Kitchen");
  setSteward(repo, { name: "Maurice", role: "maître d'" });
  if (withCreator) {
    setCreator(repo, "chef");
    setPreference(repo, { fan_id: "chef", channel: "console", address: "chef@x" });
  }
  const p = seedPiece(repo, { title: "Service", brief: "one dish, five things" });
  const seed = lineage(repo, p.piece_id)!.seed_event_id;
  const ev = extendPiece(repo, {
    piece_id: p.piece_id, parent_event_id: seed, fan_id: "ada", display_name: "Ada",
    body: "Braise the fennel until it collapses, then tear the bread in.",
  }).extension.event_id;
  return { repo, ev };
}

const SAYS_NOTHING = '{"say": null, "about": null}';

describe("the steward", () => {
  it("takes the world's own name for the post", () => {
    const { repo } = world();
    expect(stewardOf(repo)).toEqual({ name: "Maurice", role: "maître d'" });
    expect(creatorOf(repo)).toBe("chef");
    repo.close();
  });

  it("SAYING NOTHING IS THE NORMAL OUTCOME and it is not an error", async () => {
    const { repo } = world();
    const spy = new Spy();
    const r = await stewardRound(repo, new Says(SAYS_NOTHING), [spy]);
    expect(r.say).toBeNull();
    expect(r.because).toBe("host said nothing");
    expect(spy.sent).toHaveLength(0);
    repo.close();
  });

  it("interrupts once when it decides something is worth it", async () => {
    const { repo, ev } = world();
    const spy = new Spy();
    const host = new Says(`{"say":"Ada's fennel has been sitting unanswered since this morning.","about":"${ev}"}`);
    const r = await stewardRound(repo, host, [spy]);
    expect(r.because).toBe("sent");
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0]!.headline).toContain("Maurice");
    expect(spy.sent[0]!.body).toContain("Ada");
    repo.close();
  });

  it("will not speak twice inside the quiet window, and does not ask the host again", async () => {
    const { repo, ev } = world();
    const spy = new Spy();
    const host = new Says(`{"say":"something","about":"${ev}"}`);
    await stewardRound(repo, host, [spy]);
    const askedOnce = host.asked;

    const again = await stewardRound(repo, host, [spy]);
    expect(again.because).toBe("spoke recently");
    expect(spy.sent).toHaveLength(1);
    // Checked BEFORE the host is asked, so a busy world costs one call a day.
    expect(host.asked).toBe(askedOnce);
    repo.close();
  });

  it("refuses to point at an event it was not shown", async () => {
    const { repo } = world();
    const spy = new Spy();
    const r = await stewardRound(repo, new Says('{"say":"look at this","about":"evt_invented"}'), [spy]);
    expect(r.say).toBe("look at this");
    // Same referential discipline as everywhere else.
    expect(r.about).toBeNull();
    repo.close();
  });

  it("says nothing when there is no creator, no host, or nothing happened", async () => {
    const spy = new Spy();

    const a = world(false);
    expect((await stewardRound(a.repo, new Says(SAYS_NOTHING), [spy])).because).toBe("no creator on this world");
    a.repo.close();

    const b = world();
    expect((await stewardRound(b.repo, undefined, [spy])).because).toBe("host unavailable");
    b.repo.close();

    const empty = CanonRepo.open(":memory:");
    setCreator(empty, "chef");
    expect((await stewardRound(empty, new Says(SAYS_NOTHING), [spy])).because).toBe("nothing happened");
    empty.close();

    expect(spy.sent).toHaveLength(0);
  });

  it("tells the host that silence is allowed", async () => {
    const { repo } = world();
    const host = new Says(SAYS_NOTHING);
    await stewardRound(repo, host, [new Spy()]);
    expect(host.lastPrompt).toContain("MOSTLY THE ANSWER IS NO");
    expect(host.lastPrompt).toContain("maître d'");
    repo.close();
  });
});
