const REDACT_KEYS = /invite|token|ticket|cookie|secret|authorization|reconnection/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type LogSink = (line: string) => void;
let sink: LogSink = (l) => console.log(l);
export function setLogSink(s: LogSink): void { sink = s; }

export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}): void {
  sink(JSON.stringify({ level, msg, t: Date.now(), ...(redact(fields) as object) }));
}
