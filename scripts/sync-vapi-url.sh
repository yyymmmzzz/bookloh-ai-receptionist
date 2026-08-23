#!/bin/bash
# sync-vapi-url.sh — push the current public URL to Vapi and .env.local
# Run this whenever cloudflared restarts and gets a new URL.

set -e

URL=$(grep -oE 'https://[a-z-]+\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | head -1)
if [ -z "$URL" ]; then
  echo "✗ No tunnel URL found in /tmp/cloudflared.log"
  exit 1
fi

DEMO_DIR="/Users/yimozhang/Business/HandyBook/demo"
ENV_FILE="$DEMO_DIR/.env.local"

# Update .env.local
if grep -q "NEXT_PUBLIC_APP_URL" "$ENV_FILE"; then
  sed -i '' "s|NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=$URL|" "$ENV_FILE"
  echo "✓ Updated .env.local: $URL"
fi

# Push to Vapi via node script
cd "$DEMO_DIR"
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8');
const KEY = env.match(/VAPI_API_KEY=(.+)/)[1].trim();
const ASSISTANT_ID = env.match(/VAPI_ASSISTANT_ID=(.+)/)[1].trim();
const https = require('https');
const newUrl = '$URL/api/vapi/tools';
const body = JSON.stringify({ serverUrl: newUrl, serverUrlSecret: 'dev-secret' });
const req = https.request({ hostname: 'api.vapi.ai', path: '/assistant/' + ASSISTANT_ID, method: 'PATCH', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }}, (res) => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('✓ Vapi updated:', JSON.parse(d).serverUrl);
    } else {
      console.log('✗ Vapi failed:', res.statusCode, d.slice(0, 200));
      process.exit(1);
    }
  });
});
req.write(body); req.end();
"

echo
echo "Public URL: $URL"
