---
name: smart-memory
description: "Extract durable personal/professional facts on /new and save them to workspace memory"
homepage: https://docs.openclaw.ai/hooks#session-memory
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "events": ["command:new"],
        "requires": { "config": ["workspace.dir"] },
      },
  }
---

# Smart Memory Hook

Extracts only durable personal/professional facts when you run `/new`, and saves them into `~/.openclaw/workspace/memory`.

## Configuration (openclaw.json)

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "smart-memory": {
          "enabled": true,
          "messages": 25,
          "maxFacts": 8
        }
      }
    }
  }
}
```

- `messages`: number of recent user messages to inspect
- `maxFacts`: maximum facts to store per snapshot
