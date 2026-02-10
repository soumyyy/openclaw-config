---
name: whoop
description: Fetch WHOOP recovery, sleep, workout, cycle, and profile data via the local WHOOP token file and API. Use when asking for WHOOP metrics, summaries, or on-demand API pulls.
---

# WHOOP Skill

Use the bundled script to query WHOOP data using the OAuth token file created by the relay.

## Prereqs

- WHOOP OAuth tokens stored at `WHOOP_TOKEN_FILE`.
- `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` set for token refresh.

## Usage

Run the script directly from the skill folder:

```bash
node {baseDir}/scripts/whoop.js <command> [args]
```

Commands:

- `profile` - Get basic user profile.
- `measurements` - Get body measurements.
- `sleep latest` - Get the most recent sleep record.
- `sleep latest formatted` - Get latest sleep with local time computed from WHOOP timezone_offset (use this for summaries).
- `workout latest` - Get the most recent workout record.
- `recovery latest` - Get the most recent recovery record.
- `cycle latest` - Get the most recent cycle record.
- `api <path> [key=value ...]` - Call any WHOOP endpoint (path is appended to the base URL).

Examples:

```bash
node {baseDir}/scripts/whoop.js sleep latest
node {baseDir}/scripts/whoop.js sleep latest formatted
node {baseDir}/scripts/whoop.js workout latest
node {baseDir}/scripts/whoop.js api /v2/activity/sleep limit=3
```

Notes:

- If endpoint paths change, use `api` with the path shown in WHOOP API docs.
- The script refreshes tokens when they are expired and a refresh token is available.

## Response style for summaries

- Use short labeled lines or bullets; never return a single long paragraph.
- Keep tone neutral and professional; avoid casual phrasing.
- Prefer local time from `sleep latest formatted`.
- Include only the key metrics requested; keep each metric on its own line.
- If offering guidance, keep it to one concise line at the end.
