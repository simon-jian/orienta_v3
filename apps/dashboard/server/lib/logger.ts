/**
 * Minimal structured logger (P1-3).
 *
 * Emits one JSON object per line so log shippers (Loki, CloudWatch, etc.) can
 * parse levels and fields without regex. Honors LOG_LEVEL (debug|info|warn|error).
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveThreshold(): number {
  const raw = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVEL_ORDER[(raw as Level)] ?? LEVEL_ORDER.info;
}

const threshold = resolveThreshold();

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
