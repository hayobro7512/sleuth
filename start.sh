#!/bin/sh
# Starts the API. Reads NVIDIA_API_KEY from the environment or from a .env file next to this script. Never prints it.
cd "$(dirname "$0")" || exit 1
[ -f .env ] && { set -a; . ./.env; set +a; }
[ -n "$NVIDIA_API_KEY" ] || { echo "No NVIDIA_API_KEY. Copy .env.example to .env and paste your free key (build.nvidia.com)."; exit 1; }
exec node server/server.js
