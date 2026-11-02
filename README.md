# battlegrounds_game

**Quick start: `pnpm play`** builds the game, creates an invitation, prints the link and a QR code, and starts the server for your home Wi-Fi (plain HTTP on this computer's private IP; Ctrl-C stops it). Flags: `--local` (this computer only), `--tailscale` (HTTPS via Tailscale Serve, opt-in), `--host-ip <ip>`, `--no-build`, `--uses N` (default 4), `--hours N` (default 24). On the iPad: open the link in Safari, then Share > Add to Home Screen. Needs Node 24: `export PATH="$HOME/.local/node24/bin:$PATH"`. See `docs/deployment-runbook.md` and `docs/decisions/0018-home-lan-http-default.md`.

## Admin and reusable home address

Run `pnpm admin:setup` once in a terminal on the host. It prompts twice without
echoing the password and stores only a private scrypt hash in `~/eb-data` (or
`DATA_DIR`). No default admin password exists. Restart `pnpm play`, then open
its printed **Admin** address (`/admin.html`). Rooms supports 0–3 bots and their
difficulty; players use **Find a room** to join. Close/recreate a room to change
its roster. Admin-created rooms currently last until the server restarts.

Bookmark the printed **Game home** address, without an invitation fragment.
An invitation is needed for initial player access; the same browser can return
using its saved session until expiry/revocation. The host must remain running;
this does not install an always-on service. Keep the same port and host IP for
the bookmark. If 2567 is already occupied, stop the previous game or use
`PORT=2568 pnpm play`. Stop the old terminal server before restarting on 2568.
An explicit `ADMIN_PASSWORD_HASH` takes precedence over the local setup file;
`ADMIN_ENABLED=0` still disables admin.
