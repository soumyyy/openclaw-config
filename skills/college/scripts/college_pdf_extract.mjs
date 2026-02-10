#!/usr/bin/env node
import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";

function usage(msg) {
  if (msg) {
    console.error(msg);
  }
  console.error("Usage: college_pdf_extract.mjs --message <id> [--account <email>] [--out <dir>]");
  process.exit(1);
}

function argValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const args = process.argv.slice(2);
const messageId = argValue(args, "--message");
const account = argValue(args, "--account");
const outDir = argValue(args, "--out") || "/tmp/college-pdfs";

if (!messageId) usage("Missing --message <id>");

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

function runGog(cmdArgs) {
  const fullArgs = ["gmail", ...(account ? ["--account", account] : []), ...cmdArgs, "--json"];
  const out = execFileSync("gog", fullArgs, { encoding: "utf8" });
  return JSON.parse(out);
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

const message = runGog(["get", messageId, "--format", "full"]);
const attachments = Array.isArray(message.attachments) && message.attachments.length
  ? message.attachments
  : collectAttachments(message.payload, []);
const pdfs = attachments.filter((a) => {
  const name = (a.filename || "").toLowerCase();
  return a.mimeType === "application/pdf" || name.endsWith(".pdf");
});

const results = [];
for (let i = 0; i < pdfs.length; i += 1) {
  const att = pdfs[i];
  const filename = att.filename && att.filename.trim() ? att.filename : `attachment-${i + 1}.pdf`;
  const outPath = path.join(outDir, filename);
  execFileSync("gog", [
    "gmail",
    "attachment",
    ...(account ? ["--account", account] : []),
    messageId,
    att.attachmentId,
    "--out",
    outPath,
  ], { stdio: "ignore" });

  let textPath = null;
  const textOut = outPath.replace(/\.pdf$/i, ".txt");
  const pdfToText = spawnSync("pdftotext", [outPath, textOut], { stdio: "ignore" });
  if (pdfToText.status === 0) {
    textPath = textOut;
  }

  results.push({
    filename,
    mimeType: att.mimeType || "application/pdf",
    file: outPath,
    textFile: textPath,
  });
}

console.log(JSON.stringify({
  messageId,
  outDir,
  attachments: results,
}, null, 2));
