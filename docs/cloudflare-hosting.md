# Hosting on cagdasatici.com with Cloudflare (owner steps)

Goal: `https://battle.cagdasatici.com` serves the game to the iPads over HTTPS. HTTPS is required for installing a web app to the iPad home screen. Cost: Cloudflare Tunnel and DNS are free; no Apple developer account is involved (this is a web app, installed from Safari with Share > Add to Home Screen).

The game server runs on your Mac (or any always-on machine) and listens only on 127.0.0.1. A Cloudflare Tunnel makes an outbound connection to Cloudflare, so you open no router ports and need no public IP. Cloudflare proxies WebSockets by default, which the game needs.

## 1. Server environment
Copy `ops/deploy/env.example` to a file outside the repository (chmod 600) and set:
```
NODE_ENV=production
HOST=127.0.0.1
PORT=2567
PUBLIC_ORIGIN=https://battle.cagdasatici.com
DATA_DIR=/Users/<you>/eb-data
BUILD_ID=<short commit hash>
```
Build the client (`pnpm build`), then start with `EB_ENV_FILE=<that file> ops/deploy/run-prod.sh` (or the launchd plist in `ops/deploy`).

## 2. Cloudflare Tunnel
```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create battlegrounds
cloudflared tunnel route dns battlegrounds battle.cagdasatici.com
```
`route dns` creates the DNS record for you: a proxied (orange cloud) CNAME `play` pointing to `<tunnel-id>.cfargotunnel.com`. Check it under Cloudflare dashboard > cagdasatici.com > DNS > Records.

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: battlegrounds
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: battle.cagdasatici.com
    service: http://127.0.0.1:2567
  - service: http_status:404
```
Run it: `cloudflared tunnel run battlegrounds`. To keep it running after reboot: `sudo cloudflared service install`.

## 3. Cloudflare dashboard settings (cagdasatici.com)
- SSL/TLS > Overview: **Full (strict)** (the tunnel presents a valid certificate to Cloudflare).
- SSL/TLS > Edge Certificates: Always Use HTTPS **on**. Minimum TLS 1.2.
- Network: WebSockets **on** (default).
- Caching: leave defaults. The game sends `Cache-Control: no-store` for API calls; the service worker (WEB1) handles file caching, so do not enable Rocket Loader, Auto Minify or any "Email obfuscation"/JS rewriting for this hostname.
- Optional but recommended for the admin app (WEB4/WEB5, served at `/admin`): Zero Trust > Access > Applications > add `battle.cagdasatici.com/admin*` and `battle.cagdasatici.com/api/admin*` with an email one-time-PIN policy limited to your address. That puts a second login in front of the admin app and its API. Enable the admin by setting `ADMIN_PASSWORD_HASH` (print one with `ops/scripts/admin-hash.ts`).

## 3a. Open join and Cloudflare Access (decision 0050)
Players pick Arel or Nora and are seated in the one shared room; no invitation. Access to the hostname is protected by Cloudflare Access, with one email PIN per device.
1. Zero Trust > Settings > Authentication: keep "One-time PIN" enabled. Note your team name (`<team>.cloudflareaccess.com`).
2. Zero Trust > Access > Applications > Add > Self-hosted. Application domain `battle.cagdasatici.com` (whole hostname, no path). Session duration 1 month. Policy "Allow": Emails: the addresses of the people who may play. Do not add a Bypass or "Everyone" rule.
3. Open the application's overview and copy the **Application Audience (AUD) Tag**.
4. In `~/eb-env` add: `OPEN_JOIN=1`, `CF_ACCESS_TEAM=<team>`, `CF_ACCESS_AUD=<aud tag>`. Restart the server (see "Running at boot").
5. Test: a private tab on mobile data opens the Access email-PIN page first; after the PIN the game shows the Arel/Nora picker. `curl -i -X POST https://battle.cagdasatici.com/api/open-session` without a login never returns the game (Access intercepts it); the server also answers 401 `ACCESS_REQUIRED` if a request ever reaches it without a valid token.
The admin app keeps its own password and may additionally sit under the `/admin*` Access rule above.

## 4. Verify
1. `curl https://battle.cagdasatici.com/healthz` returns `{"ok":true}`.
2. `curl https://battle.cagdasatici.com/api/version` shows your `buildId`.
3. Make an invite: `DATA_DIR=<dir> pnpm --filter @eb/server exec tsx ../../ops/scripts/invite.ts https://battle.cagdasatici.com`, open it on an iPad in Safari.
4. After WEB1 ships: Share > Add to Home Screen, then launch from the icon.

## Updating
Pull, `pnpm build`, bump `BUILD_ID`, restart the server. Installed iPads show the **Update** button on next launch (WEB2). Server-only changes need only the restart.

Never commit the env file, the tunnel credentials JSON or the data directory.

## Running at boot on macOS (as set up for this project)
- Game server: launchd job `~/Library/LaunchAgents/com.elementalbattlegrounds.server.plist` runs `ops/deploy/run-prod.sh` with `EB_ENV_FILE=~/eb-env`; logs in `~/eb-logs`. It starts at login (FileVault prevents auto-login, so after a reboot unlock the disk and log in). Restart after an update: `launchctl kickstart -k gui/$(id -u)/com.elementalbattlegrounds.server`.
- Tunnel: a system daemon `/Library/LaunchDaemons/com.cloudflare.cloudflared.plist` whose arguments are `--config /etc/cloudflared/config.yml tunnel run battlegrounds`. The default `cloudflared service install` runs bare `cloudflared` and does nothing, so keep these arguments. The config and credentials JSON are copied to `/etc/cloudflared` (credentials mode 600). Logs: `/Library/Logs/com.cloudflare.cloudflared.err.log`.
- Keep the Mac awake: `sudo pmset -a sleep 0`.
