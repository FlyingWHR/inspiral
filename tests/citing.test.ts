import { describe, expect, it } from "vitest";
import { CITING_ACTIONS, GRIEVABLE, performDirective } from "../src/runtime/character.js";
import { ACTION_EVENT_TYPE } from "../src/types/directive.js";
import { freshWorld } from "./helpers.js";

/**
 * The bug this guards: CITING_ACTIONS and GRIEVABLE are two lists describing
 * the same idea, and they drifted. `alliance_broken` was grievable but
 * `break_alliance` did not cite, so any ladder escalating to a broken alliance
 * rendered a beat with no receipt -- which is the one thing the whole pitch
 * rests on.
 */
describe("every escalation names its receipt", () => {
  it("cites on break_alliance, not just confront/snub/sabotage", () => {
    const { repo } = freshWorld();

    // Give Vance something concrete to hold against Okonkwo.
    const grievance = repo.appendEvent({
      source: "tick",
      actors: ["okonkwo", "vance"],
      type: "alliance_broken",
      payload: { summary: "Okonkwo walked out of the kiln arrangement." },
      significance_hint: 0.8,
    });
    repo.adjustRelationship(
      "vance",
      "okonkwo",
      { affinity: -30, tension: 40, note: "He walked out of the arrangement." },
      grievance.event_id,
    );

    const rendered = performDirective(repo, {
      actor: "vance",
      action: "break_alliance",
      target: "okonkwo",
      dialogue_intent: "ends the arrangement and does not pretend to regret it",
      arc_id: "arc_kiln_debt",
      significance_hint: 0.7,
      canon_deltas: [],
    });

    expect(rendered).toBeDefined();
    expect(rendered!.cites).toContain(grievance.event_id);
    repo.close();
  });

  it("keeps the two lists in step -- every citing action is grievable", () => {
    for (const action of CITING_ACTIONS) {
      const eventType = ACTION_EVENT_TYPE[action as keyof typeof ACTION_EVENT_TYPE];
      expect(eventType, `${action} must map to an event type`).toBeDefined();
      expect(
        GRIEVABLE.has(eventType),
        `${action} cites history but its event type "${eventType}" is not grievable`,
      ).toBe(true);
    }
  });

  it("still cites on the original three", () => {
    for (const action of ["confront", "snub", "sabotage"] as const) {
      const { repo } = freshWorld();
      const e = repo.appendEvent({
        source: "tick",
        actors: ["okonkwo", "vance"],
        type: "snub",
        payload: { summary: "He cut her dead in the market." },
        significance_hint: 0.6,
      });
      repo.adjustRelationship("vance", "okonkwo", { affinity: -20, note: "He cut me dead." }, e.event_id);

      const r = performDirective(repo, {
        actor: "vance",
        action,
        target: "okonkwo",
        dialogue_intent: "says it plainly",
        arc_id: "arc_kiln_debt",
        significance_hint: 0.6,
        canon_deltas: [],
      });
      expect(r!.cites, `${action} should cite`).toContain(e.event_id);
      repo.close();
    }
  });

  it("does not cite at a target it has no history with", () => {
    const { repo } = freshWorld();
    const r = performDirective(repo, {
      actor: "vance",
      action: "break_alliance",
      target: "quill",
      dialogue_intent: "ends it",
      arc_id: "arc_almshouse_lease",
      significance_hint: 0.5,
      canon_deltas: [],
    });
    // A relationship with no last_event_id has nothing to point at, and
    // inventing one is the failure mode this whole design exists to prevent.
    expect(r!.cites.every((id) => repo.getEvent(id) !== undefined)).toBe(true);
    repo.close();
  });
});
