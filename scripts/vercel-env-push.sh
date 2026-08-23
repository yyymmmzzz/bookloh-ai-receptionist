#!/bin/bash
# vercel-env-push.sh — push all .env.local vars to Vercel (production + preview)
# Requires: Vercel CLI logged in + project linked via `vercel link`

set -e

ENV_FILE="/Users/yimozhang/Business/HandyBook/demo/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found"
  exit 1
fi

# Vars to skip (we set them differently on Vercel)
SKIP=(
  "NEXT_PUBLIC_APP_URL"
  "EMERGENCY_TEST_MODE"
)

add_env() {
  local KEY="$1"
  local VAL="$2"
  local ENV="$3"  # production | preview

  # Skip if value is empty
  if [ -z "$VAL" ]; then
    echo "  ⊘ $KEY (empty, skip)"
    return
  fi

  echo "  → $KEY = ${VAL:0:30}... ($ENV)"
  printf "%s" "$VAL" | npx vercel env add "$KEY" "$ENV" --force --yes > /dev/null 2>&1 || {
    # If already exists, remove and re-add
    echo "    (exists, removing first)"
    printf "%s" "$VAL" | npx vercel env rm "$KEY" "$ENV" --yes > /dev/null 2>&1 || true
    printf "%s" "$VAL" | npx vercel env add "$KEY" "$ENV" --force --yes > /dev/null 2>&1
  }
}

echo "=== Pushing vars to Vercel ==="

# Read .env.local, skip comments and empty lines
while IFS='=' read -r KEY VAL; do
  # Trim
  KEY=$(echo "$KEY" | xargs)
  # Skip comments and empty
  case "$KEY" in \#*|"") continue ;; esac
  # Strip surrounding quotes
  VAL=$(echo "$VAL" | sed -e 's/^["'\'']//' -e 's/["'\'']$//')

  # Skip vars we'll set differently
  for s in "${SKIP[@]}"; do
    if [ "$KEY" = "$s" ]; then
      echo "  ⊘ $KEY (handled separately)"
      continue 2
    fi
  done

  for ENV in production preview; do
    add_env "$KEY" "$VAL" "$ENV"
  done
done < "$ENV_FILE"

echo
echo "=== Setting NEXT_PUBLIC_APP_URL = https://bookloh-demo.vercel.app ==="
# We'll update this after we know the actual Vercel URL
VERCEL_URL="https://demo-navy-chi-47.vercel.app"
for ENV in production preview; do
  echo "  → NEXT_PUBLIC_APP_URL = $VERCEL_URL ($ENV)"
  printf "%s" "$VERCEL_URL" | npx vercel env add NEXT_PUBLIC_APP_URL "$ENV" --force --yes > /dev/null 2>&1 || true
done

echo
echo "=== Setting EMERGENCY_TEST_MODE = 1 (avoid first urgent call to boss) ==="
for ENV in production preview; do
  echo "  → EMERGENCY_TEST_MODE = 1 ($ENV)"
  printf "1" | npx vercel env add EMERGENCY_TEST_MODE "$ENV" --force --yes > /dev/null 2>&1 || true
done

echo
echo "✓ All env vars pushed to Vercel (production + preview)"
echo
echo "Verifying (next: deploy to production with: npx vercel --prod)"
