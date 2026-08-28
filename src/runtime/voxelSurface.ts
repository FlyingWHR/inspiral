/**
 * THE VOXEL SURFACE.
 *
 * A third WorldSurface, and the strongest evidence yet that the seam is real:
 * the simulation below it did not change by one line to gain a voxel world.
 * WebSurface already does the transport -- static files, a socket, the beat
 * protocol -- so this subclasses it and adds the one thing a diggable world
 * needs that a prop-based one does not: player edits becoming canon.
 *
 * The server never stores a voxel. The grid is generated deterministically in
 * the browser from a seed; canon only ever learns "someone dug a hole in the
 * kiln wall", which is the part the cast can have an opinion about.
 */

import { fileURLToPath } from "node:url";
import { WebSurface, type WebSurfaceOptions, type SurfaceIntent } from "./webSurface.js";
import { ARCHETYPES } from "../../web-voxel/scene/archetypes.js";

/**
 * The surface's own fallback is the ward, NOT the selection default.
 * chooseScene() defaults an unsignposted IP to a tavern; a VoxelSurface
 * constructed with no archetype at all is the original Tallow Ward, which is
 * what every existing caller and test means by "no archetype".
 */
const SURFACE_DEFAULT = "market_plaza";

interface ArchetypeMeta {
  id: string;
  name: string;
  affords: string;
  sky: number;
  spawn: { x: number; z: number };
  places: Record<string, { x: number; z: number }>;
}
const LIBRARY = ARCHETYPES as unknown as Record<string, ArchetypeMeta | undefined>;
import type { CanonRepo } from "../canon/repo.js";
import { log } from "../log.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export interface VoxelEdit {
  kind: "place" | "break";
  x: number;
  y: number;
  z: number;
  block: string;
}

/**
 * A piece, as much of one as a renderer is allowed to know.
 *
 * `location` stays an opaque canon string on this side of the seam -- the
 * client turns it into a point with the archetype's own places table, the same
 * one the cast stands on. `generation` sets how tightly the portal winds and is
 * never shown as a number.
 */
export interface PiecePlacement {
  piece_id: string;
  generation: number;
  location: string;
  updated_ts: string;
}

export interface VoxelSurfaceOptions extends WebSurfaceOptions {
  /** Which scene the world opens in. Chosen at onboard time; see src/ip/scene.ts. */
  archetype?: string;
  /** Needed to write edits into the log. The surface reads nothing else. */
  repo?: CanonRepo;
  /** Fallback identity when an edit arrives without a connection identity. */
  visitorId?: string;
  visitorName?: string;
  /** How long to gather edits before writing one event. */
  editBatchMs?: number;
  /**
   * The pieces standing in this world. Same discipline as `resolveCite`: the
   * surface does not read canon, the caller hands it the lookup -- here
   * `listPieces(repo, "open")` from src/pieces/repo.ts.
   */
  pieces?: () => PiecePlacement[];
}

/**
 * Whose patch did this happen on?
 *
 * Used to be a hardcoded ward map. It now resolves through the live cast: each
 * character's home_location is a canon string, the archetype turns it into a
 * point, and the nearest one inside 22 blocks owns the ground. Works for every
 * archetype and needs no per-scene table.
 */
function nearestHome(
  x: number,
  z: number,
  homes: { id: string; place: string; at: { x: number; z: number } }[],
): { id: string; place: string } | null {
  let best: { id: string; place: string } | null = null;
  let bestD = Infinity;
  for (const h of homes) {
    const d = Math.hypot(h.at.x - x, h.at.z - z);
    if (d < bestD) {
      bestD = d;
      best = { id: h.id, place: h.place };
    }
  }
  return bestD <= 22 ? best : null;
}

export class VoxelSurface extends WebSurface {
  override readonly name = "voxel";

  private readonly repo: CanonRepo | undefined;
  private readonly visitorId: string;
  private readonly visitorName: string;
  /**
   * Edits are chatty; batch them so a minute of digging is one event. Keyed by
   * fan, so two people digging at once do not get merged into one culprit.
   */
  private pending = new Map<string, { who: { id: string; name: string }; edits: VoxelEdit[] }>();
  private readonly batchMs: number;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pieces: VoxelSurfaceOptions["pieces"];

  readonly archetype: string;

  constructor(opts: VoxelSurfaceOptions = {}) {
    const archetypeId = opts.archetype && LIBRARY[opts.archetype] ? opts.archetype : SURFACE_DEFAULT;
    const arch = LIBRARY[archetypeId]!;
    super({
      ...opts,
      root: opts.root ?? here("../../web-voxel"),
      places: opts.places ?? arch.places,
    });
    this.archetype = archetypeId;
    this.repo = opts.repo;
    this.visitorId = opts.visitorId ?? "wren";
    this.visitorName = opts.visitorName ?? "Wren";
    this.batchMs = opts.editBatchMs ?? 2500;
    this.pieces = opts.pieces;
  }

  /**
   * The client generates the grid itself, so it has to be told which scene
   * before it generates anything. One static route, fetched at startup.
   */
  protected override serveExtra(urlPath: string): { body: string; type: string } | null {
    /**
     * The pieces, on one static route beside the scene. Only the four fields
     * a portal is made of -- a title or a brief on this route would be a
     * second place for the text to drift out of step with the web surface.
     */
    if (urlPath === "/pieces.json") {
      const pieces = (this.pieces?.() ?? []).map((p) => ({
        piece_id: p.piece_id,
        generation: p.generation,
        location: p.location,
        updated_ts: p.updated_ts,
      }));
      return { type: "application/json", body: JSON.stringify({ pieces }) };
    }
    if (urlPath !== "/scene.json") return null;
    const arch = LIBRARY[this.archetype]!;
    return {
      type: "application/json",
      body: JSON.stringify({
        archetype: this.archetype,
        name: arch.name,
        affords: arch.affords,
        sky: arch.sky,
        spawn: arch.spawn,
        places: arch.places,
      }),
    };
  }

  /** Called by the transport for any intent it does not handle itself. */
  onEdit(edit: VoxelEdit, who?: { id: string; name: string }): void {
    const fan = who ?? { id: this.visitorId, name: this.visitorName };
    const bucket = this.pending.get(fan.id) ?? { who: fan, edits: [] };
    bucket.edits.push(edit);
    this.pending.set(fan.id, bucket);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushEdits();
    }, this.batchMs);
  }

  /**
   * Turn a burst of edits into one world event. NPCs can then cite it like any
   * other thing that happened, because it IS any other thing that happened.
   *
   * Public so a caller can force it -- on shutdown, or in a test that should
   * not have to wait out a timer.
   */
  flushEdits(): void {
    const buckets = [...this.pending.values()];
    this.pending.clear();
    for (const b of buckets) this.writeEdits(b.who, b.edits);
  }

  private writeEdits(who: { id: string; name: string }, edits: VoxelEdit[]): void {
    if (!edits.length || !this.repo) return;

    const broke = edits.filter((e) => e.kind === "break").length;
    const built = edits.length - broke;
    const mid = edits[Math.floor(edits.length / 2)]!;
    const arch = LIBRARY[this.archetype]!;
    const homes = this.repo
      .getCharacters()
      .map((c) => ({ id: c.character_id, place: c.home_location, at: arch.places[c.home_location] }))
      .filter((h): h is { id: string; place: string; at: { x: number; z: number } } => !!h.at);
    const owner = nearestHome(mid.x, mid.z, homes);

    const what =
      broke && built
        ? `tore out ${broke} block${broke === 1 ? "" : "s"} and put up ${built}`
        : broke
          ? `tore ${broke} block${broke === 1 ? "" : "s"} out of the ward`
          : `built ${built} block${built === 1 ? "" : "s"} onto the ward`;
    const where = owner ? ` at ${owner.place.replace(/_/g, " ")}` : " out in the open";

    const actors = [`fan:${who.id}`, ...(owner ? [owner.id] : [])];
    const evt = this.repo.appendEvent({
      source: "visitor",
      actors,
      type: "terrain_altered",
      payload: {
        summary: `${who.name} ${what}${where}, in front of everyone.`,
        blocks: edits.length,
        broke,
        built,
      },
      // Digging out somebody's wall is a bigger deal than stacking dirt.
      significance_hint: owner ? Math.min(0.85, 0.35 + edits.length * 0.03) : 0.15,
    });

    if (owner) {
      // They watched you do it. That is what makes it narratively load-bearing.
      this.repo.adjustRelationship(
        owner.id,
        who.id,
        {
          affinity: broke > built ? -Math.min(18, broke) : Math.min(8, built),
          tension: Math.min(20, edits.length),
          note: `${who.name} ${what} at their ${owner.place.replace(/_/g, " ")}.`,
        },
        evt.event_id,
      );
    }

    log.info(`terrain: ${who.name} ${what}${where} (${evt.event_id})`);
    this.onEvent(evt);
  }

  protected override async handleIntentHook(intent: SurfaceIntent): Promise<boolean> {
    if (intent.kind !== "edit" || !intent.edit) return false;
    this.onEdit(intent.edit as VoxelEdit, intent.visitor);
    return true;
  }
}
