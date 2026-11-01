import net from "node:net";

/**
 * R18 delay proxy (spec section 26). A TCP proxy that forwards WebSocket bytes in order. Every chunk is delayed by
 * rttMs / 2 plus a uniform jitter in [0, jitterMs]. Delivery times are clamped to be non decreasing per direction, so the
 * byte order is never broken (TCP head-of-line blocking; no unordered delivery is simulated, no loss is simulated).
 * The delays are applied for real with timers; `stats()` reports what was actually applied.
 */
export interface LatencyOptions { rttMs: number; jitterMs: number; seed?: number }
export interface LatencyStats { chunks: number; meanDelayMs: number; maxDelayMs: number; bytes: number }

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LatencyProxy {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly rand: () => number;
  private n = 0;
  private sum = 0;
  private max = 0;
  private bytes = 0;
  port = 0;

  constructor(private readonly targetPort: number, private readonly opt: LatencyOptions) {
    this.rand = mulberry32(opt.seed ?? 1);
    this.server = net.createServer((client) => this.accept(client));
  }

  async start(): Promise<void> {
    await new Promise<void>((res) => this.server.listen(0, "127.0.0.1", res));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  stats(): LatencyStats {
    return { chunks: this.n, meanDelayMs: this.n ? this.sum / this.n : 0, maxDelayMs: this.max, bytes: this.bytes };
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((res) => this.server.close(() => res()));
  }

  private accept(client: net.Socket): void {
    const upstream = net.connect(this.targetPort, "127.0.0.1");
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    for (const s of [client, upstream]) {
      this.sockets.add(s);
      s.on("error", () => { client.destroy(); upstream.destroy(); });
      s.on("close", () => { this.sockets.delete(s); client.destroy(); upstream.destroy(); });
    }
    this.pipe(client, upstream);
    this.pipe(upstream, client);
  }

  private pipe(from: net.Socket, to: net.Socket): void {
    let lastDue = 0;
    from.on("data", (chunk: Buffer) => {
      const delay = this.opt.rttMs / 2 + this.rand() * this.opt.jitterMs;
      const now = performance.now();
      const due = Math.max(lastDue, now + delay);
      lastDue = due;
      const applied = due - now;
      this.n++;
      this.sum += applied;
      this.max = Math.max(this.max, applied);
      this.bytes += chunk.length;
      const t = setTimeout(() => { this.timers.delete(t); if (!to.destroyed) to.write(chunk); }, applied);
      this.timers.add(t);
    });
  }
}
