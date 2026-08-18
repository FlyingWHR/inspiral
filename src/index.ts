/** Public surface of the Inspiral module. */

export * from "./types/events.js";
export * from "./types/canon.js";
export * from "./types/directive.js";

export { CanonRepo } from "./canon/repo.js";
export { openDb, closeDb } from "./canon/db.js";
export { seedWorld, CHARACTERS, RELATIONSHIPS, ARCS, TONE, WORLD_NAME } from "./canon/seed.js";
export { compileDigest, renderDigest, type TickDigest } from "./canon/digest.js";

export {
  validateDirectives,
  parseShape,
  checkReferences,
  extractJson,
  issuesToRepairPrompt,
  type ValidationIssue,
  type ValidationResult,
} from "./directive/validate.js";
export { applyDirective, applyBatch, type AppliedDirective } from "./directive/apply.js";

export {
  createHostRuntime,
  MockHostRuntime,
  MindsHostRuntime,
  type HostRuntime,
  type HostRequest,
  type HostResponse,
} from "./host/index.js";
export { buildTickPrompt, buildOnboardPrompt, buildFanEventPrompt, protocolPreamble } from "./host/prompt.js";

export {
  performDirective,
  renderBehavior,
  sliceFor,
  findGrievance,
  type RenderedBehavior,
  type CanonSlice,
} from "./runtime/character.js";
export {
  ConsoleSurface,
  MemorySurface,
  NullSurface,
  type SurfaceAdapter,
} from "./runtime/surface.js";

export { runTick, onboardVisitor, visitorAction, type TickContext, type TickOutcome } from "./tick/runTick.js";
export { TickScheduler, type SchedulerOptions } from "./tick/scheduler.js";

export { loadConfig, type InspiralConfig } from "./config.js";
export { VirtualClock, systemClock, type Clock, HOUR_MS, DAY_MS } from "./clock.js";
export { log, setLogLevel } from "./log.js";
