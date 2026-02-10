#!/usr/bin/env node
import { execFileSync } from "child_process";

function usage(msg) {
  if (msg) console.error(msg);
  console.error("Usage: college_gmail_get.mjs --message <id> [--account <email>] [--format <full|metadata|raw>]\n" +
    "Or: college_gmail_get.mjs <id> [full|metadata|raw]");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage();

function argValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

let messageId = argValue("--message");
let format = argValue("--format");
const account = argValue("--account") || process.env.COLLEGE_GMAIL_ACCOUNT || process.env.GOG_ACCOUNT;

if (!messageId && args.length > 0) {
  messageId = args[0];
  const maybeFormat = args[1];
  if (maybeFormat && !maybeFormat.startsWith("--")) {
    format = maybeFormat;
  }
}

if (!messageId) usage("Missing message id.");
if (!format) format = "full";

const cmd = ["gmail", "get", messageId, "--format", format, "--json"]; 
if (account) cmd.splice(2, 0, "--account", account);

const out = execFileSync("gog", cmd, { encoding: "utf8" });
process.stdout.write(out);
