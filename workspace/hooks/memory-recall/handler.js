import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isSubagentSessionKey } from "../../../../.npm-global/lib/node_modules/openclaw/dist/routing/session-key.js";
import { resolveDefaultAgentId } from "../../../../.npm-global/lib/node_modules/openclaw/dist/agents/agent-scope.js";
import { resolveSessionTranscriptPath } from "../../../../.npm-global/lib/node_modules/openclaw/dist/config/sessions/paths.js";
import { getMemorySearchManager } from "../../../../.npm-global/lib/node_modules/openclaw/dist/memory/index.js";

async function readLastUserMessage(sessionFile) {
  try {
    const content = await fs.readFile(sessionFile, "utf-8");
    const lines = content.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry?.type !== "message" || !entry?.message) continue;
        const msg = entry.message;
        if (msg.role !== "user" || !msg.content) continue;
        const text = Array.isArray(msg.content)
          ? msg.content.find((c) => c.type === "text")?.text
          : msg.content;
        if (!text) continue;
        const trimmed = text.trim();
        if (!trimmed || trimmed.startsWith("/")) continue;
        return trimmed;
      } catch {
        // ignore line
      }
    }
  } catch {
    // ignore
  }
  return "";
}

function tokenizeQuery(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
}

function snippetMatchesTerms(snippet, terms) {
  if (!snippet || terms.length === 0) return false;
  const hay = snippet.toLowerCase();
  return terms.some((t) => hay.includes(t));
}

function buildRecallBlock(query, results, maxSnippets) {
  const lines = [
    "# Memory Recall (auto)",
    "",
    `Query: ${query}`,
    "",
  ];
  for (const r of results.slice(0, maxSnippets)) {
    const loc = `${r.path}:${r.startLine ?? "?"}-${r.endLine ?? "?"}`;
    const score = typeof r.score === "number" ? r.score.toFixed(2) : "n/a";
    lines.push(`- ${loc} (score ${score})`);
    lines.push(`  ${r.snippet?.trim() ?? ""}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

const handler = async (event) => {
  if (event.type !== "agent" || event.action !== "bootstrap") return;
  const context = event.context || {};
  if (!Array.isArray(context.bootstrapFiles)) return;
  if (context.sessionKey && isSubagentSessionKey(context.sessionKey)) return;

  const cfg = context.cfg;
  const agentId = context.agentId || resolveDefaultAgentId(cfg);
  const sessionId = context.sessionId;
  if (!sessionId) return;

  const sessionFile = resolveSessionTranscriptPath(sessionId, agentId);
  const query = await readLastUserMessage(sessionFile);
  if (!query || query.length < 6) return;

  const minScore = Number(context.cfg?.hooks?.internal?.entries?.["memory-recall"]?.env?.MEMORY_RECALL_MIN_SCORE) || 0.2;
  const maxResults = Number(context.cfg?.hooks?.internal?.entries?.["memory-recall"]?.env?.MEMORY_RECALL_MAX_RESULTS) || 6;
  const maxSnippets = Number(context.cfg?.hooks?.internal?.entries?.["memory-recall"]?.env?.MEMORY_RECALL_MAX_SNIPPETS) || 3;

  const { manager } = await getMemorySearchManager({ cfg, agentId });
  if (!manager) return;

  let results = [];
  try {
    results = await manager.search(query, {
      maxResults,
      minScore,
      sessionKey: context.sessionKey,
    });
  } catch {
    return;
  }

  if (!results?.length) return;
  const terms = tokenizeQuery(query);
  const filtered = results.filter((r) => snippetMatchesTerms(r.snippet || "", terms));
  if (!filtered.length) return;

  const content = buildRecallBlock(query, filtered, maxSnippets);
  if (!content) return;

  context.bootstrapFiles.push({
    name: "MEMORY_RECALL.md",
    path: "MEMORY_RECALL.md",
    content,
    missing: false,
  });
};

export default handler;
