#!/usr/bin/env bash
###############################################################################
# Generate all secrets for the Ycode self-hosted stack
# Usage: bash scripts/generate-secrets.sh
# This will create/update the .env file with generated secrets
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$DEPLOY_DIR/.env"

echo "==> Generating secrets for Ycode self-hosted stack..."

# Copy .env.example if .env doesn't exist
if [ ! -f "$ENV_FILE" ]; then
  cp "$DEPLOY_DIR/.env.example" "$ENV_FILE"
  echo "    Created .env from .env.example"
fi

# ── Helper functions ────────────────────────────────────────────────────────

generate_random_hex() {
  openssl rand -hex "$1"
}

generate_random_base64() {
  openssl rand -base64 "$1" | tr -d '\n'
}

# Replace a CHANGE_ME value in .env
set_env_value() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=CHANGE_ME" "$ENV_FILE" 2>/dev/null; then
    # Use | as delimiter since values may contain /
    sed -i.bak "s|^${key}=CHANGE_ME|${key}=${value}|" "$ENV_FILE"
    echo "    Generated: $key"
  fi
}

# ── Generate secrets ────────────────────────────────────────────────────────

POSTGRES_PASSWORD=$(generate_random_hex 20)
JWT_SECRET=$(generate_random_base64 48)
SECRET_KEY_BASE=$(generate_random_base64 48)
VAULT_ENC_KEY=$(generate_random_hex 16)
PG_META_CRYPTO_KEY=$(generate_random_base64 24)
DASHBOARD_PASSWORD=$(generate_random_base64 16)
PAGE_AUTH_SECRET=$(generate_random_hex 32)
POOLER_TENANT_ID=$(generate_random_hex 8)
LOGFLARE_PRIVATE=$(generate_random_hex 32)
LOGFLARE_PUBLIC=$(generate_random_hex 32)

# ── Generate JWT keys (ANON_KEY and SERVICE_ROLE_KEY) ───────────────────────

echo "    Generating JWT keys..."

# Check if node is available
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is required to generate JWT keys."
  echo "       Install Node.js 18+ and try again."
  exit 1
fi

# Generate ANON_KEY
ANON_KEY=$(node -e "
const crypto = require('crypto');
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const now = Math.floor(Date.now()/1000);
const payload = Buffer.from(JSON.stringify({
  role:'anon',
  iss:'supabase',
  iat:now,
  exp:now+157680000
})).toString('base64url');
const sig = crypto.createHmac('sha256','${JWT_SECRET}').update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
")

# Generate SERVICE_ROLE_KEY
SERVICE_ROLE_KEY=$(node -e "
const crypto = require('crypto');
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const now = Math.floor(Date.now()/1000);
const payload = Buffer.from(JSON.stringify({
  role:'service_role',
  iss:'supabase',
  iat:now,
  exp:now+157680000
})).toString('base64url');
const sig = crypto.createHmac('sha256','${JWT_SECRET}').update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
")

# ── Write all secrets to .env ───────────────────────────────────────────────

set_env_value "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
set_env_value "JWT_SECRET" "$JWT_SECRET"
set_env_value "SECRET_KEY_BASE" "$SECRET_KEY_BASE"
set_env_value "VAULT_ENC_KEY" "$VAULT_ENC_KEY"
set_env_value "PG_META_CRYPTO_KEY" "$PG_META_CRYPTO_KEY"
set_env_value "ANON_KEY" "$ANON_KEY"
set_env_value "SERVICE_ROLE_KEY" "$SERVICE_ROLE_KEY"
set_env_value "DASHBOARD_PASSWORD" "$DASHBOARD_PASSWORD"
set_env_value "PAGE_AUTH_SECRET" "$PAGE_AUTH_SECRET"
set_env_value "POOLER_TENANT_ID" "$POOLER_TENANT_ID"
set_env_value "LOGFLARE_PRIVATE_ACCESS_TOKEN" "$LOGFLARE_PRIVATE"
set_env_value "LOGFLARE_PUBLIC_ACCESS_TOKEN" "$LOGFLARE_PUBLIC"

# Clean up sed backup files
rm -f "$ENV_FILE.bak"

echo ""
echo "==> Secrets generated successfully!"
echo ""
echo "IMPORTANT: Now update these values in $ENV_FILE:"
echo "  - SITE_URL (your ycode domain, e.g., https://ycode.example.com)"
echo "  - API_EXTERNAL_URL (your Supabase API domain, e.g., https://supa.example.com)"
echo "  - SUPABASE_PUBLIC_URL (same as API_EXTERNAL_URL)"
echo "  - SELF_HOSTED_SUPABASE_HOSTNAME (e.g., supa.example.com)"
echo "  - CLOUDFLARE_TUNNEL_TOKEN (from Cloudflare Zero Trust dashboard)"
echo ""
