/**
 * Config is read from the environment once, with working defaults for every
 * value. The demo must run with an empty environment.
 */

export interface InspiralConfig {
  host: "mock" | "minds";
  dbPath: string;
  tickMinutes: number;
  dailyHostBudget: number;
  seed: number;
  hostTimeoutMs: number;
  mindId: string | undefined;
  aliases: {
    tick: string;
    onboard: string;
    fanEvents: string;
    qc: string;
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): InspiralConfig {
  const host = env.INSPIRAL_HOST === "minds" ? "minds" : "mock";
  return {
    host,
    dbPath: env.INSPIRAL_DB && env.INSPIRAL_DB !== "" ? env.INSPIRAL_DB : "./data/canon.db",
    tickMinutes: num(env.INSPIRAL_TICK_MINUTES, 240),
    dailyHostBudget: num(env.INSPIRAL_DAILY_HOST_BUDGET, 12),
    seed: num(env.INSPIRAL_SEED, 1),
    hostTimeoutMs: num(env.INSPIRAL_HOST_TIMEOUT_MS, 180_000),
    mindId: env.INSPIRAL_MIND_ID && env.INSPIRAL_MIND_ID !== "" ? env.INSPIRAL_MIND_ID : undefined,
    aliases: {
      tick: env.INSPIRAL_ALIAS_TICK || "tick",
      onboard: env.INSPIRAL_ALIAS_ONBOARD || "onboard",
      fanEvents: env.INSPIRAL_ALIAS_FAN_EVENTS || "fan-events",
      qc: env.INSPIRAL_ALIAS_QC || "qc",
    },
  };
}
