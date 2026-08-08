#!/usr/bin/env bash
# Online, consistent SQLite snapshot (safe while the server runs — uses WAL).
# Usage:
#   ./scripts/backup-sqlite.sh [db_path] [backup_dir]
# Docker:
#   docker compose exec orienta sqlite3 /app/data/passengers.db \
#     ".backup '/app/data/passengers-$(date +%F).db'"
set -euo pipefail

DB_PATH="${1:-./apps/dashboard/data/passengers.db}"
BACKUP_DIR="${2:-./backups}"
STAMP="$(date +%F-%H%M%S)"
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/passengers-${STAMP}.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 CLI not found. Install it, or inside Docker:" >&2
  echo "  docker compose exec orienta sqlite3 /app/data/passengers.db \".backup '/app/data/passengers-\$(date +%F).db'\"" >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "database not found: $DB_PATH" >&2
  exit 1
fi

sqlite3 "$DB_PATH" ".backup '$OUT'"
echo "wrote $OUT"
