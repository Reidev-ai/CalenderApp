#!/bin/sh
set -eu
umask 077

ENV_FILE="${1:-./production.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

mkdir -p "$CALENDAR_DATA_DIR"
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$CALENDAR_BACKUP_DIR"

exec node --experimental-strip-types src/Data/Server/server.ts
