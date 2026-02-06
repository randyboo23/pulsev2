#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env in repo root."
  exit 1
fi

set -a
source .env
set +a

BASE_URL="${QA_BASE_URL:-http://localhost:3000}"
INGEST_URL="${BASE_URL%/}/api/ingest"

AUTH_HEADER_NAME=""
AUTH_HEADER_VALUE=""
if [[ -n "${INGEST_SECRET:-}" ]]; then
  AUTH_HEADER_NAME="x-ingest-secret"
  AUTH_HEADER_VALUE="$INGEST_SECRET"
elif [[ -n "${CRON_SECRET:-}" ]]; then
  AUTH_HEADER_NAME="Authorization"
  AUTH_HEADER_VALUE="Bearer $CRON_SECRET"
else
  echo "Set INGEST_SECRET (or CRON_SECRET) in .env before running qa:summaries."
  exit 1
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

echo "Triggering ingest at $INGEST_URL"
HTTP_CODE="$(
  curl -sS \
    -o "$TMP_FILE" \
    -w "%{http_code}" \
    -X POST "$INGEST_URL" \
    -H "$AUTH_HEADER_NAME: $AUTH_HEADER_VALUE"
)"

if [[ "$HTTP_CODE" -lt 200 || "$HTTP_CODE" -ge 300 ]]; then
  echo "Ingest failed with HTTP $HTTP_CODE"
  cat "$TMP_FILE"
  exit 1
fi

echo "Ingest response (HTTP $HTTP_CODE):"
node -e 'const fs=require("fs"); const raw=fs.readFileSync(process.argv[1], "utf8").trim(); try { console.log(JSON.stringify(JSON.parse(raw), null, 2)); } catch { console.log(raw); }' "$TMP_FILE"
echo
echo "Summary quality report:"
node scripts/summary_quality_report.mjs
