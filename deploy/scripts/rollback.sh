#!/usr/bin/env bash
###############################################################################
# Ycode Self-Hosted — Rollback to a previous backup
# Usage: bash scripts/rollback.sh [TIMESTAMP]
#        bash scripts/rollback.sh              # uses most recent backup
#        bash scripts/rollback.sh 2026-02-25-1430
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
BACKUPS_DIR="$DEPLOY_DIR/backups"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"

# ── Determine which backup to restore ──────────────────────────────────────
if [ -n "${1:-}" ]; then
  BACKUP_DIR="$BACKUPS_DIR/$1"
else
  BACKUP_DIR=$(ls -dt "$BACKUPS_DIR"/*/ 2>/dev/null | head -1)
fi

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup not found: $BACKUP_DIR"
  echo ""
  echo "Available backups:"
  ls -1 "$BACKUPS_DIR" 2>/dev/null || echo "  (none)"
  exit 1
fi

TIMESTAMP=$(basename "$BACKUP_DIR")

echo "╔══════════════════════════════════════════════════╗"
echo "║   Ycode Self-Hosted — Rollback                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Restoring from backup: $TIMESTAMP"
echo ""

# ── Confirm ─────────────────────────────────────────────────────────────────
echo "This will:"
echo "  1. Stop the ycode app"
echo "  2. Restore the database from $TIMESTAMP"
echo "  3. Restore storage files from $TIMESTAMP"
echo "  4. Restart the app"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# ── Step 1: Stop ycode ─────────────────────────────────────────────────────
echo ""
echo "==> Stopping ycode..."
docker compose -f "$COMPOSE_FILE" stop ycode ycode-migrate

# ── Step 2: Restore database ──────────────────────────────────────────────
if [ -f "$BACKUP_DIR/db.sql" ]; then
  echo "==> Restoring database..."

  # Drop and recreate all ycode tables (keeps Supabase system tables)
  docker exec -i supabase-db psql -U supabase_admin postgres < "$BACKUP_DIR/db.sql" 2>/dev/null

  echo "    Database restored."
else
  echo "    WARNING: No database backup found, skipping."
fi

# ── Step 3: Restore storage ──────────────────────────────────────────────
if [ -f "$BACKUP_DIR/storage.tar.gz" ]; then
  echo "==> Restoring storage files..."

  # Remove current storage and restore from backup
  rm -rf "$DEPLOY_DIR/volumes/storage"
  tar xzf "$BACKUP_DIR/storage.tar.gz" -C "$DEPLOY_DIR/volumes/"

  echo "    Storage restored."
else
  echo "    WARNING: No storage backup found, skipping."
fi

# ── Step 4: Restore git version (optional) ────────────────────────────────
if [ -f "$BACKUP_DIR/git-sha.txt" ]; then
  BACKUP_SHA=$(cat "$BACKUP_DIR/git-sha.txt")
  REPO_DIR="$(dirname "$DEPLOY_DIR")"

  echo ""
  echo "    Backup was from git commit: $BACKUP_SHA"
  echo "    Current commit: $(git -C "$REPO_DIR" rev-parse HEAD | head -c 8)"
  echo ""
  read -p "    Checkout the backup commit and rebuild? [y/N] " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git -C "$REPO_DIR" checkout "$BACKUP_SHA"
    echo "==> Rebuilding Docker images..."
    set -a
    source "$DEPLOY_DIR/.env"
    set +a
    docker compose -f "$COMPOSE_FILE" build ycode ycode-migrate
  fi
fi

# ── Step 5: Restart ────────────────────────────────────────────────────────
echo "==> Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "==> Waiting for services to stabilize..."
sleep 15

docker compose -f "$COMPOSE_FILE" ps
echo ""
echo "==> Rollback complete."
