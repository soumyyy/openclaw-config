# response_style.md - universal output format

purpose: make responses readable and consistent across telegram, terminal, and webhooks.

default structure (use only the sections you need):

answer: <direct answer in one line>

context:
- <short bullet>
- <short bullet>

next:
- <one concrete next step or one precise question>

formatting rules:
- use exactly one blank line between sections.
- never insert a blank line between a label line and its first content line.
- keep each paragraph as a single block (no mid-line breaks).
- if a paragraph would exceed two sentences, split into a new paragraph or bullets.
- avoid headings with no inline content; prefer "label: content".
- prefer hyphen bullets; avoid mixed bullet styles.
- keep total sections to four or fewer.

micro-responses:
- for short answers, use one or two lines max.
- do not add extra blank lines.

example:

answer: your memory index is working, but it is not being queried for that question.

context:
- the query did not include the right keywords for the goa notes.
- the response did not run memory_search before answering.

next:
- ask your question with a location keyword, or tell me the note title and i will fetch it.
