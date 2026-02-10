#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = process.env.WHOOP_TOKEN_FILE || '/home/openclaw/.openclaw/credentials/whoop/tokens.json';
const CLIENT_ID = process.env.WHOOP_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || '';
const BASE_URL = process.env.WHOOP_BASE_URL || 'https://api.prod.whoop.com/developer/';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const CLOCK_SKEW_MS = 60 * 1000;

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, filePath);
}

function normalizeTokens(tokens) {
  const now = Date.now();
  if (!tokens.updated_at) {
    tokens.updated_at = now;
  }
  if (tokens.expires_in && !tokens.expires_at) {
    tokens.expires_at = tokens.updated_at + tokens.expires_in * 1000;
  }
  return tokens;
}

async function refreshTokens(tokens) {
  if (!tokens.refresh_token) {
    return tokens;
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return tokens;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
  });

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('Token refresh failed: ' + text);
  }

  const updated = await resp.json();
  updated.refresh_token = updated.refresh_token || tokens.refresh_token;
  updated.updated_at = Date.now();
  if (updated.expires_in) {
    updated.expires_at = updated.updated_at + updated.expires_in * 1000;
  }

  writeJson(TOKEN_FILE, updated);
  return updated;
}

async function getAccessToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    die('Token file not found: ' + TOKEN_FILE);
  }

  let tokens = normalizeTokens(readJson(TOKEN_FILE));

  if (tokens.expires_at && Date.now() < tokens.expires_at - CLOCK_SKEW_MS) {
    return tokens.access_token;
  }

  if (tokens.refresh_token && CLIENT_ID && CLIENT_SECRET) {
    tokens = await refreshTokens(tokens);
    return tokens.access_token;
  }

  return tokens.access_token;
}

async function apiGet(endpointPath, query) {
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const cleanPath = endpointPath.replace(/^\/+/, '');
  const url = new URL(cleanPath, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const token = await getAccessToken();
  const resp = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + token },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error('API error ' + resp.status + ': ' + text);
  }

  try {
    const json = JSON.parse(text);
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
  } catch {
    process.stdout.write(text + '\n');
  }
}

async function apiFetch(endpointPath, query) {
  const base = BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`;
  const cleanPath = endpointPath.replace(/^\/+/, '');
  const url = new URL(cleanPath, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const token = await getAccessToken();
  const resp = await fetch(url.toString(), {
    headers: { Authorization: 'Bearer ' + token },
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error('API error ' + resp.status + ': ' + text);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Unexpected non-JSON response');
  }
}

function parseKeyValueArgs(args) {
  const out = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    const val = arg.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function parseOffsetMinutes(offset) {
  if (!offset || typeof offset !== 'string') return 0;
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = Number(m[2]);
  const mins = Number(m[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return 0;
  return sign * (hours * 60 + mins);
}

function formatLocalTime(isoUtc, offset) {
  if (!isoUtc) return null;
  const ms = Date.parse(isoUtc);
  if (Number.isNaN(ms)) return null;
  const offsetMinutes = parseOffsetMinutes(offset);
  const local = new Date(ms + offsetMinutes * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm} (UTC${offset || '+00:00'})`;
}

function humanDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    die('Usage: whoop.js <command> [args]');
  }

  const cmd = args[0];
  const sub = args[1];

  if (cmd === 'profile') {
    await apiGet('/v2/user/profile/basic');
    return;
  }

  if (cmd === 'measurements') {
    await apiGet('/v2/user/measurement');
    return;
  }

  if (cmd === 'sleep' && sub === 'latest') {
    if (args[2] === 'formatted' || args[2] === 'local') {
      const payload = await apiFetch('/v2/activity/sleep', { limit: '1' });
      const record = payload.records && payload.records[0];
      if (!record) {
        die('No sleep records found.');
      }
      const offset = record.timezone_offset || '+00:00';
      const startLocal = formatLocalTime(record.start, offset);
      const endLocal = formatLocalTime(record.end, offset);
      const durationMs = record.end && record.start ? Date.parse(record.end) - Date.parse(record.start) : null;
      const out = {
        id: record.id,
        timezone_offset: offset,
        start_utc: record.start,
        end_utc: record.end,
        start_local: startLocal,
        end_local: endLocal,
        duration_ms: durationMs,
        duration_human: humanDurationMs(durationMs),
        score_state: record.score_state,
        score: record.score,
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    await apiGet('/v2/activity/sleep', { limit: '1' });
    return;
  }

  if (cmd === 'workout' && sub === 'latest') {
    await apiGet('/v2/activity/workout', { limit: '1' });
    return;
  }

  if (cmd === 'recovery' && sub === 'latest') {
    await apiGet('/v2/recovery', { limit: '1' });
    return;
  }

  if (cmd === 'cycle' && sub === 'latest') {
    await apiGet('/v2/cycle', { limit: '1' });
    return;
  }

  if (cmd === 'api') {
    const endpointPath = args[1];
    if (!endpointPath) {
      die('Usage: whoop.js api /v2/... [key=value ...]');
    }
    const query = parseKeyValueArgs(args.slice(2));
    await apiGet(endpointPath, query);
    return;
  }

  die('Unknown command. Try: profile | measurements | sleep latest | workout latest | recovery latest | cycle latest | api /v2/...');
}

main().catch((err) => {
  die(err.message || String(err));
});
