#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { URL } = require('url');

const WHOOP_CLIENT_ID = process.env.WHOOP_CLIENT_ID || '';
const WHOOP_CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET || '';
const WHOOP_REDIRECT_URI = process.env.WHOOP_REDIRECT_URI || '';
const WHOOP_OAUTH_STATE = process.env.WHOOP_OAUTH_STATE || '';
const WHOOP_TOKEN_FILE = process.env.WHOOP_TOKEN_FILE || '';
const WHOOP_LAST_SLEEP_FILE = process.env.WHOOP_LAST_SLEEP_FILE || '/home/openclaw/.openclaw/credentials/whoop/last_sleep_id';
const WHOOP_BRIEF_ON_SLEEP = (process.env.WHOOP_BRIEF_ON_SLEEP || '1') === '1';
const WHOOP_NOTIFY_ALL = (process.env.WHOOP_NOTIFY_ALL || '0') === '1';
const WHOOP_BRIEF_PROMPT = process.env.WHOOP_BRIEF_PROMPT || [
  'Generate my WHOOP morning brief.',
  'Use the WHOOP skill to fetch: latest sleep, latest recovery, latest cycle,',
  'and last 7 sleeps/recoveries/workouts for trendlines (use api limit=7).',
  'Include: sleep duration + stages, efficiency, recovery score + HRV + RHR,',
  '7-day averages vs today, and 3 short actionable tips for today.',
].join(' ');

const OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:18789';
const OPENCLAW_HOOK_TOKEN = process.env.OPENCLAW_HOOK_TOKEN || '';
const OPENCLAW_DELIVER_CHANNEL = process.env.OPENCLAW_DELIVER_CHANNEL || '';
const OPENCLAW_DELIVER_TO = process.env.OPENCLAW_DELIVER_TO || '';

const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.LISTEN_PORT || '8787');

const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';

function jsonResponse(res, code, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(ts, sig, body) {
  if (!ts || !sig || !WHOOP_CLIENT_SECRET) return false;
  const hmac = crypto.createHmac('sha256', WHOOP_CLIENT_SECRET);
  hmac.update(ts + body.toString('utf8'));
  const digest = hmac.digest('base64');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(sig));
}

async function exchangeCodeForTokens(code) {
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET || !WHOOP_REDIRECT_URI) {
    throw new Error('Missing WHOOP OAuth config');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: WHOOP_CLIENT_ID,
    client_secret: WHOOP_CLIENT_SECRET,
    redirect_uri: WHOOP_REDIRECT_URI,
    code,
  });

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error('Token exchange failed: ' + text);
  }

  const tokens = JSON.parse(text);
  tokens.updated_at = Date.now();
  if (tokens.expires_in && !tokens.expires_at) {
    tokens.expires_at = tokens.updated_at + tokens.expires_in * 1000;
  }
  return tokens;
}

function writeTokens(tokens) {
  if (!WHOOP_TOKEN_FILE) {
    throw new Error('WHOOP_TOKEN_FILE not set');
  }
  const tmp = WHOOP_TOKEN_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, WHOOP_TOKEN_FILE);
}

async function forwardToOpenClaw(message) {
  if (!OPENCLAW_HOOK_TOKEN) {
    throw new Error('OPENCLAW_HOOK_TOKEN not set');
  }
  const payload = {
    message,
    name: 'WHOOP',
    wakeMode: 'now',
    deliver: true,
  };
  if (OPENCLAW_DELIVER_CHANNEL) {
    payload.channel = OPENCLAW_DELIVER_CHANNEL;
  }
  if (OPENCLAW_DELIVER_TO) {
    payload.to = OPENCLAW_DELIVER_TO;
  }
  const resp = await fetch(`${OPENCLAW_BASE_URL}/hooks/agent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENCLAW_HOOK_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenClaw hook failed: ${resp.status} ${text}`);
  }
}

function parseQuery(urlObj) {
  const out = {};
  for (const [key, value] of urlObj.searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

function readLastSleepId() {
  try {
    return fs.readFileSync(WHOOP_LAST_SLEEP_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function writeLastSleepId(id) {
  if (!id) return;
  const dir = require('path').dirname(WHOOP_LAST_SLEEP_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WHOOP_LAST_SLEEP_FILE, `${id}\n`, { mode: 0o600 });
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && urlObj.pathname === '/health') {
      jsonResponse(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/oauth/callback') {
      const query = parseQuery(urlObj);
      if (query.error) {
        jsonResponse(res, 400, { ok: false, error: query.error });
        return;
      }
      if (WHOOP_OAUTH_STATE && query.state !== WHOOP_OAUTH_STATE) {
        jsonResponse(res, 400, { ok: false, error: 'bad_state' });
        return;
      }
      if (!query.code) {
        jsonResponse(res, 400, { ok: false, error: 'missing_code' });
        return;
      }
      const tokens = await exchangeCodeForTokens(query.code);
      writeTokens(tokens);
      jsonResponse(res, 200, { ok: true, saved: WHOOP_TOKEN_FILE });
      return;
    }

    if (req.method === 'POST' && urlObj.pathname === '/webhook') {
      const body = await readBody(req);
      const ts = req.headers['x-whoop-signature-timestamp'];
      const sig = req.headers['x-whoop-signature'];

      if (!verifySignature(ts, sig, body)) {
        jsonResponse(res, 401, { ok: false, error: 'bad_signature' });
        return;
      }

      const payload = JSON.parse(body.toString('utf8'));

      if (payload.type === 'sleep.updated' && WHOOP_BRIEF_ON_SLEEP) {
        const lastId = readLastSleepId();
        if (lastId && lastId === payload.id) {
          jsonResponse(res, 200, { ok: true, skipped: 'duplicate_sleep' });
          return;
        }
        await forwardToOpenClaw(WHOOP_BRIEF_PROMPT);
        writeLastSleepId(payload.id);
        jsonResponse(res, 200, { ok: true, brief: true });
        return;
      }

      if (WHOOP_NOTIFY_ALL) {
        const msg = `WHOOP ${payload.type} user=${payload.user_id} id=${payload.id} trace=${payload.trace_id}`;
        await forwardToOpenClaw(msg);
        jsonResponse(res, 200, { ok: true });
        return;
      }

      jsonResponse(res, 200, { ok: true, ignored: payload.type });
      return;
    }

    jsonResponse(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    jsonResponse(res, 500, { ok: false, error: err.message || String(err) });
  }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`WHOOP relay listening on http://${LISTEN_HOST}:${LISTEN_PORT}`);
});
