---
name: college
description: Use when the user asks about class schedules, reschedules, or updates. This skill pulls data from Gmail and Google Calendar via gog for the college account and summarizes it (pull-only, no notifications).
---

# College

## Overview
Answer college schedule and update questions by querying Google Calendar and Gmail via `gog`. This skill is pull-only and optimized for “today/this week” questions, reschedules, and class updates.

## Required context
- Gmail/Calendar OAuth already authorized via `gog`.
- Gateway running with `GOG_KEYRING_BACKEND=file` and `GOG_KEYRING_PASSWORD` in its environment.
- Default account: `COLLEGE_GMAIL_ACCOUNT` (falls back to `GOG_ACCOUNT`).

## Quick start

### One-shot summary (schedule + updates)
```
node /home/openclaw/.openclaw/skills/college/scripts/college_summary.mjs --account "$COLLEGE_GMAIL_ACCOUNT"
```

Add PDFs:
```
node /home/openclaw/.openclaw/skills/college/scripts/college_summary.mjs --account "$COLLEGE_GMAIL_ACCOUNT" --include-pdf
```

### “What’s my schedule today?”
1) Calendar:
```
gog calendar events --today --account "$COLLEGE_GMAIL_ACCOUNT" --json
```
2) Updates/cancellations in Gmail (last 7 days):
```
gog gmail messages search "newer_than:7d (reschedule OR rescheduled OR cancelled OR canceled OR postponed OR update OR changes) (class OR lecture OR lab OR tutorial OR section)" --account "$COLLEGE_GMAIL_ACCOUNT" --json
```

### “Any reschedules or updates?”
- Use Gmail search for the last 7–14 days, add course keywords or sender:
```
gog gmail messages search "newer_than:14d (reschedule OR cancelled OR canceled OR postponed OR update OR changes) (CS101 OR MATH102 OR class OR lecture)" --account "$COLLEGE_GMAIL_ACCOUNT" --json
```

### “Any updates about <course name>?”
- Search Gmail with a narrower query:
```
gog gmail messages search "newer_than:30d (\"<course name>\" OR <course code>)" --account "$COLLEGE_GMAIL_ACCOUNT" --json
```

## Attachments (PDF)
If a relevant email has PDF attachments, download and extract text:
```
node /home/openclaw/.openclaw/skills/college/scripts/college_pdf_extract.mjs --account "$COLLEGE_GMAIL_ACCOUNT" --message <messageId> --out /tmp/college-pdfs
```
- If `pdftotext` is installed, the script writes a `.txt` file next to each PDF.
- If not installed, note the PDF path and ask to install `poppler-utils` to extract text.

## Safe Gmail get (avoids "unexpected argument raw")
Always use the wrapper (or `--format` flag) instead of a positional `raw` argument:
```
node /home/openclaw/.openclaw/skills/college/scripts/college_gmail_get.mjs --message <id> --format full
```
or
```
node /home/openclaw/.openclaw/skills/college/scripts/college_gmail_get.mjs <id> raw
```

## Decision rules
- If the user gives a date range, use `--from/--to` (Calendar) or `after:YYYY/MM/DD before:YYYY/MM/DD` (Gmail).
- Prefer Calendar for “schedule”; use Gmail to confirm updates, cancellations, or room changes.
- If multiple sources conflict, call it out with timestamps and sender names.
- Do not send to Telegram; respond in chat only.

## Troubleshooting
- Calendar error “accessNotConfigured”: enable Calendar API for the OAuth project (`eclipse-openclaw`) in Google Cloud Console.

## Outputs
- Summarize today’s schedule in local time.
- Provide a short “Updates/Changes” section with the most relevant emails and extracted PDF notes.
