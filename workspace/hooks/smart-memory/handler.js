/**
 * Smart memory hook handler
 * Extracts durable facts from recent user messages on /new.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveAgentDir, resolveDefaultAgentId } from "../../../../.npm-global/lib/node_modules/openclaw/dist/agents/agent-scope.js";
import { resolveAgentIdFromSessionKey } from "../../../../.npm-global/lib/node_modules/openclaw/dist/routing/session-key.js";
import { resolveHookConfig } from "../../../../.npm-global/lib/node_modules/openclaw/dist/hooks/config.js";
import { runEmbeddedPiAgent } from "../../../../.npm-global/lib/node_modules/openclaw/dist/agents/pi-embedded.js";

async function getRecentUserMessages(sessionFilePath, messageCount = 25) {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");
    const allMessages = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          if (msg.role !== "user" || !msg.content) continue;
          const text = Array.isArray(msg.content)
            ? msg.content.find((c) => c.type === "text")?.text
            : msg.content;
          if (text && !text.startsWith("/")) {
            allMessages.push(text);
          }
        }
      } catch {
        // ignore invalid JSON
      }
    }
    return allMessages.slice(-messageCount);
  } catch {
    return [];
  }
}

function safeParseJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function fallbackFactsFromMessages(messages, maxFacts) {
  const facts = [];
  const pattern = /\b(i am|i'm|i have|i work|i study|i live|i like|i love|i prefer|i want|i need|my|we)\b/i;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] || "";
    const sentences = msg.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s || s.length < 8) continue;
      if (!pattern.test(s)) continue;
      facts.push({ category: "other", fact: s.replace(/\s+/g, " ") });
      if (facts.length >= maxFacts) return facts.reverse();
    }
  }
  return facts.reverse();
}

async function extractFactsWithLLM({ cfg, sessionKey, messages, maxFacts }) {
  if (!messages.length) return [];

  const agentId = resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const agentDir = resolveAgentDir(cfg, agentId);
  const primaryModel = cfg?.agents?.defaults?.model?.primary || "";
  const modelParts = primaryModel.split("/");
  const provider =
    modelParts.length > 1 ? modelParts[0] : undefined;
  const model =
    modelParts.length > 1 ? modelParts.slice(1).join("/") : undefined;

  const prompt = `You are a memory filter. Extract only durable personal/professional facts that are useful in future conversations.

Rules:
- Include stable facts: identity, preferences, long-term projects, ongoing commitments, roles, recurring schedules.
- Exclude ephemeral chatter, one-off tasks, transient status updates, and sensitive secrets (passwords, API keys).
- Output STRICT JSON array of objects: {"category":"personal|professional|preference|project|schedule|contact|other","fact":"..."}
- Max ${maxFacts} items. If nothing qualifies, output [] only.

Messages:\n${messages.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;

  const result = await runEmbeddedPiAgent({
    sessionId: `smart-memory-${Date.now()}`,
    sessionKey: sessionKey || "temp:smart-memory",
    sessionFile: path.join(await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-smart-memory-")), "session.jsonl"),
    workspaceDir,
    agentDir,
    config: cfg,
    provider,
    model,
    prompt,
    timeoutMs: 20_000,
    runId: `smart-mem-${Date.now()}`,
  });

  const text = (result.payloads || [])
    .map((p) => p?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
  const parsed = safeParseJson(text);
  if (!Array.isArray(parsed)) {
    return fallbackFactsFromMessages(messages, maxFacts);
  }
  const normalized = parsed
    .filter((item) => item && typeof item.fact === "string" && item.fact.trim())
    .slice(0, maxFacts)
    .map((item) => ({
      category: typeof item.category === "string" ? item.category : "other",
      fact: item.fact.trim(),
    }));
  if (normalized.length) return normalized;
  return fallbackFactsFromMessages(messages, maxFacts);
}

const saveSmartMemory = async (event) => {
  if (event.type !== "command" || event.action !== "new") return;

  try {
    const context = event.context || {};
    const cfg = context.cfg;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir = cfg
      ? resolveAgentWorkspaceDir(cfg, agentId)
      : path.join(os.homedir(), ".openclaw", "workspace");
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    const hookConfig = resolveHookConfig(cfg, "smart-memory") || {};
    const envMessages = hookConfig.env?.SMART_MEMORY_MESSAGES;
    const envMaxFacts = hookConfig.env?.SMART_MEMORY_MAX_FACTS;
    const messageCount = Number(envMessages) > 0 ? Number(envMessages) : 25;
    const maxFacts = Number(envMaxFacts) > 0 ? Number(envMaxFacts) : 8;

    const sessionEntry = (context.previousSessionEntry || context.sessionEntry || {});
    const sessionFile = sessionEntry.sessionFile || undefined;
    if (!sessionFile) return;

    const userMessages = await getRecentUserMessages(sessionFile, messageCount);
    const facts = await extractFactsWithLLM({ cfg, sessionKey: event.sessionKey, messages: userMessages, maxFacts });
    if (!facts.length) return;

    const now = new Date(event.timestamp);
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().split("T")[1].split(".")[0];
    const filename = `${dateStr}-smart-memory.md`;
    const memoryFilePath = path.join(memoryDir, filename);

    const lines = [
      `# Smart Memory: ${dateStr} ${timeStr} UTC`,
      "",
      `- **Session Key**: ${event.sessionKey}`,
      `- **Session ID**: ${sessionEntry.sessionId || "unknown"}`,
      `- **Source**: ${context.commandSource || "unknown"}`,
      "",
      "## Facts",
      ...facts.map((f) => `- [${f.category}] ${f.fact}`),
      "",
    ];

    await fs.writeFile(memoryFilePath, lines.join("\n"), "utf-8");
    const relPath = memoryFilePath.replace(os.homedir(), "~");
    event.messages?.push(`Saved ${facts.length} fact(s) to ${relPath}`);
  } catch (err) {
    console.error("[smart-memory] Failed:", err instanceof Error ? err.message : String(err));
  }
};

export default saveSmartMemory;
