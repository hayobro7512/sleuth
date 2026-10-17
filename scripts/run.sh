#!/bin/sh
# Starts the Sign-up Shield server and a public tunnel for the Go connector. Run it in your own Terminal; Ctrl+C stops both.
#   sh scripts/run.sh                         quick tunnel: a new https address every start (re-enter it in the connector)
#   SS_TUNNEL_NAME=shield sh scripts/run.sh   named Cloudflare tunnel: the same address every start (see docs/PERMANENT_TUNNEL.md)
#   SS_NGROK_DOMAIN=your-name.ngrok-free.app sh scripts/run.sh   ngrok static domain: the same address every start
cd "$(dirname "$0")/.." || exit 1
[ -f ss_token.txt ] || { openssl rand -hex 24 > ss_token.txt; chmod 600 ss_token.txt; echo "Created ss_token.txt"; }
export SS_TOKEN="$(cat ss_token.txt)"
lsof -ti tcp:8787 | xargs kill 2>/dev/null
sh start.sh &
SERVER=$!
trap 'kill $SERVER $TUNNEL 2>/dev/null' EXIT INT TERM
sleep 2
if [ -n "$SS_TUNNEL_NAME" ]; then
  cloudflared tunnel run "$SS_TUNNEL_NAME" & TUNNEL=$!
elif [ -n "$SS_NGROK_DOMAIN" ]; then
  ngrok http --url="$SS_NGROK_DOMAIN" 8787 --log=stdout & TUNNEL=$!
else
  cloudflared tunnel --url http://localhost:8787 --no-autoupdate 2>&1 | grep --line-buffered -E "trycloudflare.com|ERR" & TUNNEL=$!
  echo "Look for the https://....trycloudflare.com address above. Enter it in the connector sign-in."
fi
echo "Token (copy without showing): cat ss_token.txt | pbcopy"
wait
