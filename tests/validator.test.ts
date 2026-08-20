import { describe, expect, it } from "vitest";
import {
  extractJson,
  parseShape,
  validateDirectives,
  issuesToRepairPrompt,
} from "../src/directive/validate.js";
import { MAX_AFFINITY_STEP, MAX_DIRECTIVES_PER_TICK } from "../src/types/directive.js";
import { batchJson, freshWorld, validDirective } from "./helpers.js";

describe("extractJson", () => {
  it("takes a bare object", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("unwraps a fenced block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("digs the object out of surrounding prose", () => {
    const raw = 'Certainly! Here you go:\n{"a":1}\nHope that helps.';
    expect(extractJson(raw)).toBe('{"a":1}');
  });

  it("balances nested braces rather than stopping at the first one", () => {
    const raw = 'text {"a":{"b":2},"c":3} trailing';
    expect(extractJson(raw)).toBe('{"a":{"b":2},"c":3}');
  });

  it("is not fooled by braces inside strings", () => {
    const raw = '{"a":"a } brace","b":1}';
    expect(extractJson(raw)).toBe(raw);
  });

  it("returns null when there is no object at all", () => {
    expect(extractJson("I'm afraid I can't do that")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("shape validation", () => {
  it("accepts a well-formed batch", () => {
    const r = parseShape(batchJson([validDirective]));
    expect(r.ok).toBe(true);
  });

  it("rejects unparseable JSON", () => {
    const r = parseShape("{ directives: [ nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.kind).toBe("shape");
  });

  it("rejects an unknown action", () => {
    const r = parseShape(batchJson([{ ...validDirective, action: "vaporise" }]));
    expect(r.ok).toBe(false);
  });

  it("rejects an empty directive list", () => {
    const r = parseShape(batchJson([]));
    expect(r.ok).toBe(false);
  });

  it("rejects more directives than a tick may carry", () => {
    const many = Array.from({ length: MAX_DIRECTIVES_PER_TICK + 1 }, () => validDirective);
    const r = parseShape(batchJson(many));
    expect(r.ok).toBe(false);
  });

  it("rejects a relationship swing larger than one tick allows", () => {
    const r = parseShape(
      batchJson([
        {
          ...validDirective,
          canon_deltas: [
            {
              op: "relationship_delta",
              from_id: "okonkwo",
              to_id: "vance",
              affinity: MAX_AFFINITY_STEP + 10,
            },
          ],
        },
      ]),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown delta op", () => {
    const r = parseShape(
      batchJson([{ ...validDirective, canon_deltas: [{ op: "delete_everything" }] }]),
    );
    expect(r.ok).toBe(false);
  });

  it("applies defaults for omitted optional fields", () => {
    const r = parseShape(
      batchJson([{ actor: "vance", action: "hold", dialogue_intent: "waits" }]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.batch.directives[0]!;
      expect(d.target).toBeNull();
      expect(d.canon_deltas).toEqual([]);
      expect(d.significance_hint).toBe(0.5);
    }
  });
});

describe("referential validation", () => {
  it("accepts a directive that points only at real canon", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(batchJson([validDirective]), repo);
    expect(r.ok).toBe(true);
    repo.close();
  });

  it("rejects an invented character -- the failure zod cannot see", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([{ ...validDirective, actor: "lord_nonexistent" }]),
      repo,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.kind).toBe("reference");
      expect(r.issues[0]?.message).toContain("lord_nonexistent");
    }
    repo.close();
  });

  it("rejects a relationship delta between a real and an invented character", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        {
          ...validDirective,
          canon_deltas: [
            { op: "relationship_delta", from_id: "vance", to_id: "ghost", affinity: -5 },
          ],
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(false);
    repo.close();
  });

  it("rejects advancing an arc that was never opened", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        {
          ...validDirective,
          arc_id: null,
          canon_deltas: [{ op: "arc_advance", arc_id: "arc_imaginary", stage_delta: 1 }],
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(false);
    repo.close();
  });

  it("rejects reopening an arc that already exists", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        {
          ...validDirective,
          arc_id: null,
          canon_deltas: [
            {
              op: "arc_open",
              arc_id: "arc_kiln_debt",
              title: "Duplicate",
              participants: ["vance", "okonkwo"],
            },
          ],
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(false);
    repo.close();
  });

  it("allows advancing an arc opened earlier in the same batch", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        {
          actor: "quill",
          action: "post_notice",
          target: "vance",
          dialogue_intent: "opens a new front",
          arc_id: "arc_new",
          canon_deltas: [
            {
              op: "arc_open",
              arc_id: "arc_new",
              title: "The New Thing",
              participants: ["quill", "vance"],
            },
            { op: "arc_advance", arc_id: "arc_new", stage_delta: 1 },
          ],
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(true);
    repo.close();
  });

  it("rejects an actor targeting themselves", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([{ ...validDirective, target: "vance", arc_id: null }]),
      repo,
    );
    expect(r.ok).toBe(false);
    repo.close();
  });

  it("rejects greeting a visitor who has never been seen", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        {
          actor: "vance",
          action: "greet_visitor",
          target: "fan:stranger",
          dialogue_intent: "greets a ghost",
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(false);
    repo.close();
  });

  it("rejects greet_visitor without a fan target", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        {
          actor: "vance",
          action: "greet_visitor",
          target: "okonkwo",
          dialogue_intent: "greets the wrong kind of thing",
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(false);
    repo.close();
  });

  it("accepts a visitor target once the visitor exists", () => {
    const { repo } = freshWorld();
    repo.ensureVisitor("wren", "Wren");
    const r = validateDirectives(
      batchJson([
        {
          actor: "vance",
          action: "greet_visitor",
          target: "fan:wren",
          dialogue_intent: "assesses them",
          canon_deltas: [
            { op: "visitor_stance", fan_id: "wren", character_id: "vance", sentiment: 5 },
          ],
        },
      ]),
      repo,
    );
    expect(r.ok).toBe(true);
    repo.close();
  });

  it("treats an unknown non-character target as a location, with a warning", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([{ ...validDirective, target: "the_ward_board", arc_id: null }]),
      repo,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBeGreaterThan(0);
    repo.close();
  });

  it("reports every problem, not just the first", () => {
    const { repo } = freshWorld();
    const r = validateDirectives(
      batchJson([
        { ...validDirective, actor: "ghost_a", arc_id: null },
        { ...validDirective, actor: "ghost_b", arc_id: null },
      ]),
      repo,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThanOrEqual(2);
    repo.close();
  });
});

describe("repair prompt", () => {
  it("names the offending paths and demands bare JSON", () => {
    const p = issuesToRepairPrompt([
      { path: "directives.0.actor", message: "unknown character 'x'", kind: "reference" },
    ]);
    expect(p).toContain("directives.0.actor");
    expect(p).toContain("unknown character 'x'");
    expect(p.toLowerCase()).toContain("json only");
  });
});

describe("visitor ids are accepted in both spellings", () => {
  // A live Mind writes "fan:wren" here because that is how the prompt refers to
  // visitors everywhere else. Rejecting it broke every visitor directive.
  it("normalises a fan: prefix on visitor_stance.fan_id", () => {
    const { repo } = freshWorld();
    repo.ensureVisitor("wren", "Wren");
    const out = validateDirectives(
      batchJson([{
        actor: "okonkwo",
        action: "greet_visitor",
        target: "fan:wren",
        dialogue_intent: "greets them as one of ours",
        arc_id: "arc_kiln_debt",
        significance_hint: 0.5,
        canon_deltas: [{
          op: "visitor_stance", fan_id: "fan:wren", character_id: "okonkwo",
          sentiment: 12, moment: "took my side", moment_weight: 0.7,
        }],
      }]),
      repo,
    );
    expect(out.ok, JSON.stringify(out.ok ? [] : out.issues)).toBe(true);
    if (out.ok) {
      const delta = out.batch.directives[0]!.canon_deltas[0] as { fan_id: string };
      expect(delta.fan_id).toBe("wren");
    }
    repo.close();
  });

  it("still accepts the bare form", () => {
    const { repo } = freshWorld();
    repo.ensureVisitor("wren", "Wren");
    const out = validateDirectives(
      batchJson([{
        actor: "okonkwo", action: "greet_visitor", target: "fan:wren",
        dialogue_intent: "greets them", arc_id: "arc_kiln_debt", significance_hint: 0.5,
        canon_deltas: [{ op: "visitor_stance", fan_id: "wren", character_id: "okonkwo", sentiment: 5 }],
      }]),
      repo,
    );
    expect(out.ok, JSON.stringify(out.ok ? [] : out.issues)).toBe(true);
    repo.close();
  });

  it("still rejects a visitor who does not exist, either way round", () => {
    const { repo } = freshWorld();
    for (const id of ["ghost", "fan:ghost"]) {
      const out = validateDirectives(
        batchJson([{
          actor: "okonkwo", action: "greet_visitor", target: "fan:ghost",
          dialogue_intent: "greets", arc_id: "arc_kiln_debt", significance_hint: 0.5,
          canon_deltas: [{ op: "visitor_stance", fan_id: id, character_id: "okonkwo", sentiment: 5 }],
        }]),
        repo,
      );
      expect(out.ok).toBe(false);
    }
    repo.close();
  });
});

describe("a host that answers over a rich-text channel", () => {
  // A live Mind wrapped its JSON in HTML. <pre>{...}</pre> survived because the
  // braces still bound the object; {<br> ...} did not, and the tick was lost.
  it("reads JSON wrapped in <pre>", () => {
    const out = extractJson('<pre>{"directives":[]}</pre>');
    expect(out).not.toBeNull();
    expect(JSON.parse(out!)).toEqual({ directives: [] });
  });

  it("reads JSON broken up by <br>", () => {
    const out = extractJson('{<br>  "directives": [],<br>  "note": "hi"<br>}');
    expect(out).not.toBeNull();
    expect(JSON.parse(out!).note).toBe("hi");
  });

  it("decodes the entities that come with the tags", () => {
    const out = extractJson('<pre>{&quot;directives&quot;: [], &quot;note&quot;: &quot;a &amp; b&quot;}</pre>');
    expect(out).not.toBeNull();
    expect(JSON.parse(out!).note).toBe("a & b");
  });

  it("still returns null for prose with no object in it", () => {
    expect(extractJson("<p>I could not do that.</p>")).toBeNull();
  });
});
