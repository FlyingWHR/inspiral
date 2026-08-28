/**
 * TURNING AN ASSERTED ID INTO A PROVEN ONE.
 *
 * A `fan_id` was a claim. Clear your storage and you were a stranger; copy
 * somebody else's and you were them. Every load-bearing thing in this product
 * -- attribution on a permanent public page, the return screen, notifications
 * -- rested on a string anybody could type.
 *
 * The fix needs no dependency and no password, because a person has ALREADY
 * told us how to reach them. Prove you control that address and the id is
 * yours. The notification channels are the delivery mechanism, which is why
 * this arrives after them rather than before.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 *
 * It is: proof that whoever holds this session controls the address that
 * claimed this id.
 *
 * It is NOT identity in any deeper sense. Nobody's real name is verified,
 * nothing is checked against a provider, and an address can be shared. That is
 * enough for attribution on a creative work and nowhere near enough for
 * anything with money in it. Said plainly so the next person does not assume
 * more than it delivers.
 *
 * Unverified people still work. A visitor with no session is `asserted` and can
 * read and contribute exactly as before -- forcing a login to leave one line of
 * writing is how a space stays empty. Verification is what makes an id yours,
 * not what makes it usable.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { CanonRepo } from "../canon/repo.js";
import type { Delivery, NotifyChannel } from "../notify/contract.js";
import { log } from "../log.js";

/** Long enough to be unguessable, short enough to read off a phone. */
const CODE_DIGITS = 6;
const CODE_TTL_MIN = 10;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 90;

/**
 * SHA-256, no salt, deliberately.
 *
 * These are high-entropy random values, not passwords -- there is no dictionary
 * to attack and nothing to rainbow-table. A slow KDF here would buy nothing and
 * cost a hash on every authenticated request. Salting a value that is already
 * uniformly random adds a column and no security.
 */
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Compare without leaking where two strings first differ. */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself be a signal.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export type Identity =
  | { fan_id: string; verified: true }
  | { fan_id: string; verified: false };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "no_channel" | "expired" | "bad_code" | "too_many" | "bad_input",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Start a claim: send a code to the address given.
 *
 * ALWAYS behaves the same whether or not this id has been seen before. A
 * different answer for a known id would turn this endpoint into a way to
 * enumerate who exists.
 */
export async function startClaim(
  repo: CanonRepo,
  channels: NotifyChannel[],
  input: { fan_id: string; channel: string; address: string },
): Promise<{ sent: true; expires_ts: string }> {
  const fanId = input.fan_id.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,64}$/.test(fanId)) throw new AuthError("bad fan_id", "bad_input");
  if (!input.address.trim()) throw new AuthError("address is required", "bad_input");

  const channel = channels.find((c) => c.name === input.channel);
  if (!channel) throw new AuthError(`no channel '${input.channel}'`, "no_channel");

  // randomInt is the CSPRNG. Math.random here would be a real vulnerability
  // and an easy one to write by accident.
  const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
  const expires = new Date(Date.parse(repo.now()) + CODE_TTL_MIN * 60_000).toISOString();

  repo.db
    .prepare(
      `INSERT INTO auth_claims (fan_id, code_hash, channel, address, expires_ts, attempts)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT (fan_id) DO UPDATE SET
         code_hash = excluded.code_hash, channel = excluded.channel,
         address = excluded.address, expires_ts = excluded.expires_ts, attempts = 0`,
    )
    .run(fanId, hash(code), input.channel, input.address, expires);

  const d: Delivery = {
    fan_id: fanId,
    address: input.address,
    headline: `Your code is ${code}`,
    body:
      `Enter ${code} to claim "${fanId}".\n\n` +
      `It expires in ${CODE_TTL_MIN} minutes. If you did not ask for this, ignore it — ` +
      `nothing happens until the code is used.`,
    url: "",
    ids: [],
  };
  await channel.send(d);
  return { sent: true, expires_ts: expires };
}

/**
 * Finish a claim. Returns a session token, shown once and never stored in
 * readable form.
 */
export function verifyClaim(
  repo: CanonRepo,
  input: { fan_id: string; code: string },
): { token: string; fan_id: string; expires_ts: string } {
  const fanId = input.fan_id.trim().toLowerCase();
  const row = repo.db.prepare("SELECT * FROM auth_claims WHERE fan_id = ?").get(fanId) as
    | { code_hash: string; expires_ts: string; attempts: number }
    | undefined;

  // Same error for "no claim" and "wrong code": distinguishing them tells an
  // attacker which ids have a claim outstanding.
  if (!row) throw new AuthError("that code is not valid", "bad_code");
  if (Date.parse(row.expires_ts) < Date.parse(repo.now())) {
    repo.db.prepare("DELETE FROM auth_claims WHERE fan_id = ?").run(fanId);
    throw new AuthError("that code has expired", "expired");
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    throw new AuthError("too many attempts; start again", "too_many");
  }

  if (!sameSecret(row.code_hash, hash(input.code.trim()))) {
    repo.db.prepare("UPDATE auth_claims SET attempts = attempts + 1 WHERE fan_id = ?").run(fanId);
    throw new AuthError("that code is not valid", "bad_code");
  }

  // Single use. A code that still works after it worked is a code somebody can
  // reuse from a screenshot.
  repo.db.prepare("DELETE FROM auth_claims WHERE fan_id = ?").run(fanId);

  const token = randomBytes(32).toString("base64url");
  const expires = new Date(
    Date.parse(repo.now()) + SESSION_TTL_DAYS * 86_400_000,
  ).toISOString();
  const now = repo.now();
  repo.db
    .prepare(
      `INSERT INTO auth_sessions (token_hash, fan_id, created_ts, last_seen_ts, expires_ts)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash(token), fanId, now, now, expires);

  repo.ensureVisitor(fanId, "");
  log.info(`auth: ${fanId} verified`);
  return { token, fan_id: fanId, expires_ts: expires };
}

/**
 * Who is this request. Never throws -- an absent or bad token is an
 * unverified visitor, not an error, because unverified people are allowed.
 */
export function identify(repo: CanonRepo, token: string | undefined, asserted?: string): Identity | null {
  if (token) {
    const row = repo.db
      .prepare("SELECT fan_id, expires_ts FROM auth_sessions WHERE token_hash = ?")
      .get(hash(token)) as { fan_id: string; expires_ts: string } | undefined;
    if (row && Date.parse(row.expires_ts) > Date.parse(repo.now())) {
      repo.db
        .prepare("UPDATE auth_sessions SET last_seen_ts = ? WHERE token_hash = ?")
        .run(repo.now(), hash(token));
      return { fan_id: row.fan_id, verified: true };
    }
    if (row) repo.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(hash(token));
  }
  const id = (asserted ?? "").trim().toLowerCase();
  return /^[a-z0-9_]{3,64}$/.test(id) ? { fan_id: id, verified: false } : null;
}

/**
 * A verified id belongs to one person, so nobody else may write as it.
 *
 * This is the whole point. Without it, verification would be decoration: a
 * stranger could still post as "ada" by asserting the id, and Ada's permanent
 * public attribution would carry somebody else's words.
 */
export function mayActAs(repo: CanonRepo, who: Identity, fanId: string): boolean {
  const target = fanId.trim().toLowerCase();
  if (who.verified) return who.fan_id === target;
  return !isClaimed(repo, target);
}

export function isClaimed(repo: CanonRepo, fanId: string): boolean {
  return (
    repo.db
      .prepare("SELECT 1 FROM auth_sessions WHERE fan_id = ? AND expires_ts > ? LIMIT 1")
      .get(fanId.trim().toLowerCase(), repo.now()) !== undefined
  );
}

/** Log out. Drops one session, or every session this person holds. */
export function signOut(repo: CanonRepo, opts: { token?: string; fan_id?: string }): number {
  if (opts.token) {
    const r = repo.db
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .run(hash(opts.token));
    return r.changes ?? 0;
  }
  if (opts.fan_id) {
    const r = repo.db
      .prepare("DELETE FROM auth_sessions WHERE fan_id = ?")
      .run(opts.fan_id.trim().toLowerCase());
    return r.changes ?? 0;
  }
  return 0;
}

/** Housekeeping. Expired rows are not secrets but they are not evidence either. */
export function sweep(repo: CanonRepo): { claims: number; sessions: number } {
  const now = repo.now();
  const c = repo.db.prepare("DELETE FROM auth_claims WHERE expires_ts < ?").run(now);
  const s = repo.db.prepare("DELETE FROM auth_sessions WHERE expires_ts < ?").run(now);
  return { claims: c.changes ?? 0, sessions: s.changes ?? 0 };
}
