#!/usr/bin/env bash
###############################################################################
# Ycode Self-Hosted — Backup Database + Storage
# Usage: bash scripts/backup.sh
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
BACKUPS_DIR="$DEPLOY_DIR/backups"
TIMESTAMP=$(date +%Y-%m-%d-%H%M)
BACKUP_DIR="$BACKUPS_DIR/$TIMESTAMP"

echo "==> Creating backup: $TIMESTAMP"

mkdir -p "$BACKUP_DIR"

# ── Backup PostgreSQL ───────────────────────────────────────────────────────
echo "    Dumping PostgreSQL database..."

if docker exec supabase-db pg_dump -U supabase_admin postgres > "$BACKUP_DIR/db.sql" 2>/dev/null; then
  echo "    Database backup: $(du -h "$BACKUP_DIR/db.sql" | cut -f1)"
else
  echo "    WARNING: Database dump failed (container may not be running)"
fi

# ── Backup Storage files ────────────────────────────────────────────────────
echo "    Archiving storage files..."

if [ -d "$DEPLOY_DIR/volumes/storage" ]; then
  tar czf "$BACKUP_DIR/storage.tar.gz" -C "$DEPLOY_DIR/volumes" storage 2>/dev/null
  echo "    Storage backup: $(du -h "$BACKUP_DIR/storage.tar.gz" | cut -f1)"
else
  echo "    WARNING: No storage directory found"
fi

# ── Backup .env ─────────────────────────────────────────────────────────────
if [ -f "$DEPLOY_DIR/.env" ]; then
  cp "$DEPLOY_DIR/.env" "$BACKUP_DIR/env.bak"
  echo "    .env backed up"
fi

# ── Save git version ───────────────────────────────────────────────────────
REPO_DIR="$(dirname "$DEPLOY_DIR")"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" rev-parse HEAD > "$BACKUP_DIR/git-sha.txt"
  echo "    Git SHA saved: $(cat "$BACKUP_DIR/git-sha.txt" | head -c 8)"
fi

# ── Cleanup old backups (keep last 7) ──────────────────────────────────────
BACKUP_COUNT=$(ls -d "$BACKUPS_DIR"/*/ 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 7 ]; then
  REMOVE_COUNT=$((BACKUP_COUNT - 7))
  echo "    Removing $REMOVE_COUNT old backup(s)..."
  ls -dt "$BACKUPS_DIR"/*/ | tail -n "$REMOVE_COUNT" | xargs rm -rf
fi

echo ""
echo "==> Backup complete: $BACKUP_DIR"
