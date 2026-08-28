import { describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { setLogLevel } from "../src/log.js";
import {
  AuthError, identify, isClaimed, mayActAs, signOut, startClaim, sweep, verifyClaim,
} from "../src/auth/index.js";
import type { Delivery, NotifyChannel } from "../src/notify/contract.js";

setLogLevel("silent");

/** Captures the code instead of sending it anywhere. */
class Catcher implements NotifyChannel {
  readonly name = "console";
  last?: Delivery;
  async send(d: Delivery): Promise<void> { this.last = d; }
  code(): string { return /(\d{6})/.exec(this.last?.headline ?? "")![1]!; }
}

const world = () => CanonRepo.open(":memory:");
const claim = async (repo: CanonRepo, fan = "ada") => {
  const c = new Catcher();
  await startClaim(repo, [c], { fan_id: fan, channel: "console", address: "a@x" });
  return { c, code: c.code() };
};

describe("auth", () => {
  it("sends a six-digit code and verifies it into a session", async () => {
    const repo = world();
    const { code } = await claim(repo);
    expect(code).toMatch(/^\d{6}$/);
    const s = verifyClaim(repo, { fan_id: "ada", code });
    expect(s.fan_id).toBe("ada");
    expect(s.token.length).toBeGreaterThan(20);
    expect(identify(repo, s.token)).toEqual({ fan_id: "ada", verified: true });
    repo.close();
  });

  it("never stores the code or the token in readable form", async () => {
    const repo = world();
    const { code } = await claim(repo);
    const stored = repo.db.prepare("SELECT code_hash FROM auth_claims").get() as { code_hash: string };
    expect(stored.code_hash).not.toBe(code);
    const s = verifyClaim(repo, { fan_id: "ada", code });
    const row = repo.db.prepare("SELECT token_hash FROM auth_sessions").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(s.token);
    repo.close();
  });

  it("a code works exactly once", async () => {
    const repo = world();
    const { code } = await claim(repo);
    verifyClaim(repo, { fan_id: "ada", code });
    // A code that still works after it worked is one somebody can reuse from a screenshot.
    expect(() => verifyClaim(repo, { fan_id: "ada", code })).toThrow(AuthError);
    repo.close();
  });

  it("locks out after repeated wrong codes", async () => {
    const repo = world();
    const { code } = await claim(repo);
    for (let i = 0; i < 5; i++) {
      expect(() => verifyClaim(repo, { fan_id: "ada", code: "000000" })).toThrow(/not valid/);
    }
    // Even the RIGHT code must not work once the budget is spent.
    expect(() => verifyClaim(repo, { fan_id: "ada", code })).toThrow(/too many/);
    repo.close();
  });

  it("expires a code, and does not leak whether a claim exists", async () => {
    const repo = world();
    await claim(repo);
    repo.db.prepare("UPDATE auth_claims SET expires_ts = ?").run("2020-01-01T00:00:00.000Z");
    expect(() => verifyClaim(repo, { fan_id: "ada", code: "123456" })).toThrow(/expired/);
    // An id with no claim at all gives the same answer as a wrong code.
    let a = "", b = "";
    try { verifyClaim(repo, { fan_id: "nobody", code: "123456" }); } catch (e) { a = (e as Error).message; }
    const fresh = await claim(repo, "maya");
    try { verifyClaim(repo, { fan_id: "maya", code: "999999" }); } catch (e) { b = (e as Error).message; }
    expect(a).toBe(b);
    expect(fresh.code).toMatch(/^\d{6}$/);
    repo.close();
  });

  it("THE POINT: a verified id cannot be written as by anybody else", async () => {
    const repo = world();
    const { code } = await claim(repo);
    const s = verifyClaim(repo, { fan_id: "ada", code });

    const ada = identify(repo, s.token)!;
    const stranger = identify(repo, undefined, "ada")!; // asserting Ada's id

    expect(mayActAs(repo, ada, "ada")).toBe(true);
    // Without this, verification is decoration: Ada's permanent public
    // attribution would carry somebody else's words.
    expect(mayActAs(repo, stranger, "ada")).toBe(false);
    expect(mayActAs(repo, ada, "maya")).toBe(false);
    repo.close();
  });

  it("unverified people still work, on ids nobody has claimed", () => {
    const repo = world();
    const who = identify(repo, undefined, "newcomer")!;
    expect(who.verified).toBe(false);
    // Forcing a login to leave one line of writing is how a space stays empty.
    expect(mayActAs(repo, who, "newcomer")).toBe(true);
    expect(isClaimed(repo, "newcomer")).toBe(false);
    repo.close();
  });

  it("treats a bad, absent or expired token as unverified rather than an error", async () => {
    const repo = world();
    expect(identify(repo, "not-a-real-token", "ada")).toEqual({ fan_id: "ada", verified: false });
    expect(identify(repo, undefined, "")).toBeNull();
    expect(identify(repo, undefined, "../etc/passwd")).toBeNull();

    const { code } = await claim(repo);
    const s = verifyClaim(repo, { fan_id: "ada", code });
    repo.db.prepare("UPDATE auth_sessions SET expires_ts = ?").run("2020-01-01T00:00:00.000Z");
    expect(identify(repo, s.token)).toBeNull();
    // and the dead session is cleaned up rather than left to be re-checked
    expect(repo.db.prepare("SELECT COUNT(*) c FROM auth_sessions").get()).toEqual({ c: 0 });
    repo.close();
  });

  it("signs out one session or all of them, and sweeps the expired", async () => {
    const repo = world();
    const a = verifyClaim(repo, { fan_id: "ada", code: (await claim(repo)).code });
    const b = verifyClaim(repo, { fan_id: "ada", code: (await claim(repo)).code });
    expect(signOut(repo, { token: a.token })).toBe(1);
    expect(identify(repo, a.token)).toBeNull();
    expect(identify(repo, b.token)?.verified).toBe(true);
    expect(signOut(repo, { fan_id: "ada" })).toBe(1);

    await claim(repo, "maya");
    repo.db.prepare("UPDATE auth_claims SET expires_ts = ?").run("2020-01-01T00:00:00.000Z");
    expect(sweep(repo).claims).toBe(1);
    repo.close();
  });

  it("refuses a malformed fan_id and an unknown channel", async () => {
    const repo = world();
    const c = new Catcher();
    for (const bad of ["", "ab", "../x", "x".repeat(90)]) {
      await expect(startClaim(repo, [c], { fan_id: bad, channel: "console", address: "a" })).rejects.toThrow(AuthError);
    }
    await expect(
      startClaim(repo, [c], { fan_id: "ada", channel: "nope", address: "a" }),
    ).rejects.toThrow(/no channel/);
    repo.close();
  });
});

/**
 * The check that makes verification mean anything, at the layer it protects.
 * A module test proves `mayActAs` returns false; only an HTTP test proves the
 * write path actually asks it.
 */
describe("the write path enforces it", () => {
  it("refuses a stranger asserting a claimed id, and lets the owner through", async () => {
    const { PiecesApi } = await import("../src/pieces/api.js");
    const { seedPiece, lineage } = await import("../src/pieces/repo.js");
    const { createServer } = await import("node:http");

    const repo = world();
    const port: number = await new Promise((r) => {
      const s = createServer();
      s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); });
    });
    const catcher = new Catcher();
    const api = new PiecesApi({ repo, port, apiKey: "k", channels: [catcher] });
    await api.open();
    const base = `http://localhost:${port}`;

    const piece = seedPiece(repo, { title: "T", brief: "a brief that is long enough" });
    const seed = lineage(repo, piece.piece_id)!.seed_event_id;
    const post = (body: unknown, token?: string) =>
      fetch(`${base}/v1/pieces/${piece.piece_id}/extend`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-inspiral-key": "k",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

    // Before anybody claims it, "ada" is open.
    expect((await post({ fan_id: "ada", parent_event_id: seed, body: "an unclaimed first go" })).status).toBe(201);

    await fetch(`${base}/v1/auth/claim`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fan_id: "ada", channel: "console", address: "a@x" }),
    });
    const v = await (await fetch(`${base}/v1/auth/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fan_id: "ada", code: catcher.code() }),
    })).json() as { token: string };

    // Now it is hers, and asserting it is not enough.
    const impostor = await post({ fan_id: "ada", parent_event_id: seed, body: "posting as somebody else" });
    expect(impostor.status).toBe(403);
    expect((await impostor.json() as { code: string }).code).toBe("claimed");

    const owner = await post({ fan_id: "ada", parent_event_id: seed, body: "her own second go" }, v.token);
    expect(owner.status).toBe(201);

    await api.close();
    repo.close();
  });
});
