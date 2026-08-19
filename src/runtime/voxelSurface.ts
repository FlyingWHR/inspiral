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
import { WARD_PLACES as VOXEL_PLACES } from "../../web-voxel/ward.js";
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

export interface VoxelSurfaceOptions extends WebSurfaceOptions {
  /** Needed to write edits into the log. The surface reads nothing else. */
  repo?: CanonRepo;
  /** Fallback identity when an edit arrives without a connection identity. */
  visitorId?: string;
  visitorName?: string;
  /** How long to gather edits before writing one event. */
  editBatchMs?: number;
}

/** Coordinates in, the character whose patch this is. */
function nearestHome(x: number, z: number): { id: string; place: string } | null {
  const HOMES: Record<string, string> = {
    counting_house: "vance",
    kiln_row: "okonkwo",
    almshouse: "quill",
  };
  let best: { id: string; place: string } | null = null;
  let bestD = Infinity;
  for (const [place, id] of Object.entries(HOMES)) {
    const p = (VOXEL_PLACES as Record<string, { x: number; z: number }>)[place];
    if (!p) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) { bestD = d; best = { id, place }; }
  }
  // Beyond this it happened out in the open and belongs to nobody.
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

  constructor(opts: VoxelSurfaceOptions = {}) {
    super({
      ...opts,
      root: opts.root ?? here("../../web-voxel"),
      places: opts.places ?? (VOXEL_PLACES as Record<string, { x: number; z: number }>),
    });
    this.repo = opts.repo;
    this.visitorId = opts.visitorId ?? "wren";
    this.visitorName = opts.visitorName ?? "Wren";
    this.batchMs = opts.editBatchMs ?? 2500;
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
    const owner = nearestHome(mid.x, mid.z);

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
