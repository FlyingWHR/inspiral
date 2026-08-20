import { z } from "zod";
import { type CanonDelta, type Directive, DirectiveBatch } from "../types/directive.js";
import type { CanonRepo } from "../canon/repo.js";

/**
 * Two-stage validation.
 *
 *   Stage 1 SHAPE       -- zod. Is it the right JSON at all?
 *   Stage 2 REFERENTIAL -- does it point at things that exist in canon?
 *
 * Stage 2 is the one that matters. A host will happily invent a fourth faction
 * leader, resolve an arc that was never opened, or move a relationship between
 * two characters one of whom it made up. Shape validation waves all of that
 * through. Nothing reaches the database until both stages pass.
 */

export interface ValidationIssue {
  path: string;
  message: string;
  /** shape = malformed JSON/schema; reference = points at nonexistent canon. */
  kind: "shape" | "reference";
}

export type ValidationResult =
  | { ok: true; batch: DirectiveBatch; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[]; raw: string };

export type DirectiveBatchT = z.infer<typeof DirectiveBatch>;

/**
 * Hosts wrap JSON in prose, code fences, and apologies. Pull the object out
 * before parsing rather than failing a tick over a markdown fence.
 */
export function extractJson(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fence?.[1] ?? trimmed).trim();

  /**
   * A live Mind replies over a rich-text channel and sometimes wraps its JSON
   * in HTML: `<pre>{...}</pre>` parses fine because the braces still bound it,
   * but `{<br>  "directives": ...}` does not, and the whole tick was lost to a
   * line break. Strip the tags and decode the handful of entities that come
   * with them before looking for the object.
   */
  if (/<[a-z/][^>]*>/i.test(body)) {
    body = body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:pre|code|p|div|span|b|i|em|strong)\b[^>]*>/gi, "")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .trim();
  }

  // Fast path: already a bare object.
  if (body.startsWith("{") && body.endsWith("}")) return body;

  // Otherwise take the outermost balanced {...}.
  const start = body.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

function zodIssues(err: z.ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    kind: "shape" as const,
  }));
}

/** Stage 1 only. Exported so tests can pin shape behaviour independently. */
export function parseShape(
  raw: string,
): { ok: true; batch: DirectiveBatchT } | { ok: false; issues: ValidationIssue[] } {
  const json = extractJson(raw);
  if (json === null) {
    return {
      ok: false,
      issues: [{ path: "$", message: "no JSON object found in host response", kind: "shape" }],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      issues: [
        { path: "$", message: `invalid JSON: ${(e as Error).message}`, kind: "shape" },
      ],
    };
  }
  const result = DirectiveBatch.safeParse(parsed);
  if (!result.success) return { ok: false, issues: zodIssues(result.error) };
  return { ok: true, batch: result.data };
}

/** True for `fan:<id>` targets. */
export function isFanRef(ref: string): boolean {
  return ref.startsWith("fan:");
}
export function fanId(ref: string): string {
  return ref.slice(4);
}

function checkDelta(
  d: CanonDelta,
  path: string,
  repo: CanonRepo,
  issues: ValidationIssue[],
  warnings: ValidationIssue[],
  arcsOpenedThisBatch: Set<string>,
): void {
  const ref = (p: string, m: string) => issues.push({ path: p, message: m, kind: "reference" });

  switch (d.op) {
    case "relationship_delta": {
      if (!repo.characterExists(d.from_id))
        ref(`${path}.from_id`, `unknown character '${d.from_id}'`);
      if (!repo.characterExists(d.to_id)) ref(`${path}.to_id`, `unknown character '${d.to_id}'`);
      if (d.from_id === d.to_id)
        ref(`${path}`, `a character cannot hold a relationship with themselves`);
      if (d.affinity === 0 && d.trust === 0 && d.tension === 0 && d.note === undefined) {
        warnings.push({ path, message: "relationship_delta is a no-op", kind: "reference" });
      }
      break;
    }
    case "arc_open": {
      if (repo.arcExists(d.arc_id) || arcsOpenedThisBatch.has(d.arc_id))
        ref(`${path}.arc_id`, `arc '${d.arc_id}' already exists; use arc_advance`);
      for (const [i, p] of d.participants.entries()) {
        if (!isFanRef(p) && !repo.characterExists(p))
          ref(`${path}.participants.${i}`, `unknown participant '${p}'`);
      }
      arcsOpenedThisBatch.add(d.arc_id);
      break;
    }
    case "arc_advance":
    case "arc_resolve": {
      if (!repo.arcExists(d.arc_id) && !arcsOpenedThisBatch.has(d.arc_id))
        ref(`${path}.arc_id`, `unknown arc '${d.arc_id}'`);
      else if (repo.arcExists(d.arc_id)) {
        const arc = repo.getArc(d.arc_id)!;
        if (arc.status === "resolved")
          ref(`${path}.arc_id`, `arc '${d.arc_id}' is already resolved`);
      }
      break;
    }
    case "visitor_stance": {
      if (!repo.visitorExists(d.fan_id)) ref(`${path}.fan_id`, `unknown visitor '${d.fan_id}'`);
      if (!repo.characterExists(d.character_id))
        ref(`${path}.character_id`, `unknown character '${d.character_id}'`);
      break;
    }
    case "character_mood": {
      if (!repo.characterExists(d.character_id))
        ref(`${path}.character_id`, `unknown character '${d.character_id}'`);
      break;
    }
    case "world_fact": {
      for (const [i, a] of d.about.entries()) {
        if (!isFanRef(a) && !repo.characterExists(a))
          warnings.push({
            path: `${path}.about.${i}`,
            message: `fact references '${a}', which is not a character (kept, treated as a place or thing)`,
            kind: "reference",
          });
      }
      break;
    }
  }
}

/** Stage 2. Requires canon to resolve references against. */
export function checkReferences(
  batch: DirectiveBatchT,
  repo: CanonRepo,
): { issues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const arcsOpenedThisBatch = new Set<string>();

  batch.directives.forEach((d: Directive, di: number) => {
    const base = `directives.${di}`;

    if (!repo.characterExists(d.actor)) {
      issues.push({
        path: `${base}.actor`,
        message: `unknown character '${d.actor}'. The cast is fixed; the host may not invent one.`,
        kind: "reference",
      });
    }

    if (d.target !== null && d.target !== "") {
      if (isFanRef(d.target)) {
        if (!repo.visitorExists(fanId(d.target)))
          issues.push({
            path: `${base}.target`,
            message: `unknown visitor '${d.target}'`,
            kind: "reference",
          });
      } else if (!repo.characterExists(d.target)) {
        // Not a character and not a fan -- treat as a place. Allowed, noted.
        warnings.push({
          path: `${base}.target`,
          message: `target '${d.target}' is not a character or visitor; treated as a location`,
          kind: "reference",
        });
      }
      if (d.target === d.actor) {
        issues.push({
          path: `${base}.target`,
          message: `actor cannot target themselves`,
          kind: "reference",
        });
      }
    }

    // Visitor-facing actions must actually name a visitor.
    if (
      (d.action === "greet_visitor" || d.action === "recruit_visitor") &&
      (d.target === null || !isFanRef(d.target))
    ) {
      issues.push({
        path: `${base}.target`,
        message: `action '${d.action}' requires a fan:<id> target`,
        kind: "reference",
      });
    }

    if (d.arc_id !== null && d.arc_id !== "" && !repo.arcExists(d.arc_id)) {
      const openedHere = d.canon_deltas.some(
        (x) => x.op === "arc_open" && x.arc_id === d.arc_id,
      );
      if (!openedHere)
        issues.push({
          path: `${base}.arc_id`,
          message: `unknown arc '${d.arc_id}'`,
          kind: "reference",
        });
    }

    d.canon_deltas.forEach((delta, xi) => {
      checkDelta(delta, `${base}.canon_deltas.${xi}`, repo, issues, warnings, arcsOpenedThisBatch);
    });
  });

  return { issues, warnings };
}

/** Full validation. This is what the tick loop calls. */
export function validateDirectives(raw: string, repo: CanonRepo): ValidationResult {
  const shape = parseShape(raw);
  if (!shape.ok) return { ok: false, issues: shape.issues, raw };

  const { issues, warnings } = checkReferences(shape.batch, repo);
  if (issues.length > 0) return { ok: false, issues, raw };

  return { ok: true, batch: shape.batch, warnings };
}

/** Compact error text fed back to the host on the single repair attempt. */
export function issuesToRepairPrompt(issues: ValidationIssue[]): string {
  const lines = issues.slice(0, 12).map((i) => `  - ${i.path}: ${i.message}`);
  return [
    "Your previous response was rejected by the canon validator.",
    "",
    "Problems:",
    ...lines,
    "",
    "Reply with corrected JSON only. No prose, no code fence, no explanation.",
    "Use only character ids and arc ids that appeared in the digest.",
  ].join("\n");
}
