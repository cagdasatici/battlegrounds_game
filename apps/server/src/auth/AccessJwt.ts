import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";

interface Jwk extends JsonWebKey { kid?: string }
interface Claims { aud?: string | string[]; iss?: string; exp?: number; email?: string }

const b64 = (s: string): Buffer => Buffer.from(s, "base64url");
const CERT_TTL_MS = 3600_000;

/**
 * Verifies the `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds after a successful login (RS256, audience and
 * issuer pinned to this application). Makes open join fail closed: if the Access policy is ever removed or bypassed, the
 * header is absent or invalid and no session is minted. No dependencies: node:crypto and fetch only.
 */
export class AccessVerifier {
  private keys: Jwk[] = [];
  private fetchedAt = 0;
  constructor(
    private readonly team: string,
    private readonly aud: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly now: () => number = Date.now,
  ) {}

  private async certs(force: boolean): Promise<Jwk[]> {
    if (!force && this.keys.length > 0 && this.now() - this.fetchedAt < CERT_TTL_MS) return this.keys;
    const r = await this.fetchFn(`https://${this.team}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error("certs");
    const body = (await r.json()) as { keys?: Jwk[] };
    this.keys = body.keys ?? [];
    this.fetchedAt = this.now();
    return this.keys;
  }

  /** Returns the signed-in email, or null when the token is missing, forged, expired or for another application. */
  async verify(token: string | undefined): Promise<string | null> {
    if (!token || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
      const header = JSON.parse(b64(parts[0]!).toString("utf8")) as { alg?: string; kid?: string };
      if (header.alg !== "RS256" || !header.kid) return null;
      let key = (await this.certs(false)).find((k) => k.kid === header.kid);
      if (!key) key = (await this.certs(true)).find((k) => k.kid === header.kid); // key rotation
      if (!key) return null;
      const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: "jwk" }), b64(parts[2]!));
      if (!ok) return null;
      const c = JSON.parse(b64(parts[1]!).toString("utf8")) as Claims;
      const auds = Array.isArray(c.aud) ? c.aud : c.aud ? [c.aud] : [];
      if (!auds.includes(this.aud) || c.iss !== `https://${this.team}.cloudflareaccess.com`) return null;
      if (typeof c.exp !== "number" || c.exp * 1000 <= this.now()) return null;
      return c.email ?? "unknown";
    } catch { return null; }
  }
}
