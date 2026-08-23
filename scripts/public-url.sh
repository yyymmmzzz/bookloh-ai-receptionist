#!/bin/bash
# public-url.sh — show the current Cloudflare Tunnel public URL.
# Usage: ./scripts/public-url.sh

URL=$(grep -oE 'https://[a-z-]+\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | head -1)

if [ -z "$URL" ]; then
  echo "No tunnel URL found in /tmp/cloudflared.log"
  echo "Tunnel status:"
  launchctl list | grep cloudflared || echo "  (not running)"
  exit 1
fi

echo "$URL"

# Check that Vapi serverUrl matches
ENV_URL=$(grep NEXT_PUBLIC_APP_URL /Users/yimozhang/Business/HandyBook/demo/.env.local | cut -d= -f2)
if [ "$ENV_URL" != "$URL" ]; then
  echo
  echo "⚠️  .env.local has $ENV_URL"
  echo "   Run scripts/sync-vapi-url.sh to push the new URL to Vapi"
fi
