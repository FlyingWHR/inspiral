import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CanonRepo } from "../src/canon/repo.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";
import { MAX_ATTEMPTS } from "../src/notify/contract.js";
import { extendPiece, seedEventId, seedPiece } from "../src/pieces/repo.js";
import { backup, dbFile, verifyBackup } from "../src/ops/backup.js";
import { health, stats } from "../src/ops/health.js";

setLogLevel("silent");

/**
 * Temp dirs, cleaned up together. Only the backup tests need real files.
 *
 * `realpathSync` because on macOS `os.tmpdir()` is `/var/...`, a symlink to
 * `/private/var/...`, and SQLite reports the resolved path -- so a raw
 * `mkdtempSync` path never equals what `dbFile()` returns.
 */
const dirs: string[] = [];
const tempDir = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "inspiral-ops-")));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const memoryRepo = (): CanonRepo =>
  CanonRepo.open(":memory:", new VirtualClock("2026-03-01T09:00:00.000Z"));

/**
 * A small world with a known shape: two pieces, three extensions, two distinct
 * people (`ada` twice, `bo` once). Every number in the stats test is checkable
 * by reading this function.
 */
function seedSmallWorld(repo: CanonRepo): void {
  repo.setMeta("world_name", "The Kitchen");
  repo.setMeta("clock_host", "mock");

  const a = seedPiece(repo, { title: "Kettle", brief: "five ordinary things" });
  const b = seedPiece(repo, { title: "Shelf", brief: "one impossible thing" });

  const seedA = seedEventId(repo, a.piece_id)!;
  const first = extendPiece(repo, {
    piece_id: a.piece_id, parent_event_id: seedA, fan_id: "ada", body: "the kettle sings",
  });
  extendPiece(repo, {
    piece_id: a.piece_id, parent_event_id: first.extension.event_id, fan_id: "bo",
    body: "and nobody answers",
  });
  extendPiece(repo, {
    piece_id: b.piece_id, parent_event_id: seedEventId(repo, b.piece_id)!, fan_id: "ada",
    body: "the shelf holds nothing",
  });

  // Notification rows written directly rather than through the dispatcher:
  // this test is about the counting SQL, and going through `enqueue`/`dispatch`
  // would make it fail for reasons that live in someone else's file.
  const ins = repo.db.prepare(
    `INSERT INTO notifications (fan_id, kind, piece_id, event_id, created_ts, sent_ts, attempts)
     VALUES (?, 'extended', ?, ?, ?, ?, ?)`,
  );
  ins.run("ada", a.piece_id, "evt_sent", repo.now(), repo.now(), 1); // sent
  ins.run("ada", a.piece_id, "evt_pending", repo.now(), null, 0); // pending, untried
  ins.run("bo", a.piece_id, "evt_retrying", repo.now(), null, MAX_ATTEMPTS - 1); // still pending
  ins.run("bo", b.piece_id, "evt_dead", repo.now(), null, MAX_ATTEMPTS); // given up
}

describe("health", () => {
  it("reports ok on a working database", () => {
    const repo = memoryRepo();
    const h = health(repo);
    expect(h.ok).toBe(true);
    expect(h.checks).toEqual({ db: true, disk: true });
    expect(h.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(h.uptime_s).toBeGreaterThanOrEqual(0);
    repo.close();
  });

  it("reports not ok once the database is closed, without throwing", () => {
    const repo = memoryRepo();
    repo.close();
    const h = health(repo);
    expect(h.ok).toBe(false);
    expect(h.checks.db).toBe(false);
    // Still answers rather than 500ing: a health check that throws reports
    // "unknown" as a stack trace in a public response body.
    expect(h.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("checks the real directory of a file-backed database", () => {
    const dir = tempDir();
    const repo = CanonRepo.open(join(dir, "canon.db"));
    expect(health(repo).ok).toBe(true);
    expect(dbFile(repo)).toBe(join(dir, "canon.db"));
    repo.close();
  });
});

describe("stats", () => {
  it("counts a small seeded world correctly", () => {
    const repo = memoryRepo();
    seedSmallWorld(repo);

    const s = stats(repo, { subscribers: 3 });

    expect(s.world).toBe("The Kitchen");
    expect(s.host).toBe("mock");
    expect(s.pieces.total).toBe(2);
    expect(s.pieces.open).toBe(2);
    expect(s.pieces.extensions).toBe(3);
    expect(s.pieces.contributors).toBe(2); // ada and bo, ada only once
    expect(s.notifications).toEqual({ sent: 1, pending: 2, failed: 1 });
    expect(s.live_subscribers).toBe(3);
    // 2 seeds + 3 extensions, and MAX(seq) must agree with a real count.
    expect(s.events).toBe(5);
    expect(s.events).toBe(repo.eventCount());
    expect(s.db.on_disk).toBe(false);
    expect(s.db.bytes).toBe(0);
    expect(s.db.schema_version).toBeGreaterThan(0);
    repo.close();
  });

  it("answers on an empty world instead of returning nulls", () => {
    const repo = memoryRepo();
    const s = stats(repo);
    expect(s.pieces).toEqual({ total: 0, open: 0, extensions: 0, contributors: 0 });
    expect(s.notifications).toEqual({ pending: 0, sent: 0, failed: 0 });
    expect(s.events).toBe(0);
    expect(s.host).toBeNull();
    repo.close();
  });

  it("reports the file and WAL sizes of an on-disk database", () => {
    const repo = CanonRepo.open(join(tempDir(), "canon.db"));
    seedSmallWorld(repo);
    const s = stats(repo);
    expect(s.db.on_disk).toBe(true);
    expect(s.db.bytes).toBeGreaterThan(0);
    // Committed but not yet checkpointed: the bytes a plain file copy loses.
    expect(s.db.wal_bytes).toBeGreaterThan(0);
    repo.close();
  });
});

describe("backup", () => {
  it("writes a file that opens and holds the same rows", () => {
    const dir = tempDir();
    const repo = CanonRepo.open(join(dir, "canon.db"));
    seedSmallWorld(repo);

    const out = backup(repo)!;
    expect(out).not.toBeNull();
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.path.startsWith(join(dir, "backups"))).toBe(true);

    const v = verifyBackup(out.path);
    expect(v.ok).toBe(true);
    expect(v.events).toBe(repo.eventCount());
    expect(v.pieces).toBe(2);
    expect(v.schema_version).toBe(stats(repo).db.schema_version);
    repo.close();
  });

  it("captures writes still sitting in the WAL", () => {
    const dir = tempDir();
    const repo = CanonRepo.open(join(dir, "canon.db"));
    seedSmallWorld(repo);
    const before = repo.eventCount();

    // No checkpoint between the write and the snapshot -- this is exactly the
    // case `copyFileSync` of the .db alone silently drops.
    seedPiece(repo, { title: "Late", brief: "written after the last checkpoint" });
    const v = verifyBackup(backup(repo)!.path);
    expect(v.events).toBe(before + 1);
    repo.close();
  });

  it("keeps exactly N and prunes the rest, oldest first", () => {
    const dir = tempDir();
    const repo = CanonRepo.open(join(dir, "canon.db"));
    seedSmallWorld(repo);

    const written: string[] = [];
    for (let i = 0; i < 5; i++) written.push(backup(repo, { keep: 2 })!.path);

    const kept = readdirSync(join(dir, "backups")).sort();
    expect(kept).toHaveLength(2);
    // The two newest, not any two.
    expect(kept.map((f) => join(dir, "backups", f))).toEqual(written.slice(-2));
    repo.close();
  });

  it("degrades gracefully on :memory:", () => {
    const repo = memoryRepo();
    seedSmallWorld(repo);
    expect(backup(repo)).toBeNull();
    repo.close();
  });

  it("refuses a backup that is not there rather than inventing an empty one", () => {
    const v = verifyBackup(join(tempDir(), "nothing-here.db"));
    expect(v.ok).toBe(false);
    expect(v.error).toBeTruthy();
    expect(v.events).toBe(0);
  });
});
