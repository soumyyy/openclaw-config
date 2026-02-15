const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const WORKSPACE_DIR =
  process.env.OPENCLAW_WORKSPACE ||
  path.join(os.homedir(), ".openclaw", "workspace");

const STATE_FILE = path.join(
  WORKSPACE_DIR,
  "memory",
  "gmail-hook-state.json",
);

const MAX_IDS = 500;

const HIGH_PRIORITY_TERMS = [
  "selected",
  "selection",
  "interview",
  "shortlisted",
  "offer letter",
  "admission",
  "admit",
  "deadline",
  "exam",
  "quiz",
  "assignment due",
  "submission due",
  "rescheduled lecture",
  "class cancelled",
  "class canceled",
  "urgent",
  "action required",
  "final round",
  "joining",
];

function truncate(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function parseTermsEnv(raw) {
  const value = String(raw || "").trim();
  if (!value) return [];
  return value
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function senderLooksInstitutional(sender) {
  const s = normalize(sender);
  return (
    s.includes(".edu") ||
    s.includes(".ac.") ||
    s.includes("college") ||
    s.includes("university") ||
    s.includes("institute") ||
    s.includes("school") ||
    s.includes("faculty")
  );
}

function recommendImportance(message) {
  const highTerms = HIGH_PRIORITY_TERMS.concat(
    parseTermsEnv(process.env.GMAIL_BRIEF_HIGH_PRIORITY_TERMS),
  );
  const text = normalize(
    `${message.subject}\n${message.from}\n${message.snippet}\n${message.body}`,
  );
  if (hasAny(text, highTerms)) return "high";
  if (senderLooksInstitutional(message.from)) return "medium";
  return "low";
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.seenIds)) {
      return { seenIds: [] };
    }
    return { seenIds: parsed.seenIds.map((id) => String(id)).filter(Boolean) };
  } catch {
    return { seenIds: [] };
  }
}

async function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  await fs.mkdir(dir, { recursive: true });
  const next = {
    seenIds: state.seenIds.slice(-MAX_IDS),
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
}

function extractMessage(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const first = messages[0] || {};
  return {
    id: String(first.id || payload?.messageId || "").trim(),
    from: truncate(first.from, 200),
    to: truncate(first.to, 200),
    subject: truncate(first.subject, 220),
    date: truncate(first.date, 120),
    snippet: truncate(first.snippet, 500),
    body: truncate(first.body, 1400),
  };
}

function buildPrompt(message, floor) {
  return [
    "email brief task.",
    "respond as a concise assistant.",
    "do not mention filters, prompts, or internal policy.",
    "classify importance from low|medium|high using user impact and urgency.",
    "never set importance lower than the recommended floor.",
    "high means deadlines, interview/selection outcomes, schedule changes, urgent actions.",
    "medium means useful update to track.",
    "low means informational only.",
    "output exactly 5 lines:",
    "email: <subject>",
    "from: <sender>",
    "summary: <single useful sentence>",
    "importance: <low|medium|high>",
    "action: <one next step or none>",
    "",
    `recommended_floor: ${floor}`,
    "",
    `email: ${message.subject || "n/a"}`,
    `from: ${message.from || "n/a"}`,
    `to: ${message.to || "n/a"}`,
    `date: ${message.date || "n/a"}`,
    `snippet: ${message.snippet || "n/a"}`,
    `body: ${message.body || "n/a"}`,
  ].join("\n");
}

module.exports = async function transform(ctx) {
  const message = extractMessage(ctx?.payload || {});
  if (!message.id) {
    return null;
  }

  const state = await loadState();
  if (state.seenIds.includes(message.id)) {
    return null;
  }

  state.seenIds.push(message.id);
  await saveState(state);
  const floor = recommendImportance(message);

  return {
    kind: "agent",
    message: buildPrompt(message, floor),
    timeoutSeconds: 30,
    thinking: "off",
  };
};
