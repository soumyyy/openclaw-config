#!/usr/bin/env node
import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";

function usage(msg) {
  if (msg) console.error(msg);
  console.error("Usage: college_summary.mjs [--account <email>] [--days <n>] [--updates-days <n>] [--max-updates <n>] [--include-pdf]");
  process.exit(1);
}

function argValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage();

const account = argValue(args, "--account") || process.env.COLLEGE_GMAIL_ACCOUNT || process.env.GOG_ACCOUNT;
const days = parseInt(argValue(args, "--days") || "1", 10);
const updatesDays = parseInt(argValue(args, "--updates-days") || "7", 10);
const maxUpdates = parseInt(argValue(args, "--max-updates") || "5", 10);
const includePdf = args.includes("--include-pdf");
const outDir = "/tmp/college-pdfs";

if (!account) usage("Missing account: set --account or COLLEGE_GMAIL_ACCOUNT.");
if (!Number.isFinite(days) || days < 1) usage("--days must be >= 1");
if (!Number.isFinite(updatesDays) || updatesDays < 1) usage("--updates-days must be >= 1");

function runGog(cmdArgs) {
  const fullArgs = [...cmdArgs, "--json"];
  const res = spawnSync("gog", fullArgs, { encoding: "utf8" });
  if (res.status !== 0) {
    const errMsg = (res.stderr || res.stdout || "").trim() || `gog exited with code ${res.status}`;
    throw new Error(errMsg);
  }
  return JSON.parse(res.stdout);
}

function runGogMaybe(cmdArgs) {
  try {
    return { ok: true, data: runGog(cmdArgs) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function calendarEvents() {
  const calArgs = [
    "calendar",
    "events",
    "--account",
    account,
    "--days",
    String(days),
  ];
  return runGogMaybe(calArgs);
}

function gmailUpdates() {
  const query = [
    `newer_than:${updatesDays}d`,
    "(",
    "reschedule OR rescheduled OR cancelled OR canceled OR postponed OR update OR changes",
    ")",
    "(",
    "class OR lecture OR lab OR tutorial OR section OR exam OR quiz OR assignment",
    ")",
  ].join(" ");

  const gmailArgs = [
    "gmail",
    "messages",
    "search",
    query,
    "--account",
    account,
    "--max",
    String(maxUpdates),
  ];
  return runGogMaybe(gmailArgs);
}

function collectAttachments(part, acc) {
  if (!part) return acc;
  if (Array.isArray(part)) {
    for (const p of part) collectAttachments(p, acc);
    return acc;
  }
  if (part.body && part.body.attachmentId) {
    acc.push({
      filename: part.filename || "",
      mimeType: part.mimeType || "",
      attachmentId: part.body.attachmentId,
    });
  }
  if (part.parts) collectAttachments(part.parts, acc);
  return acc;
}

function safeName(name, fallback) {
  const base = name && name.trim() ? name.trim() : fallback;
  return base.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function downloadPdf(messageId, attachmentId, filename) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, filename);
  execFileSync("gog", [
    "gmail",
    "attachment",
    "--account",
    account,
    messageId,
    attachmentId,
    "--out",
    outPath,
  ], { stdio: "ignore" });
  return outPath;
}

function extractPdfText(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/i, ".txt");
  const res = spawnSync("pdftotext", [pdfPath, txtPath], { stdio: "ignore" });
  if (res.status === 0 && existsSync(txtPath)) {
    return txtPath;
  }
  return null;
}

function readPreview(filePath, maxChars = 800) {
  try {
    const text = readFileSync(filePath, "utf8");
    return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
  } catch {
    return null;
  }
}

const schedule = calendarEvents();
const updates = gmailUpdates();

const result = {
  account,
  schedule: schedule.ok ? { ok: true, events: schedule.data.events || [] } : { ok: false, error: schedule.error },
  updates: updates.ok ? { ok: true, messages: updates.data.messages || [] } : { ok: false, error: updates.error },
  attachments: [],
  notes: [],
};

if (includePdf && updates.ok) {
  for (const msg of updates.data.messages || []) {
    const msgId = msg.id;
    let full;
    try {
      full = runGog(["gmail", "get", msgId, "--account", account, "--format", "full"]);
    } catch {
      continue;
    }
    const atts = Array.isArray(full.attachments) && full.attachments.length
      ? full.attachments
      : collectAttachments(full.payload, []);
    const pdfs = atts.filter((a) => {
      const name = (a.filename || "").toLowerCase();
      return a.mimeType === "application/pdf" || name.endsWith(".pdf");
    });
    let i = 0;
    for (const att of pdfs) {
      i += 1;
      const filename = safeName(att.filename, `${msgId}-${i}.pdf`);
      const filePath = downloadPdf(msgId, att.attachmentId, filename);
      const textPath = extractPdfText(filePath);
      const preview = textPath ? readPreview(textPath) : null;
      result.attachments.push({
        messageId: msgId,
        filename,
        file: filePath,
        textFile: textPath,
        textPreview: preview,
      });
      if (!textPath) {
        result.notes.push("pdftotext not available; install poppler-utils to extract PDF text.");
      }
    }
  }
}

console.log(JSON.stringify(result, null, 2));
