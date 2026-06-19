#!/usr/bin/env bash
set -euo pipefail

# Triggers project-hub-api to generate (or skip, if one is already active)
# an automatic training challenge for a fictional Osmá liga club.
# See docs/ops/training-challenge-cron.md for setup instructions.

API_URL="${TRAINING_CHALLENGE_API_URL:-https://api.osmaliga.cz/internal/training-challenges/generate}"
ENV_FILE="${TRAINING_CHALLENGE_ENV_FILE:-/opt/project-hub-api/.env}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

if [ -z "${TRAINING_CRON_SECRET:-}" ]; then
  echo "CHYBA: TRAINING_CRON_SECRET není nastavený (zkontroluj ${ENV_FILE})" >&2
  exit 1
fi

curl -fsS -X POST "$API_URL" \
  -H "Authorization: Bearer ${TRAINING_CRON_SECRET}"
