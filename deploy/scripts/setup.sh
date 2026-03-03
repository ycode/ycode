#!/usr/bin/env bash
###############################################################################
# Ycode Self-Hosted — Initial Setup for Unraid
# Usage: bash scripts/setup.sh
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"

echo "╔══════════════════════════════════════════════════╗"
echo "║   Ycode Self-Hosted — Initial Setup              ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check prerequisites ────────────────────────────────────────────
echo "==> Checking prerequisites..."

for cmd in docker node git openssl; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd is required but not installed."
    exit 1
  fi
done

# Check docker compose (v2)
if ! docker compose version &> /dev/null; then
  echo "ERROR: docker compose v2 is required."
  echo "       Install Docker Compose plugin."
  exit 1
fi

echo "    All prerequisites met."
echo ""

# ── Step 2: Create directory structure ──────────────────────────────────────
echo "==> Creating directory structure..."

mkdir -p "$DEPLOY_DIR/volumes/db/data"
mkdir -p "$DEPLOY_DIR/volumes/db/init"
mkdir -p "$DEPLOY_DIR/volumes/storage"
mkdir -p "$DEPLOY_DIR/volumes/functions"
mkdir -p "$DEPLOY_DIR/backups"

echo "    Directories created."
echo ""

# ── Step 3: Fetch Supabase DB init scripts ─────────────────────────────────
echo "==> Fetching Supabase database init scripts..."

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/supabase/supabase.git "$TEMP_DIR/supabase" 2>/dev/null

cd "$TEMP_DIR/supabase"
git sparse-checkout set docker/volumes/db/init 2>/dev/null
cd -

if [ -d "$TEMP_DIR/supabase/docker/volumes/db/init" ]; then
  cp -r "$TEMP_DIR/supabase/docker/volumes/db/init/"* "$DEPLOY_DIR/volumes/db/init/" 2>/dev/null || true
  echo "    DB init scripts copied."
else
  echo "    WARNING: Could not fetch DB init scripts. You may need to copy them manually."
  echo "    Source: https://github.com/supabase/supabase/tree/master/docker/volumes/db/init"
fi

echo ""

# ── Step 4: Generate secrets ───────────────────────────────────────────────
echo "==> Generating secrets..."
bash "$SCRIPT_DIR/generate-secrets.sh"

# ── Step 5: Prompt for remaining configuration ─────────────────────────────
ENV_FILE="$DEPLOY_DIR/.env"

echo ""
echo "==> Please configure the following in $ENV_FILE:"
echo ""
echo "  1. SITE_URL             — Your ycode domain (e.g., https://ycode.example.com)"
echo "  2. API_EXTERNAL_URL     — Supabase API URL (e.g., https://supa.example.com)"
echo "  3. SUPABASE_PUBLIC_URL  — Same as API_EXTERNAL_URL"
echo "  4. SELF_HOSTED_SUPABASE_HOSTNAME — e.g., supa.example.com"
echo "  5. CLOUDFLARE_TUNNEL_TOKEN — From Cloudflare Zero Trust dashboard"
echo ""
read -p "Press Enter once you've updated .env (or Ctrl+C to configure later)..."
echo ""

# ── Step 6: Build ycode Docker image ───────────────────────────────────────
echo "==> Building ycode Docker image (this may take a few minutes)..."

# Source .env to get build args
set -a
source "$ENV_FILE"
set +a

docker compose -f "$DEPLOY_DIR/docker-compose.yml" build ycode ycode-migrate

echo "    Build complete."
echo ""

# ── Step 7: Start the stack ────────────────────────────────────────────────
echo "==> Starting all services..."
docker compose -f "$DEPLOY_DIR/docker-compose.yml" up -d

echo ""
echo "==> Waiting for services to become healthy..."

# Wait up to 5 minutes for all services
TIMEOUT=300
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  UNHEALTHY=$(docker compose -f "$DEPLOY_DIR/docker-compose.yml" ps --format json 2>/dev/null | \
    grep -c '"starting\|"unhealthy"' 2>/dev/null || echo "0")

  if [ "$UNHEALTHY" = "0" ]; then
    break
  fi

  sleep 10
  ELAPSED=$((ELAPSED + 10))
  echo "    Waiting... (${ELAPSED}s / ${TIMEOUT}s)"
done

echo ""
docker compose -f "$DEPLOY_DIR/docker-compose.yml" ps
echo ""

# ── Step 8: Show instructions ──────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════╗"
echo "║   Setup Complete!                                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Open the setup wizard:"
echo "     → ${SITE_URL:-https://ycode.example.com}/ycode/welcome"
echo ""
echo "  2. Create your admin account in the wizard"
echo ""
echo "  3. Supabase Studio (LAN only):"
echo "     → http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'your-unraid-ip'):${KONG_HTTP_PORT:-3080}"
echo "     → Username: ${DASHBOARD_USERNAME:-supabase}"
echo "     → Password: (see DASHBOARD_PASSWORD in .env)"
echo ""
echo "  4. View logs:"
echo "     docker compose -f $DEPLOY_DIR/docker-compose.yml logs -f ycode"
echo ""
