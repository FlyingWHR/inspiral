import { describe, expect, it } from "vitest";
import { roleOf, fillSlate, DEFAULT_POLICY, CONTENT_ROLES } from "../src/ip/roles.js";

const ev = (o: Record<string, unknown>) =>
  ({ type: "confrontation", actors: ["a"], payload: {}, ...o }) as never;

describe("content roles say what a clip is FOR", () => {
  it("never clips a hold, which is most of the log", () => {
    expect(roleOf(ev({ type: "arc_advanced", payload: { action: "hold" } }))).toBeNull();
  });

  it("reads the action, not the type, because hold and arc_advance share one", () => {
    const hold = ev({ type: "arc_advanced", payload: { action: "hold" } });
    const real = ev({ type: "arc_advanced", payload: { action: "confront" } });
    expect(roleOf(hold)).toBeNull();
    expect(roleOf(real)).toBe("reach");
  });

  it("calls the world paying a cost it incurred `trust`", () => {
    expect(roleOf(ev({ type: "arc_resolved" }))).toBe("trust");
    expect(roleOf(ev({ payload: { action: "concede" } }))).toBe("trust");
  });

  it("calls a public exclusion `identity`, because it makes a viewer take a side", () => {
    expect(roleOf(ev({ payload: { action: "snub" } }))).toBe("identity");
    expect(roleOf(ev({ payload: { action: "break_alliance" } }))).toBe("identity");
  });

  it("calls an opened arc `conversion` -- a door a visitor could walk into", () => {
    expect(roleOf(ev({ type: "arc_opened" }))).toBe("conversion");
  });

  it("calls anything with a visitor in it `community`", () => {
    expect(roleOf(ev({ actors: ["okonkwo", "fan:wren"], payload: { action: "snub" } }))).toBe("community");
  });
});

describe("the slate is a portfolio, not a ranking", () => {
  const mk = (role: string, i: number) => ({ role, i });
  const roleFor = (t: { role: string }) => t.role as never;

  it("does not hand every slot to the highest-ranked role", () => {
    const all = [
      ...Array.from({ length: 8 }, (_, i) => mk("reach", i)),
      mk("trust", 0), mk("identity", 0), mk("value", 0),
    ];
    const slate = fillSlate(all, roleFor, 4);
    const roles = new Set(slate.map((s) => s.role));
    expect(roles.size).toBeGreaterThan(1);
    expect(slate.filter((s) => s.role === "reach").length).toBeLessThanOrEqual(3);
  });

  it("degrades to fewer clips rather than padding when a role has nothing", () => {
    // A quiet world with only two eligible events must return two, not loop.
    const slate = fillSlate([mk("reach", 0), mk("value", 0)], roleFor, 6);
    expect(slate.length).toBe(2);
  });

  it("respects a role ceiling even when filling by rank", () => {
    const all = Array.from({ length: 10 }, (_, i) => mk("conversion", i));
    const slate = fillSlate(all, roleFor, 5);
    const cap = DEFAULT_POLICY.find((p) => p.role === "conversion")!.max;
    expect(slate.length).toBeLessThanOrEqual(cap);
  });

  it("counts what the window already holds, so quotas hold across runs", () => {
    const all = [mk("trust", 0), mk("reach", 0), mk("reach", 1)];
    // trust already satisfied this window, so it should not be prioritised.
    const slate = fillSlate(all, roleFor, 1, { trust: 2 });
    expect(slate[0]!.role).toBe("reach");
  });

  it("drops anything with no role at all", () => {
    const slate = fillSlate([{ role: null }, mk("reach", 0)] as never[], (t: never) => (t as { role: string }).role as never, 3);
    expect(slate.length).toBe(1);
  });

  it("covers every declared role in the policy", () => {
    for (const r of CONTENT_ROLES) expect(DEFAULT_POLICY.some((p) => p.role === r)).toBe(true);
  });
});
