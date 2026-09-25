#!/usr/bin/env bash
# kan-update: aktualisiert Kan aus dem eigenen Fork (github.com/FX1336/kan)
#
# Aufruf:  kan-update           nur wenn neue Commits vorliegen
#          kan-update --force   auch ohne neue Commits neu bauen
#
# Ablauf: Commits prüfen, DB sichern, laufenden Build sichern, Service stoppen,
# git pull, installieren, bauen, migrieren, Assets kopieren, starten, Healthcheck.
# Schlägt ein Schritt fehl, wird der vorherige Code- und Build-Stand wiederhergestellt
# und der Service neu gestartet.

set -Eeuo pipefail

APP_DIR=/opt/kan
SERVICE=kan
BRANCH=main
BACKUP_DIR=/var/backups/kan
KEEP_BACKUPS=5
LOG=/var/log/kan-update.log
HEALTH_URL=http://localhost:3000

STANDALONE="$APP_DIR/apps/web/.next/standalone"
STANDALONE_BAK="$BACKUP_DIR/standalone.prev"

export PATH="/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin:$PATH"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

mkdir -p "$BACKUP_DIR"
exec > >(tee -a "$LOG") 2>&1

exec 9>/run/kan-update.lock
flock -n 9 || { echo "Es läuft bereits ein Update."; exit 1; }

log() { echo "[$(date '+%F %T')] $*"; }

STAGE=prepare
OLD_COMMIT=""
DB_DUMP=""

rollback() {
  local rc=$?
  trap - ERR
  set +e
  log "FEHLER in Phase '$STAGE' (Exit-Code $rc). Stelle vorherigen Stand wieder her."
  cd "$APP_DIR"
  [[ -n "$OLD_COMMIT" ]] && git reset --hard "$OLD_COMMIT"
  if [[ -d "$STANDALONE_BAK" ]]; then
    rm -rf "$STANDALONE"
    mkdir -p "$(dirname "$STANDALONE")"
    cp -a "$STANDALONE_BAK" "$STANDALONE"
  fi
  systemctl start "$SERVICE"
  log "Alter Stand läuft wieder (Commit ${OLD_COMMIT:0:8})."
  case "$STAGE" in
    migrate|deploy|healthcheck)
      log "ACHTUNG: Die Migrationen könnten schon gelaufen sein."
      log "Falls die alte Version Probleme macht, DB aus dem Backup zurückspielen:"
      log "  systemctl stop $SERVICE"
      log "  gunzip -c $DB_DUMP | psql \"\$POSTGRES_URL\""
      ;;
  esac
  exit "$rc"
}

wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "$HEALTH_URL"; then
      return 0
    fi
    sleep 2
  done
  log "Healthcheck: $HEALTH_URL antwortet nach 60 Sekunden nicht."
  return 1
}

# ---------- Vorprüfungen ----------
command -v curl >/dev/null || { log "curl fehlt: apt install -y curl"; exit 1; }
cd "$APP_DIR"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  log "Lokale Änderungen in $APP_DIR gefunden. Bitte erst committen oder verwerfen:"
  git status --short --untracked-files=no
  exit 1
fi

log "Prüfe auf neue Commits in origin/$BRANCH ..."
git fetch origin "$BRANCH"
OLD_COMMIT=$(git rev-parse HEAD)
NEW_COMMIT=$(git rev-parse "origin/$BRANCH")

if [[ "$OLD_COMMIT" == "$NEW_COMMIT" && $FORCE -eq 0 ]]; then
  log "Keine neuen Commits. Nichts zu tun (mit --force trotzdem neu bauen)."
  exit 0
fi

log "Änderungen:"
git log --oneline "HEAD..origin/$BRANCH" || true

set -a; source "$APP_DIR/.env"; set +a

trap rollback ERR

# ---------- Sicherungen ----------
STAGE=backup
DB_DUMP="$BACKUP_DIR/kan_$(date '+%Y%m%d-%H%M%S').sql.gz"
log "Sichere Datenbank nach $DB_DUMP"
pg_dump "$POSTGRES_URL" | gzip > "$DB_DUMP"
ls -1t "$BACKUP_DIR"/kan_*.sql.gz | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --

log "Sichere aktuellen Build"
rm -rf "$STANDALONE_BAK"
[[ -d "$STANDALONE" ]] && cp -a "$STANDALONE" "$STANDALONE_BAK"

# ---------- Update ----------
STAGE=stop
log "Stoppe $SERVICE"
systemctl stop "$SERVICE"

STAGE=pull
log "Hole Code"
git merge --ff-only "origin/$BRANCH"

STAGE=install
log "Installiere Abhängigkeiten"
pnpm install --frozen-lockfile --prod=false

STAGE=build
log "Baue Web-App"
pnpm turbo run build --filter=@kan/web... --force

STAGE=migrate
log "Führe Migrationen aus"
pnpm db:migrate

STAGE=deploy
log "Kopiere statische Dateien"
cp -r apps/web/.next/static "$STANDALONE/apps/web/.next/"
cp -r apps/web/public "$STANDALONE/apps/web/"

log "Starte $SERVICE"
systemctl start "$SERVICE"

STAGE=healthcheck
wait_healthy

trap - ERR
log "Update erfolgreich: ${OLD_COMMIT:0:8} -> $(git rev-parse --short=8 HEAD)"
