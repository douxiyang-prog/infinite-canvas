#!/usr/bin/env bash

set -Eeuo pipefail

DB_NAME="${DB_NAME:-infinite_canvas}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backup}"
MYSQL_DEFAULTS_FILE="${MYSQL_DEFAULTS_FILE:-/opt/backup/.my.cnf}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
LOG_FILE="${BACKUP_LOG_FILE:-${BACKUP_DIR}/backup_${DB_NAME}.log}"
DATE="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE}.sql.gz"

umask 077

log() {
  local message="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  printf '%s\n' "$message"
  printf '%s\n' "$message" >> "$LOG_FILE"
}

if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  printf 'Invalid database name: %s\n' "$DB_NAME" >&2
  exit 1
fi

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  printf 'Invalid backup retention days: %s\n' "$RETENTION_DAYS" >&2
  exit 1
fi

for command_name in mysqldump gzip sha256sum find; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
done

mkdir -p "$BACKUP_DIR"

if [[ ! -r "$MYSQL_DEFAULTS_FILE" ]]; then
  printf 'MySQL defaults file is not readable: %s\n' "$MYSQL_DEFAULTS_FILE" >&2
  exit 1
fi

tmp_sql="$(mktemp "${BACKUP_DIR}/${DB_NAME}_${DATE}.XXXXXX.sql")"
tmp_gz="${tmp_sql}.gz"

cleanup() {
  rm -f -- "$tmp_sql" "$tmp_gz"
}
trap cleanup EXIT

log "Starting backup: ${DB_NAME}"

if ! mysqldump \
  --defaults-file="$MYSQL_DEFAULTS_FILE" \
  --single-transaction \
  --quick \
  --lock-tables=false \
  --no-tablespaces \
  --default-character-set=utf8mb4 \
  --hex-blob \
  --triggers \
  --databases "$DB_NAME" > "$tmp_sql"; then
  log "Backup failed: ${DB_NAME}"
  exit 1
fi

if [[ ! -s "$tmp_sql" ]]; then
  log "Backup failed: mysqldump produced an empty file"
  exit 1
fi

gzip -c "$tmp_sql" > "$tmp_gz"

if ! gzip -t "$tmp_gz"; then
  log "Backup failed: gzip integrity check failed"
  exit 1
fi

mv -f -- "$tmp_gz" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"

log "Backup completed: ${BACKUP_FILE}"

while IFS= read -r -d '' old_backup; do
  rm -f -- "$old_backup" "${old_backup}.sha256"
  log "Removed expired backup: ${old_backup}"
done < <(
  find "$BACKUP_DIR" \
    -maxdepth 1 \
    -type f \
    -name "${DB_NAME}_*.sql.gz" \
    -mtime +"$RETENTION_DAYS" \
    -print0
)
