# A permanent address for the Go connector

The quick tunnel (`cloudflared tunnel --url ...`) gives a new `https://....trycloudflare.com` address every time it starts, so you must re-enter it in Go's connector sign-in. A permanent address needs an account, which is a step only you can do. Pick one.

## Option A: ngrok free static domain (simplest, no domain of your own)
1. Create an ngrok account at ngrok.com and claim your free static domain in its dashboard (it looks like `your-name.ngrok-free.app`). Check that the free plan still includes one.
2. `brew install ngrok`, then `ngrok config add-authtoken <token from your dashboard>` (the token is a credential: do not paste it in chat).
3. Start everything: `SS_NGROK_DOMAIN=your-name.ngrok-free.app sh scripts/run.sh`
4. In Go: Connectors -> Sign-up Shield -> sign in once with `https://your-name.ngrok-free.app` and your token (`cat ss_token.txt | pbcopy`).

## Option B: Cloudflare named tunnel (needs a domain on Cloudflare)
1. `cloudflared tunnel login` (opens a browser), then `cloudflared tunnel create shield`.
2. `cloudflared tunnel route dns shield shield.yourdomain.com`
3. Create `~/.cloudflared/config.yml` with `tunnel: shield`, `credentials-file: ~/.cloudflared/<id>.json`, and `ingress: - hostname: shield.yourdomain.com  service: http://localhost:8787  - service: http_status:404`.
4. `SS_TUNNEL_NAME=shield sh scripts/run.sh`, then sign in once in Go with `https://shield.yourdomain.com`.

## Option C: host the server (Render, Fly, Railway; about $5-7 a month)
The server is plain Node. It needs a persistent disk for `server/data/memory.json`, and the environment variables `NVIDIA_API_KEY` and `SS_TOKEN`. The `/analyze` and extension routes only work from the same machine; for a hosted server the extension would need real per-user authentication first. Not done.

## Whatever you choose
- The connector's endpoint is stored in the Go sign-in. Changing the address means signing in again once.
- Keep your Mac awake while the server runs, or the tunnel drops.
- Connector routes need `SS_TOKEN`; `/analyze`, `/dashboard`, deletes, and all writes are refused when they arrive through a tunnel.

## Set up on 2026-10-17 (ngrok)
- Static domain: `https://your-name.ngrok-free.dev` (free plan). The ngrok authtoken is saved in ngrok's own config file only.
- Start everything: `SS_NGROK_DOMAIN=your-name.ngrok-free.dev sh scripts/run.sh` (kills any server on port 8787, starts the server and the tunnel).
- A static domain accepts one running tunnel at a time. If a second start fails with ERR_NGROK_334, stop the first one.
- Connector: Go -> Connectors -> Your connectors -> Sign-up Shield "..." -> Settings -> Open settings -> **Sign in again**, enter the domain above and the token (`cat ss_token.txt | pbcopy`). "Session logs" on that page shows connector errors.
