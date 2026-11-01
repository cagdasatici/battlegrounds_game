/**
 * Response security headers (T29, spec section 24). One place builds the CSP so the static server and the API agree.
 * 'wasm-unsafe-eval' is the single documented exception: @dimforge/rapier3d-compat instantiates an embedded WebAssembly
 * module in the client. connect-src allows data: because GLTFLoader fetches the base64 buffers embedded in the shipped
 * glTF files; a data: URI cannot reach a remote host. There is no unsafe-eval, no unsafe-inline and no inline script or style in the built page.
 */
export function contentSecurityPolicy(publicOrigin: string): string {
  const u = new URL(publicOrigin);
  const ws = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' data: ${ws}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

export function securityHeaders(publicOrigin: string): Record<string, string> {
  return {
    "Content-Security-Policy": contentSecurityPolicy(publicOrigin),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/** Exact match against the allowlist. A missing Origin (non-browser client) is reported separately so callers choose. */
export function originOk(origin: string | null | undefined, allowed: readonly string[]): "ok" | "missing" | "foreign" {
  if (origin === undefined || origin === null || origin === "") return "missing";
  return allowed.includes(origin) ? "ok" : "foreign";
}
