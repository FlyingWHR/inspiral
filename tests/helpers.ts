import { CanonRepo } from "../src/canon/repo.js";
import { seedWorld } from "../src/canon/seed.js";
import { VirtualClock } from "../src/clock.js";
import { setLogLevel } from "../src/log.js";

setLogLevel("silent");

export function freshWorld(start = "2026-03-02T08:00:00.000Z"): {
  repo: CanonRepo;
  clock: VirtualClock;
} {
  const clock = new VirtualClock(start);
  const repo = CanonRepo.open(":memory:", clock);
  seedWorld(repo);
  repo.setMeta("world_start", start);
  return { repo, clock };
}

/** A minimal valid directive batch as raw host text. */
export function batchJson(directives: unknown[]): string {
  return JSON.stringify({ directives });
}

export const validDirective = {
  actor: "vance",
  action: "confront",
  target: "okonkwo",
  dialogue_intent: "states the shortfall out loud",
  arc_id: "arc_kiln_debt",
  significance_hint: 0.7,
  canon_deltas: [
    {
      op: "relationship_delta",
      from_id: "okonkwo",
      to_id: "vance",
      affinity: -8,
      trust: -4,
      tension: 10,
      note: "She did it in front of the queue.",
    },
  ],
};
