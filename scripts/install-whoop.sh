#!/usr/bin/env bash
set -euo pipefail

log() { printf "\n==> %s\n" "$*"; }
warn() { printf "\n[warn] %s\n" "$*"; }
die() { printf "\n[error] %s\n" "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
ENV_FILE="${STATE_DIR}/.env"

need_cmd jq
need_cmd node

if [[ ! -d "$STATE_DIR" ]]; then
  die "openclaw state dir not found: $STATE_DIR (run openclaw once first)"
fi

OPENCLAW_JSON="${STATE_DIR}/openclaw.json"
if [[ ! -f "$OPENCLAW_JSON" ]]; then
  die "openclaw config missing: $OPENCLAW_JSON"
fi

prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local default_value="${3:-}"
  local current_value="${!var_name:-}"
  if [[ -n "$current_value" ]]; then
    return 0
  fi
  local input_fd="/dev/tty"
  if [[ ! -t 0 ]]; then
    if [[ ! -r "$input_fd" ]]; then
      die "no TTY available for prompts; set $var_name in env and re-run"
    fi
  else
    input_fd="/dev/stdin"
  fi
  if [[ -n "$default_value" ]]; then
    read -r -p "${prompt_text} [${default_value}]: " current_value < "$input_fd"
    current_value="${current_value:-$default_value}"
  else
    read -r -p "${prompt_text}: " current_value < "$input_fd"
  fi
  if [[ -z "$current_value" ]]; then
    die "missing required value: $var_name"
  fi
  printf -v "$var_name" "%s" "$current_value"
}

read_tty() {
  local prompt_text="$1"
  local var_name="$2"
  local default_value="${3:-}"
  local input_fd="/dev/tty"
  if [[ ! -t 0 ]]; then
    if [[ ! -r "$input_fd" ]]; then
      die "no TTY available for prompts; set $var_name in env and re-run"
    fi
  else
    input_fd="/dev/stdin"
  fi
  local value=""
  if [[ -n "$default_value" ]]; then
    read -r -p "${prompt_text} [${default_value}]: " value < "$input_fd"
    value="${value:-$default_value}"
  else
    read -r -p "${prompt_text}: " value < "$input_fd"
  fi
  printf -v "$var_name" "%s" "$value"
}

is_placeholder() {
  [[ "$1" =~ ^\\$\\{[A-Z0-9_]+\\}$ ]]
}

ensure_env_kv() {
  local key="$1"
  local value="$2"
  mkdir -p "$STATE_DIR"
  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE"; then
    local tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "$ENV_FILE" > "$tmp"
    printf "%s=%s\n" "$key" "$value" >> "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf "%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

gen_state() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16
  else
    date +%s%N | sha256sum | cut -c1-32
  fi
}

log "collecting configuration"

prompt WHOOP_CLIENT_ID "WHOOP client id"
prompt WHOOP_CLIENT_SECRET "WHOOP client secret"
prompt WHOOP_PUBLIC_HOSTNAME "public hostname for WHOOP relay (e.g. whoop.example.com)"

WHOOP_OAUTH_STATE="${WHOOP_OAUTH_STATE:-$(gen_state)}"
OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-http://127.0.0.1:18789}"

HOOK_TOKEN_FROM_CFG="$(jq -r '.hooks.token // ""' "$OPENCLAW_JSON")"
if [[ -n "${OPENCLAW_HOOK_TOKEN:-}" ]]; then
  OPENCLAW_HOOK_TOKEN="${OPENCLAW_HOOK_TOKEN}"
elif [[ -n "$HOOK_TOKEN_FROM_CFG" && ! "$(is_placeholder "$HOOK_TOKEN_FROM_CFG" && echo yes)" ]]; then
  OPENCLAW_HOOK_TOKEN="$HOOK_TOKEN_FROM_CFG"
else
  OPENCLAW_HOOK_TOKEN="$(gen_state)"
fi

log "installing whoop skill + relay files"

mkdir -p "${STATE_DIR}/skills" "${STATE_DIR}/whoop-relay"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${REPO_DIR}/skills/whoop/" "${STATE_DIR}/skills/whoop/"
  rsync -a "${REPO_DIR}/whoop-relay/" "${STATE_DIR}/whoop-relay/"
else
  cp -a "${REPO_DIR}/skills/whoop/." "${STATE_DIR}/skills/whoop/"
  cp -a "${REPO_DIR}/whoop-relay/." "${STATE_DIR}/whoop-relay/"
fi

log "updating openclaw.json (whoop skill + tokens)"

tmp="$(mktemp)"
jq --arg token_file "${STATE_DIR}/credentials/whoop/tokens.json" \
  '.skills.entries.whoop.enabled = true
   | .skills.entries.whoop.env.WHOOP_TOKEN_FILE = $token_file
   | .skills.entries.whoop.env.WHOOP_CLIENT_ID = "${WHOOP_CLIENT_ID}"
   | .skills.entries.whoop.env.WHOOP_CLIENT_SECRET = "${WHOOP_CLIENT_SECRET}"
   | .skills.entries.whoop.env.WHOOP_BASE_URL = "https://api.prod.whoop.com/developer"
   | .hooks.token = "${OPENCLAW_HOOK_TOKEN}"' \
  "$OPENCLAW_JSON" > "$tmp"
mv "$tmp" "$OPENCLAW_JSON"

log "writing openclaw env file (for substitution)"

ensure_env_kv "WHOOP_CLIENT_ID" "$WHOOP_CLIENT_ID"
ensure_env_kv "WHOOP_CLIENT_SECRET" "$WHOOP_CLIENT_SECRET"
ensure_env_kv "OPENCLAW_HOOK_TOKEN" "$OPENCLAW_HOOK_TOKEN"

log "writing whoop relay env file"

sudo tee /etc/whoop-relay.env > /dev/null <<EOF
WHOOP_CLIENT_ID=${WHOOP_CLIENT_ID}
WHOOP_CLIENT_SECRET=${WHOOP_CLIENT_SECRET}
WHOOP_REDIRECT_URI=https://${WHOOP_PUBLIC_HOSTNAME}/oauth/callback
WHOOP_OAUTH_STATE=${WHOOP_OAUTH_STATE}
WHOOP_TOKEN_FILE=${STATE_DIR}/credentials/whoop/tokens.json
WHOOP_LAST_SLEEP_FILE=${STATE_DIR}/credentials/whoop/last_sleep_id

WHOOP_BRIEF_ON_SLEEP=1
WHOOP_NOTIFY_ALL=0

WHOOP_BRIEF_PROMPT=Generate my WHOOP morning brief. Do NOT call a tool named "whoop". Use exec_command to run ${STATE_DIR}/skills/whoop/scripts/whoop.js to fetch: latest sleep (use sleep latest formatted for local time), latest recovery, latest cycle, and last 7 sleeps/recoveries/workouts (use api limit=7). Include: sleep duration + stages, efficiency, recovery score + HRV + RHR, 7-day averages vs today, and 3 short actionable tips.

OPENCLAW_BASE_URL=${OPENCLAW_BASE_URL}
OPENCLAW_HOOK_TOKEN=${OPENCLAW_HOOK_TOKEN}
LISTEN_HOST=127.0.0.1
LISTEN_PORT=8787
EOF

sudo chown root:openclaw /etc/whoop-relay.env
sudo chmod 640 /etc/whoop-relay.env

log "installing systemd service"

sudo cp "${REPO_DIR}/whoop-relay/whoop-relay.service" /etc/systemd/system/whoop-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now whoop-relay

if [[ "${WHOOP_SKIP_TUNNEL:-}" == "1" ]]; then
  DO_TUNNEL="N"
else
  log "cloudflared tunnel (optional)"
  read_tty "configure cloudflared tunnel now? [y/N]" DO_TUNNEL "N"
fi

if [[ "$DO_TUNNEL" =~ ^[Yy]$ ]]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    warn "cloudflared not found. install it first, then re-run the tunnel section."
  else
    read_tty "existing tunnel UUID (leave blank to create new)" TUNNEL_UUID ""
    if [[ -z "$TUNNEL_UUID" ]]; then
      read_tty "tunnel name" TUNNEL_NAME "whoop-relay"
      cloudflared tunnel login
      CREATE_OUT="$(cloudflared tunnel create "$TUNNEL_NAME")"
      TUNNEL_UUID="$(printf "%s" "$CREATE_OUT" | grep -oE '[0-9a-fA-F-]{36}' | head -n1)"
      if [[ -z "$TUNNEL_UUID" ]]; then
        warn "could not parse tunnel UUID. set it manually in /etc/cloudflared/config.yml"
      fi
      cloudflared tunnel route dns "$TUNNEL_NAME" "$WHOOP_PUBLIC_HOSTNAME"
    fi

    sudo mkdir -p /etc/cloudflared
    sudo tee /etc/cloudflared/config.yml > /dev/null <<EOF
tunnel: ${TUNNEL_UUID}
credentials-file: /root/.cloudflared/${TUNNEL_UUID}.json

ingress:
  - hostname: ${WHOOP_PUBLIC_HOSTNAME}
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF

    sudo cloudflared service install || true
    sudo systemctl enable --now cloudflared
  fi
fi

log "next steps"
cat <<EOF
1) authorize WHOOP (open in browser):
https://api.prod.whoop.com/oauth/oauth2/auth?response_type=code&client_id=${WHOOP_CLIENT_ID}&redirect_uri=https%3A%2F%2F${WHOOP_PUBLIC_HOSTNAME}%2Foauth%2Fcallback&scope=sleep%20recovery%20cycle%20workout&state=${WHOOP_OAUTH_STATE}

2) run your gateway (if not already running):
openclaw gateway run

3) check relay health:
curl -s https://${WHOOP_PUBLIC_HOSTNAME}/health
EOF
