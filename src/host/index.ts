import type { InspiralConfig } from "../config.js";
import type { HostRuntime } from "./HostRuntime.js";
import { MockHostRuntime } from "./mock.js";
import { MindsHostRuntime } from "./minds.js";
import { log } from "../log.js";

export type { HostRuntime, HostRequest, HostResponse, HostCallKind } from "./HostRuntime.js";
export { MockHostRuntime } from "./mock.js";
export { MindsHostRuntime } from "./minds.js";

/**
 * THIS SWITCH IS THE ENTIRE SWAP COST.
 *
 * Adding a host means writing one class that implements HostRuntime and adding
 * one case here. Nothing else in the codebase knows a vendor exists.
 *
 * The mock is the default on purpose: the demo must run for someone who has
 * never heard of Minds and has no key.
 */
export function createHostRuntime(cfg: InspiralConfig): HostRuntime {
  if (cfg.host === "minds") {
    const key = process.env.MINDS_BUILDER_API_KEY ?? "";
    if (!key) {
      log.warn(
        "INSPIRAL_HOST=minds but MINDS_BUILDER_API_KEY is empty -- falling back to the mock host.",
      );
      return new MockHostRuntime({ seed: cfg.seed });
    }
    log.info("host runtime: minds (one Mind, three projections)");
    return new MindsHostRuntime({
      builderApiKey: key,
      mindId: cfg.mindId,
      timeoutMs: cfg.hostTimeoutMs,
      aliases: cfg.aliases,
    });
  }

  log.info("host runtime: mock (deterministic, no network)");
  return new MockHostRuntime({ seed: cfg.seed });
}
