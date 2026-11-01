# Hosting on cagdasatici.com with Cloudflare (owner steps)

Goal: `https://play.cagdasatici.com` serves the game to the iPads over HTTPS. HTTPS is required for installing a web app to the iPad home screen. Cost: Cloudflare Tunnel and DNS are free; no Apple developer account is involved (this is a web app, installed from Safari with Share > Add to Home Screen).

The game server runs on your Mac (or any always-on machine) and listens only on 127.0.0.1. A Cloudflare Tunnel makes an outbound connection to Cloudflare, so you open no router ports and need no public IP. Cloudflare proxies WebSockets by default, which the game needs.

## 1. Server environment
Copy `ops/deploy/env.example` to a file outside the repository (chmod 600) and set:
```
NODE_ENV=production
HOST=127.0.0.1
PORT=2567
PUBLIC_ORIGIN=https://play.cagdasatici.com
DATA_DIR=/Users/<you>/eb-data
BUILD_ID=<short commit hash>
```
Build the client (`pnpm build`), then start with `EB_ENV_FILE=<that file> ops/deploy/run-prod.sh` (or the launchd plist in `ops/deploy`).

## 2. Cloudflare Tunnel
```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create battlegrounds
cloudflared tunnel route dns battlegrounds play.cagdasatici.com
```
`route dns` creates the DNS record for you: a proxied (orange cloud) CNAME `play` pointing to `<tunnel-id>.cfargotunnel.com`. Check it under Cloudflare dashboard > cagdasatici.com > DNS > Records.

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: battlegrounds
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: play.cagdasatici.com
    service: http://127.0.0.1:2567
  - service: http_status:404
```
Run it: `cloudflared tunnel run battlegrounds`. To keep it running after reboot: `sudo cloudflared service install`.

## 3. Cloudflare dashboard settings (cagdasatici.com)
- SSL/TLS > Overview: **Full (strict)** (the tunnel presents a valid certificate to Cloudflare).
- SSL/TLS > Edge Certificates: Always Use HTTPS **on**. Minimum TLS 1.2.
- Network: WebSockets **on** (default).
- Caching: leave defaults. The game sends `Cache-Control: no-store` for API calls; the service worker (WEB1) handles file caching, so do not enable Rocket Loader, Auto Minify or any "Email obfuscation"/JS rewriting for this hostname.
- Optional but recommended for the future admin page (WEB4): Zero Trust > Access > Applications > add `play.cagdasatici.com/admin*` with an email one-time-PIN policy limited to your address. That puts a second login in front of the admin app.

## 4. Verify
1. `curl https://play.cagdasatici.com/healthz` returns `{"ok":true}`.
2. `curl https://play.cagdasatici.com/api/version` shows your `buildId`.
3. Make an invite: `DATA_DIR=<dir> pnpm tsx ops/scripts/invite.ts https://play.cagdasatici.com`, open it on an iPad in Safari.
4. After WEB1 ships: Share > Add to Home Screen, then launch from the icon.

## Updating
Pull, `pnpm build`, bump `BUILD_ID`, restart the server. Installed iPads show the **Update** button on next launch (WEB2). Server-only changes need only the restart.

Never commit the env file, the tunnel credentials JSON or the data directory.
