/** Minimal leveled logger. No dependency, no config file, silenceable in tests. */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

let current: LogLevel = (process.env.INSPIRAL_LOG as LogLevel) || "info";

export function setLogLevel(level: LogLevel): void {
  current = level;
}

function emit(level: Exclude<LogLevel, "silent">, msg: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[current]) return;
  const line = `[inspiral] ${level.toUpperCase().padEnd(5)} ${msg}`;
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  if (extra === undefined) stream(line);
  else stream(line, extra);
}

export const log = {
  debug: (m: string, e?: unknown) => emit("debug", m, e),
  info: (m: string, e?: unknown) => emit("info", m, e),
  warn: (m: string, e?: unknown) => emit("warn", m, e),
  error: (m: string, e?: unknown) => emit("error", m, e),
};
