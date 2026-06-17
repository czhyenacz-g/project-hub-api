#!/usr/bin/env bash
set -euo pipefail

# ── Konfigurace ───────────────────────────────────────────────────────────────
POSTGRES_CONTAINER="project-hub-postgres"
POSTGRES_USER="project_hub_user"
POSTGRES_DB="project_hub"
BACKUP_DIR="/opt/backups/project-hub/daily"
LOG_FILE="/opt/backups/project-hub/logs/backup.log"
RETENTION_DAYS=14

# ── Helpers ───────────────────────────────────────────────────────────────────
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# ── Inicializace ──────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log "START backup: ${POSTGRES_DB} z kontejneru ${POSTGRES_CONTAINER}"

# ── Ověř, že container běží ───────────────────────────────────────────────────
if ! docker inspect --format '{{.State.Running}}' "$POSTGRES_CONTAINER" 2>/dev/null | grep -q '^true$'; then
  log "CHYBA: container ${POSTGRES_CONTAINER} neběží nebo neexistuje"
  exit 1
fi

# ── pg_dump → gzip ───────────────────────────────────────────────────────────
TIMESTAMP=$(date '+%Y-%m-%d-%H%M%S')
BACKUP_FILE="${BACKUP_DIR}/project-hub-${TIMESTAMP}.sql.gz"

docker exec "$POSTGRES_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_FILE"

# Ověř, že soubor existuje a není prázdný
if [ ! -s "$BACKUP_FILE" ]; then
  log "CHYBA: backup soubor je prázdný nebo chybí: ${BACKUP_FILE}"
  exit 1
fi

FILE_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "OK: ${BACKUP_FILE} (${FILE_SIZE})"

# ── Rotace: smaž zálohy starší než RETENTION_DAYS ────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "project-hub-*.sql.gz" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  log "Rotace: smazáno ${DELETED} souborů starších než ${RETENTION_DAYS} dní"
fi

log "HOTOVO"
