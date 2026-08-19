import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * INBOUND SEAM.
 *
 * "Point Inspiral at your social accounts" is, mechanically, this interface and
 * nothing else. An IPSource yields raw items from a handle. Everything
 * downstream -- the bible compiler, the approval gate, the ingestion loop --
 * works against `RawItem[]` and has never heard of an API.
 *
 * The DEFAULT and the thing the demo runs on is `FixtureSource`, reading local
 * JSON and markdown. That is not a placeholder for a missing feature: no social
 * API access method has been decided, so the network adapters are stubs that
 * throw. A stub that returns [] would let a broken integration look like a
 * quiet account, which is the worst failure this system could have.
 */

export type RawItemKind = "profile" | "post" | "video" | "pinned" | "comment" | "match";

export interface RawItem {
  /** Stable across refetches. Ingestion dedupes on this. */
  item_id: string;
  kind: RawItemKind;
  /** ISO-8601. When the thing was published, not when we saw it. */
  ts: string;
  /** The handle that published it. */
  author: string;
  text: string;
  url?: string;
  metrics?: { likes?: number; views?: number; comments?: number };
  /**
   * Cast ids this item concerns; `actors[0]` is the initiator, matching the
   * event schema's convention. Fixtures supply this. A real feed does not --
   * the onboarding host pass is what learns to fill it in.
   */
  actors?: string[];
  /** Open arc this belongs to, if known. */
  arc_id?: string | null;
  /** 0..1. Derived from metrics when absent. */
  significance?: number;
  /**
   * How much this should move the relationship between `actors[1..]` and
   * `actors[0]`. Bounded by canon's own clamps. Omitted = a default nudge in
   * tension only, because attention is not the same as hostility.
   */
  impact?: { affinity?: number; trust?: number; tension?: number };
}

export interface IPSource {
  /** For logs and provenance: "fixture:tradeclash", "x:@mrbeast". */
  readonly name: string;
  readonly handle: string;
  /** Everything visible, oldest first. Cheap, idempotent, re-runnable. */
  fetch(opts?: { since?: string }): Promise<RawItem[]>;
  /**
   * Pre-extracted bible material shipped with a fixture. Real sources return
   * null and the host does the extraction.
   */
  hints?(): Promise<unknown | null>;
}

export class SourceNotImplementedError extends Error {
  constructor(platform: string) {
    super(
      `IPSource '${platform}' is not implemented. No social API access method has been chosen ` +
        `for Inspiral yet, so there is no auth, no rate-limit policy and no ToS position here. ` +
        `Export the account to fixtures/<name>/ and run with 'fixture:<name>' instead.`,
    );
    this.name = "SourceNotImplementedError";
  }
}

/** Every network platform, stubbed identically. Loud on use, silent otherwise. */
class StubSource implements IPSource {
  readonly name: string;
  constructor(
    private platform: string,
    readonly handle: string,
  ) {
    this.name = `${platform}:${handle}`;
  }
  async fetch(): Promise<RawItem[]> {
    throw new SourceNotImplementedError(this.platform);
  }
}

// ---------------------------------------------------------------------------
// FIXTURE SOURCE -- the default
// ---------------------------------------------------------------------------

export const FIXTURE_ROOT = process.env.INSPIRAL_FIXTURES || "./fixtures";

/**
 * A directory of local files pretending to be an account.
 *
 *   fixtures/<name>/items.json   RawItem[]  -- the back catalogue
 *   fixtures/<name>/hints.json   optional   -- what a Mind extracts from it
 *   fixtures/<name>/*.md         one item each, for dropping a post in live
 *
 * Markdown files may carry a `key: value` header ended by a blank line:
 *
 *   item_id: post_017
 *   ts: 2026-03-04T10:00:00.000Z
 *   actors: ferrox, cindra
 *
 *   Ferrox called the Cindra tariff "a tax on breathing" on stream.
 */
export class FixtureSource implements IPSource {
  readonly name: string;
  readonly handle: string;
  private dir: string;

  constructor(fixtureName: string, root: string = FIXTURE_ROOT) {
    this.dir = join(root, fixtureName);
    this.name = `fixture:${fixtureName}`;
    this.handle = fixtureName;
  }

  async fetch(opts: { since?: string } = {}): Promise<RawItem[]> {
    const items = [...this.readJson(), ...this.readMarkdown()];
    const sinceMs = opts.since ? Date.parse(opts.since) : Number.NEGATIVE_INFINITY;
    return items
      .filter((i) => Date.parse(i.ts) > sinceMs)
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.item_id.localeCompare(b.item_id));
  }

  async hints(): Promise<unknown | null> {
    try {
      return JSON.parse(readFileSync(join(this.dir, "hints.json"), "utf8"));
    } catch {
      return null;
    }
  }

  private readJson(): RawItem[] {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(this.dir, "items.json"), "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) throw new Error(`${this.dir}/items.json must be an array of items`);
    return raw.map((r, i) => normalizeItem(r as Partial<RawItem>, `item_${i}`, this.handle));
  }

  private readMarkdown(): RawItem[] {
    let names: string[];
    try {
      names = readdirSync(this.dir).filter((f) => extname(f) === ".md" && f !== "README.md");
    } catch {
      return [];
    }
    return names.map((f) => {
      const path = join(this.dir, f);
      const { fields, body } = splitHeader(readFileSync(path, "utf8"));
      // A dropped file with no ts still needs a deterministic-enough one, and
      // mtime is genuinely when it was published in a live demo.
      const ts = fields.ts ?? statSync(path).mtime.toISOString();
      return normalizeItem(
        { ...fields, ts, text: body, actors: splitList(fields.actors) },
        basename(f, ".md"),
        this.handle,
      );
    });
  }
}

/** `key: value` lines before the first blank line. Everything after is body. */
function splitHeader(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.split(/\r?\n/);
  const fields: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      break;
    }
    const m = /^([a-z_]{2,20}):\s*(.*)$/i.exec(line.trim());
    if (!m) break;
    fields[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  return { fields, body: lines.slice(i).join("\n").trim() };
}

function splitList(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const out = v
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

/** Fill in what a loose fixture leaves out. The one place defaults are decided. */
export function normalizeItem(
  r: Partial<RawItem> & Record<string, unknown>,
  fallbackId: string,
  handle: string,
): RawItem {
  const metrics = r.metrics ?? {};
  const engagement =
    (metrics.likes ?? 0) + (metrics.comments ?? 0) * 3 + (metrics.views ?? 0) / 1000;
  // A markdown header yields strings for everything, so a `significance: 0.9`
  // line has to survive as a number or the item silently drops below every
  // downstream threshold.
  const stated = typeof r.significance === "string" ? Number(r.significance) : r.significance;
  const item: RawItem = {
    item_id: String(r.item_id ?? fallbackId),
    kind: (r.kind as RawItemKind) ?? "post",
    ts: String(r.ts ?? new Date(0).toISOString()),
    author: String(r.author ?? handle),
    text: String(r.text ?? "").trim(),
    // Log-scaled so one viral video does not make everything else invisible.
    significance:
      typeof stated === "number" && Number.isFinite(stated)
        ? stated
        : Math.min(0.95, 0.25 + Math.log10(1 + engagement) / 8),
  };
  if (r.url) item.url = String(r.url);
  if (r.metrics) item.metrics = r.metrics;
  if (Array.isArray(r.actors) && r.actors.length) item.actors = r.actors.map(String);
  if (r.arc_id !== undefined) item.arc_id = r.arc_id === null ? null : String(r.arc_id);
  if (r.impact && typeof r.impact === "object") item.impact = r.impact as RawItem["impact"];
  return item;
}

// ---------------------------------------------------------------------------

/**
 * `fixture:tradeclash`, `x:@handle`, `youtube:@handle`, ...
 * A bare name is a fixture, because the fixture is the default.
 */
export function createSource(spec: string, root: string = FIXTURE_ROOT): IPSource {
  const [head, ...rest] = spec.split(":");
  const tail = rest.join(":");
  switch ((head ?? "").toLowerCase()) {
    case "fixture":
      return new FixtureSource(tail, root);
    case "x":
    case "twitter":
    case "youtube":
    case "instagram":
    case "tiktok":
      if (!tail) throw new Error(`source '${spec}' needs a handle, e.g. ${head}:@someone`);
      return new StubSource(head!.toLowerCase(), tail);
    default:
      return new FixtureSource(spec, root);
  }
}
