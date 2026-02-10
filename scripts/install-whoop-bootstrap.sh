#!/usr/bin/env bash
set -euo pipefail

log() { printf "\n==> %s\n" "$*"; }
die() { printf "\n[error] %s\n" "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

REPO_URL_DEFAULT="https://github.com/soumyyy/openclaw-config.git"
REPO_URL="${OPENCLAW_WHOOP_REPO:-$REPO_URL_DEFAULT}"

need_cmd git
need_cmd bash

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

log "cloning whoop skill (sparse checkout)"
git clone --filter=blob:none --no-checkout "$REPO_URL" "$WORKDIR/openclaw-config"
cd "$WORKDIR/openclaw-config"
git sparse-checkout init --cone
git sparse-checkout set whoop-relay skills/whoop scripts
git checkout

log "running installer"
bash scripts/install-whoop.sh
