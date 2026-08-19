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
 * one case here. Everything downstream reads canon, so a Mind reaches every
 * surface -- browser, voxel world, terminal -- without knowing any of them exist.
 *
 * The mock is the default on purpose: the demo must run for someone who has
 * never heard of Minds and has no key.
 */
/**
 * Construct the host AND bring it up, degrading to the mock if it cannot start.
 *
 * createHostRuntime already handles a missing key, but a key that is present
 * and wrong only fails later, inside init() -- which used to take the whole
 * process with it. A typo in .env should cost a warning, not the demo.
 */
export async function startHostRuntime(cfg: InspiralConfig): Promise<HostRuntime> {
  const host = createHostRuntime(cfg);
  try {
    await host.init();
    return host;
  } catch (e) {
    if (host.name === "mock") throw e; // the mock failing is a real bug
    log.warn(
      `host "${host.name}" failed to start (${(e as Error).message}) -- falling back to the mock.`,
    );
    const fallback = new MockHostRuntime({ seed: cfg.seed });
    await fallback.init();
    return fallback;
  }
}

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
