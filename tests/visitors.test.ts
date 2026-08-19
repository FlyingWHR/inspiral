import { describe, expect, it } from "vitest";
import { MockHostRuntime } from "../src/host/mock.js";
import { runTick, type TickContext } from "../src/tick/runTick.js";
import { visitorArrive, visitorDoes, visitorLeaves } from "../src/tick/visitors.js";
import { MemorySurface } from "../src/runtime/surface.js";
import { HOUR_MS } from "../src/clock.js";
import type { HostRequest, HostResponse, HostRuntime } from "../src/host/HostRuntime.js";
import { freshWorld } from "./helpers.js";

/** Wraps the mock so a test can assert how many invocations were spent. */
class CountingHost implements HostRuntime {
  readonly name = "counting";
  calls = 0;
  private readonly inner = new MockHostRuntime({ seed: 1 });
  async init(): Promise<void> {
    await this.inner.init();
  }
  async ask(req: HostRequest): Promise<HostResponse> {
    this.calls++;
    return this.inner.ask(req);
  }
  async budgetRemaining(): Promise<number | undefined> {
    return this.inner.budgetRemaining();
  }
  async close(): Promise<void> {
    await this.inner.close();
  }
}

function ctxFor(): TickContext & { surface: MemorySurface; host: CountingHost; close: () => void } {
  const { repo, clock } = freshWorld();
  const surface = new MemorySurface();
  const host = new CountingHost();
  return {
    repo, host, surface, clock,
    dailyBudget: 500,
    advanceMs: 4 * HOUR_MS,
    close: () => repo.close(),
  };
}

const WREN = { id: "wren", name: "Wren" };
const ASH = { id: "ash", name: "Ash" };

describe("two fans in the ward at once", () => {
  it("keeps their standing separate -- one fan acting does not move the other", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    await visitorArrive(ctx, ASH);
    const ashBefore = JSON.stringify(ctx.repo.getStance("ash"));

    // Only Wren does anything, repeatedly.
    for (let i = 0; i < 3; i++) {
      await visitorDoes(ctx, WREN, "backed okonkwo against vance in front of the whole ward");
    }

    const wren = ctx.repo.getStance("wren");
    expect(wren.okonkwo!).toBeGreaterThan(0);
    expect(wren.vance!).toBeLessThan(0);
    // Ash was standing right there and is completely unmoved: separate records,
    // not one shared opinion wearing two names.
    expect(JSON.stringify(ctx.repo.getStance("ash"))).toBe(ashBefore);
    expect(ctx.repo.getStance("ash")).not.toEqual(wren);
    ctx.close();
  });

  it("remembers them apart across a departure", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    await visitorDoes(ctx, WREN, "backed okonkwo against vance in front of the whole ward");
    visitorLeaves(ctx, WREN);

    await visitorArrive(ctx, ASH); // a stranger, even though Wren has been here
    expect(ctx.repo.visitorExists("wren")).toBe(true);
    expect(ctx.repo.visitorExists("ash")).toBe(true);
    expect(Object.keys(ctx.repo.getStance("ash"))).not.toEqual([]);
    expect(ctx.repo.getStance("wren").okonkwo!).toBeGreaterThan(0);
    ctx.close();
  });

  it("only the fan who dug gets blamed", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    await visitorArrive(ctx, ASH);
    const before = ctx.repo.allEvents().length;

    await visitorDoes(ctx, ASH, "kicked over the almshouse collection box");

    const fresh = ctx.repo.allEvents().slice(before);
    expect(fresh.some((e) => e.actors.includes("fan:ash"))).toBe(true);
    expect(fresh.some((e) => e.actors.includes("fan:wren"))).toBe(false);
    ctx.close();
  });
});

describe("coming back is cheap when nothing has happened", () => {
  it("spends no invocation on a return to an unchanged ward", async () => {
    const ctx = ctxFor();
    const first = await visitorArrive(ctx, WREN);
    expect(first.first).toBe(true);
    expect(first.cached).toBe(false);
    const afterOnboard = ctx.host.calls;
    expect(afterOnboard).toBeGreaterThan(0);

    visitorLeaves(ctx, WREN);
    const again = await visitorArrive(ctx, WREN);

    expect(again.cached).toBe(true);
    expect(again.first).toBe(false);
    expect(ctx.host.calls).toBe(afterOnboard); // not one more
    ctx.close();
  });

  it("still says something -- the replay reaches the surface", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    const said = ctx.surface.presented.length;
    expect(said).toBeGreaterThan(0);

    visitorLeaves(ctx, WREN);
    await visitorArrive(ctx, WREN);
    expect(ctx.surface.presented.length).toBeGreaterThan(said);
    ctx.close();
  });

  it("pays for the greeting once the ward has actually moved", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    visitorLeaves(ctx, WREN);
    const before = ctx.host.calls;

    for (let i = 0; i < 3; i++) await runTick(ctx); // the ward gets on with it

    const back = await visitorArrive(ctx, WREN);
    expect(back.cached).toBe(false);
    expect(ctx.host.calls).toBeGreaterThan(before);
    ctx.close();
  });

  it("does not replay a greeting after the fan changed their own standing", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    await visitorDoes(ctx, WREN, "backed okonkwo against vance in front of the whole ward");
    visitorLeaves(ctx, WREN);

    const back = await visitorArrive(ctx, WREN);
    expect(back.cached).toBe(false); // their standing moved; the old lines are stale
    ctx.close();
  });

  it("records the free return in the log, so the visit still happened", async () => {
    const ctx = ctxFor();
    await visitorArrive(ctx, WREN);
    visitorLeaves(ctx, WREN);
    const before = ctx.repo.allEvents().length;

    const back = await visitorArrive(ctx, WREN);
    expect(back.cached).toBe(true);
    const fresh = ctx.repo.allEvents().slice(before);
    expect(fresh.some((e) => e.type === "visitor_arrived")).toBe(true);
    ctx.close();
  });
});
