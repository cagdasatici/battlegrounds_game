const REDACT_KEYS = /invite|token|ticket|cookie|secret|authorization|reconnection/i;
/** Exact personal-data keys (anchored so ids like "roomName" or "tripId" are not swallowed). */
const REDACT_EXACT = /^(displayName|name|ip|ipAddress|remoteAddress)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) || REDACT_EXACT.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type LogSink = (line: string) => void;
let sink: LogSink = (l) => console.log(l);
export function setLogSink(s: LogSink): void { sink = s; }

const RECENT_MAX = 50;
const recent: string[] = [];
/** Last structured lines, already redacted (the same text the sink receives). For the admin status view. */
export const recentLogLines = (): string[] => [...recent];

export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, t: Date.now(), ...(redact(fields) as object) });
  recent.push(line);
  if (recent.length > RECENT_MAX) recent.shift();
  sink(line);
}
