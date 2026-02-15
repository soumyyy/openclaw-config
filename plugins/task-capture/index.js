const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_TASKS_PATH = "~/.openclaw/workspace/TASKS.md";
const DEFAULT_SECTION = "inbox";
const DEFAULT_LIST_SECTION = "lists";

const DEFAULT_TEMPLATE = `# tasks.md - personal task board

use this file as the single source of truth for tasks. keep it small and current.

## inbox
- 

## next
- 

## in progress
- 

## waiting
- 

## scheduled
- 

## done (today)
- 

## lists
### personal
- 

### work
- 

### errands
- 

rules:
- capture everything in inbox first, then move it.
- keep "next" to 3–7 items max.
- remove stale items weekly.
- use short, actionable verbs.
`;

const normalizeName = (value) => String(value || "").trim().toLowerCase();

const findHeadingIndex = (lines, heading, level) => {
  const needle = normalizeName(heading);
  const prefix = "#".repeat(level) + " ";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim().toLowerCase();
    if (line.startsWith(prefix) && normalizeName(line.slice(prefix.length)) === needle) {
      return i;
    }
  }
  return -1;
};

const findSectionEnd = (lines, startIdx, level) => {
  if (startIdx < 0) return lines.length;
  const prefix = "#".repeat(level) + " ";
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith(prefix)) {
      return i;
    }
  }
  return lines.length;
};

const insertTaskLine = (lines, insertIdx, task) => {
  let idx = insertIdx;
  while (idx < lines.length && lines[idx].trim() === "") {
    idx += 1;
  }
  if (idx < lines.length && /^-\s*$/.test(lines[idx])) {
    lines[idx] = `- ${task}`;
    return;
  }
  lines.splice(idx, 0, `- ${task}`);
};

const ensureTasksFile = async (tasksPath) => {
  try {
    await fs.access(tasksPath);
    return;
  } catch {
    await fs.mkdir(path.dirname(tasksPath), { recursive: true });
    await fs.writeFile(tasksPath, DEFAULT_TEMPLATE, "utf-8");
  }
};

const parseArgs = (rawArgs) => {
  const trimmed = String(rawArgs || "").trim();
  if (!trimmed) {
    return { error: "usage: /task add <text> or /task add list:<name> <text>" };
  }
  const withoutAdd = trimmed.toLowerCase().startsWith("add ")
    ? trimmed.slice(4).trim()
    : trimmed;
  if (!withoutAdd) {
    return { error: "usage: /task add <text> or /task add list:<name> <text>" };
  }
  const parts = withoutAdd.split(/\s+/);
  const first = parts[0];
  let listName = null;
  let rest = withoutAdd;
  const listMatch = first.match(/^list[:=]([a-z0-9._-]+)$/i);
  const tagMatch = first.match(/^[@#]([a-z0-9._-]+)$/i);
  if (listMatch) {
    listName = listMatch[1];
    rest = withoutAdd.slice(first.length).trim();
  } else if (tagMatch) {
    listName = tagMatch[1];
    rest = withoutAdd.slice(first.length).trim();
  }
  if (!rest) {
    return { error: "task text missing" };
  }
  return { listName, text: rest };
};

const addTaskToSection = (lines, sectionName, task) => {
  const sectionIdx = findHeadingIndex(lines, sectionName, 2);
  if (sectionIdx === -1) {
    lines.push("", `## ${sectionName}`, `- ${task}`, "");
    return;
  }
  insertTaskLine(lines, sectionIdx + 1, task);
};

const addTaskToList = (lines, listSectionName, listName, task) => {
  const listSectionIdx = findHeadingIndex(lines, listSectionName, 2);
  if (listSectionIdx === -1) {
    lines.push("", `## ${listSectionName}`, `### ${listName}`, `- ${task}`, "");
    return;
  }
  const listSectionEnd = findSectionEnd(lines, listSectionIdx, 2);
  let listIdx = -1;
  for (let i = listSectionIdx + 1; i < listSectionEnd; i += 1) {
    const line = lines[i].trim().toLowerCase();
    if (line.startsWith("### ")) {
      const name = normalizeName(line.slice(4));
      if (name === normalizeName(listName)) {
        listIdx = i;
        break;
      }
    }
  }
  if (listIdx === -1) {
    const insertAt = listSectionEnd;
    const needsBlank = insertAt > 0 && lines[insertAt - 1].trim() !== "";
    const insertLines = [];
    if (needsBlank) insertLines.push("");
    insertLines.push(`### ${listName}`, `- ${task}`, "");
    lines.splice(insertAt, 0, ...insertLines);
    return;
  }
  insertTaskLine(lines, listIdx + 1, task);
};

const addTask = async (tasksPath, sectionName, listSectionName, listName, task) => {
  await ensureTasksFile(tasksPath);
  const content = await fs.readFile(tasksPath, "utf-8");
  const lines = content.split(/\r?\n/);
  if (listName) {
    addTaskToList(lines, listSectionName, listName, task);
  } else {
    addTaskToSection(lines, sectionName, task);
  }
  await fs.writeFile(tasksPath, lines.join("\n"), "utf-8");
};

function register(api) {
  const pluginConfig = api.pluginConfig || {};
  const tasksPath = api.resolvePath(pluginConfig.tasksFile || DEFAULT_TASKS_PATH);
  const defaultSection = normalizeName(pluginConfig.defaultSection || DEFAULT_SECTION) || DEFAULT_SECTION;
  const listSection = normalizeName(pluginConfig.listSection || DEFAULT_LIST_SECTION) || DEFAULT_LIST_SECTION;
  const confirm = pluginConfig.confirm !== false;

  const handler = async (ctx) => {
    const parsed = parseArgs(ctx.args);
    if (parsed.error) {
      return { text: parsed.error };
    }
    await addTask(tasksPath, defaultSection, listSection, parsed.listName, parsed.text);
    if (!confirm) {
      return { text: "ok" };
    }
    if (parsed.listName) {
      return { text: `added to list: ${parsed.listName}` };
    }
    return { text: `added to ${defaultSection}` };
  };

  api.registerCommand({
    name: "task",
    description: "add a task to tasks.md",
    acceptsArgs: true,
    requireAuth: true,
    handler,
  });

  api.registerCommand({
    name: "todo",
    description: "add a task to tasks.md",
    acceptsArgs: true,
    requireAuth: true,
    handler,
  });
}

module.exports = {
  id: "task-capture",
  name: "task capture",
  version: "0.1.0",
  description: "capture tasks into tasks.md via /task or /todo",
  register,
};
