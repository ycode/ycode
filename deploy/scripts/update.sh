#!/usr/bin/env bash
###############################################################################
# Ycode Self-Hosted — Update from Upstream
# Usage: bash scripts/update.sh
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$DEPLOY_DIR")"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

echo "╔══════════════════════════════════════════════════╗"
echo "║   Ycode Self-Hosted — Update                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

cd "$REPO_DIR"

# ── Step 1: Check for upstream changes ──────────────────────────────────────
echo "==> Checking for upstream changes..."

# Ensure upstream remote exists
if ! git remote get-url upstream &> /dev/null; then
  git remote add upstream https://github.com/ycode/ycode.git
fi

git fetch upstream

BEHIND=$(git rev-list HEAD..upstream/main --count)

if [ "$BEHIND" = "0" ]; then
  echo "    Already up to date with upstream."
  echo ""

  # Still check for Supabase image updates
  read -p "Check for Supabase Docker image updates? [y/N] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "==> Pulling latest Supabase images..."
    docker compose -f "$COMPOSE_FILE" pull
    docker compose -f "$COMPOSE_FILE" up -d
    echo "    Done."
  fi

  exit 0
fi

echo "    Found $BEHIND new commit(s) upstream."
echo ""

# ── Step 2: Show what's changed ────────────────────────────────────────────
echo "==> Upstream changes:"
git log HEAD..upstream/main --oneline
echo ""

# ── Step 3: Backup ─────────────────────────────────────────────────────────
echo "==> Creating backup before update..."
bash "$SCRIPT_DIR/backup.sh"
echo ""

# ── Step 4: Save current image tag ─────────────────────────────────────────
CURRENT_SHA=$(git rev-parse --short HEAD)
echo "    Current version: $CURRENT_SHA"

# Tag current image for rollback
docker tag ycode-ycode:latest "ycode:$CURRENT_SHA" 2>/dev/null || \
  docker tag ycode-ycode-migrate:latest "ycode-migrate:$CURRENT_SHA" 2>/dev/null || true

# ── Step 5: Merge upstream ─────────────────────────────────────────────────
echo "==> Merging upstream changes..."

if ! git merge upstream/main --no-edit; then
  echo ""
  echo "!!! MERGE CONFLICTS DETECTED !!!"
  echo ""
  echo "Conflicted files:"
  git diff --name-only --diff-filter=U
  echo ""
  echo "Options:"
  echo "  1. Resolve conflicts manually, then run: git add . && git commit"
  echo "  2. Abort the merge: git merge --abort"
  echo "  3. After resolving, re-run this script"
  echo ""
  echo "To rollback: bash scripts/rollback.sh"
  exit 1
fi

echo "    Merge successful."
echo ""

# ── Step 6: Rebuild Docker image ───────────────────────────────────────────
echo "==> Rebuilding ycode Docker images..."

set -a
source "$DEPLOY_DIR/.env"
set +a

NEW_SHA=$(git rev-parse --short HEAD)

docker compose -f "$COMPOSE_FILE" build ycode ycode-migrate

echo "    Build complete (version: $NEW_SHA)."
echo ""

# ── Step 7: Pull latest Supabase images ────────────────────────────────────
echo "==> Pulling latest Supabase images..."
docker compose -f "$COMPOSE_FILE" pull
echo ""

# ── Step 8: Restart services ──────────────────────────────────────────────
echo "==> Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "==> Waiting for services to stabilize..."
sleep 15

docker compose -f "$COMPOSE_FILE" ps
echo ""

# ── Step 9: Health check ───────────────────────────────────────────────────
YCODE_STATUS=$(docker inspect --format='{{.State.Health.Status}}' ycode-app 2>/dev/null || echo "unknown")

if [ "$YCODE_STATUS" = "healthy" ]; then
  echo "==> Update successful! Version: $NEW_SHA"
  echo ""
  echo "    To rollback if issues are found:"
  echo "    bash scripts/rollback.sh"
else
  echo "!!! WARNING: ycode-app health check status: $YCODE_STATUS"
  echo "    Check logs: docker compose -f $COMPOSE_FILE logs -f ycode"
  echo "    To rollback: bash scripts/rollback.sh"
fi

# ── Step 10: Cleanup old images ────────────────────────────────────────────
echo ""
echo "==> Cleaning up old Docker images..."
docker image prune -f
echo ""
echo "Done."
