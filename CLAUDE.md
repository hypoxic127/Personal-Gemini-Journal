# CLAUDE.md

This project's operating rules live in **@AGENTS.md** — read it in full before writing any code.
It is shared verbatim with Google Antigravity and with the Google AI Studio Custom Instructions
(kept in `notes/00-AI-Studio-Custom-Instructions.md`, gitignored). All three must stay in sync.

## Claude Code specifics

- **`notes/START.md` is the linear build guide** (gitignored working material) — check which milestone is next before starting work. Absent in a fresh clone; `README.md` alone covers everything a newcomer needs.
- `README.md` is the product document and is self-contained. Design material lives in the gitignored `notes/` —
  read the architecture and data-model notes there when they exist and you need the reasoning behind a layer.
- `firestore.rules` is security-critical. Any edit to it requires a matching negative test in
  `test/firestore.rules.test.ts` in the same commit.
- Never run `firebase deploy`, `gcloud run deploy`, or anything that mutates cloud state without asking first.
- Never write a real secret into any file. `.env.example` with empty placeholders only.
- When a task spans frontend + backend + rules, do the **rules and backend first**, then the UI.
  A UI built against a permissive rule set hides the bug you need to find.

## Quick map

```
web/      React + Vite SPA        — no keys, no direct Firestore writes
api/      Express on Cloud Run    — the only holder of secrets; all writes; all Gemini calls
shared/   Zod schemas + types     — single source of truth, imported by both sides
firestore.rules                   — last line of defense, written as if api/ did not exist
```
