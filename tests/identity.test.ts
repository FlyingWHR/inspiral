import { describe, expect, it } from "vitest";
import { WebSurface } from "../src/runtime/webSurface.js";

/**
 * THE WORLD REMEMBERS A PERSON, NOT A SEAT.
 *
 * `claimIdentity` used to return the first identity nobody was holding at that
 * instant. Wren takes a side and closes the tab; the slot frees; a stranger
 * arrives tomorrow, becomes Wren, and is greeted as an ally who "took my side
 * in public when it cost you something" -- citing a real event_id for something
 * they never did. Every citation stayed verifiable and every one of them was
 * about the wrong human, which is the worst shape this failure can take.
 *
 * Reaching in with `any` on purpose: claimIdentity is private, and the whole
 * point is to pin behaviour that is invisible from the public surface.
 */
const claim = (s: WebSurface, requested?: string): { id: string; name: string } =>
  (s as unknown as { claimIdentity(r?: string): { id: string; name: string } })
    .claimIdentity(requested);

describe("visitor identity", () => {
  it("never hands a departed visitor's name to a stranger", () => {
    const met: string[] = [];
    const s = new WebSurface({ knownVisitors: () => met });

    const first = claim(s); // nobody has ever visited
    expect(first.id).toBe("wren");

    met.push(first.id); // Wren visited, took a side, and left

    const stranger = claim(s); // a different browser, tomorrow
    expect(stranger.id).not.toBe("wren");
  });

  it("gives a returning browser its own identity back", () => {
    const s = new WebSurface({ knownVisitors: () => ["wren"] });
    const back = claim(s, "wren");
    expect(back).toEqual({ id: "wren", name: "Wren" });
  });

  it("keeps minting once the pool is exhausted, without reusing a name", () => {
    const met = ["wren", "ash", "juno", "pell"];
    const s = new WebSurface({ knownVisitors: () => met });
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const who = claim(s);
      expect(met).not.toContain(who.id);
      ids.add(who.id);
    }
    expect(ids.size).toBe(25);
  });

  it("refuses a malformed claimed id rather than trusting it", () => {
    const s = new WebSurface({ knownVisitors: () => [] });
    for (const bad of ["", "  ", "a", "../../etc/passwd", "wren; drop table", "x".repeat(120)]) {
      expect(claim(s, bad).id).not.toBe(bad);
    }
  });

  it("is stable: the same id always renders the same display name", () => {
    const s = new WebSurface({ knownVisitors: () => [] });
    expect(claim(s, "guest_ab12cd34").name).toBe(claim(s, "guest_ab12cd34").name);
  });
});
