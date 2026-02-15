#!/usr/bin/env node
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    "Usage:\n" +
      "  college_gmail_get.mjs --message <id> [--account <email>] [--format <full|metadata|raw>]\n" +
      "  college_gmail_get.mjs <id> [full|metadata|raw]\n" +
      "  college_gmail_get.mjs --since <24h|7d|30d> [--query <gmail-query>] [--max <n>] [--account <email>]\n" +
      "  college_gmail_get.mjs --start <YYYY/MM/DD> [--end <YYYY/MM/DD>] [--query <gmail-query>] [--max <n>] [--account <email>]",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage();

function argValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolveGogBin() {
  const envBin = process.env.GOG_BIN;
  if (envBin && existsSync(envBin)) return envBin;

  const candidates = [
    path.join(os.homedir(), ".local", "bin", "gog"),
    "/usr/local/bin/gog",
    "/usr/bin/gog",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "gog";
}

function getPositionals(argv) {
  const withValue = new Set([
    "--message",
    "--format",
    "--account",
    "--since",
    "--start",
    "--end",
    "--query",
    "--max",
  ]);
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (withValue.has(token)) {
      i += 1;
      continue;
    }
    if (token.startsWith("--")) {
      continue;
    }
    positionals.push(token);
  }
  return positionals;
}

const messageFlag = argValue("--message");
let messageId = messageFlag;
let format = argValue("--format");
const account = argValue("--account") || process.env.COLLEGE_GMAIL_ACCOUNT || process.env.GOG_ACCOUNT;
const gogBin = resolveGogBin();
const since = argValue("--since");
const start = argValue("--start");
const end = argValue("--end");
const query = argValue("--query") || "";
const max = toInt(argValue("--max"), 20);

const positional = getPositionals(args);

// Positional message id mode (backward compatible).
if (!messageId && positional.length > 0) {
  messageId = positional[0];
  if (!format && positional[1]) {
    format = positional[1];
  }
}

// Range search mode.
if (!messageId && (since || start || end || query)) {
  let searchQuery = query.trim();
  if (since) {
    searchQuery = `${searchQuery} newer_than:${since}`.trim();
  }
  if (start) {
    searchQuery = `${searchQuery} after:${start}`.trim();
  }
  if (end) {
    searchQuery = `${searchQuery} before:${end}`.trim();
  }
  if (!searchQuery) {
    usage("Range mode requires --query or at least one of --since/--start/--end.");
  }

  const cmd = ["gmail", "messages", "search", searchQuery, "--max", String(max), "--json"];
  if (account) cmd.splice(3, 0, "--account", account);
  const out = execFileSync(gogBin, cmd, { encoding: "utf8" });
  process.stdout.write(out);
  process.exit(0);
}

if (!messageId) usage("Missing message id.");
if (!format) format = "full";
if (messageId.startsWith("--")) {
  usage("Invalid message id. Use --message <id> or range mode flags.");
}

const cmd = ["gmail", "get", messageId, "--format", format, "--json"]; 
if (account) cmd.splice(2, 0, "--account", account);

const out = execFileSync(gogBin, cmd, { encoding: "utf8" });
process.stdout.write(out);
