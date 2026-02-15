---
name: memory-recall
description: "Inject top memory snippets into bootstrap context for better recall"
metadata:
  {
    "openclaw":
      {
        "emoji": "",
        "events": ["agent:bootstrap"],
      },
  }
---

# Memory Recall Hook

Injects a small, filtered memory snippet block into the system prompt at bootstrap.
Uses the last user message in the session as the search query and filters results
to avoid low‑signal noise.
