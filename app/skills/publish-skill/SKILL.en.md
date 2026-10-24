---
name: publish-skill
description: Use when the user asks to review, upload, publish, or update a Skill from the current project in the BoltPocket Skill Market, or asks why a Skill cannot be listed. Operate only on the exact project SKILL.md and public README.md, run the host security review first, and publish only after every blocker is fixed. Never copy the complete Skill into chat or tool arguments.
---

# Review and publish a Skill

1. Call `project_context_read` and verify that the conversation owns a project. Use `find` to confirm `/project/skills/<skill-id>/SKILL.md`; ask for the target when it is ambiguous and never guess.
2. The public market detail shows only `/project/skills/<skill-id>/README.md`, never `SKILL.md`. Require one H1 plus the use case, expected outcome, and access boundary. Do not copy the complete instructions, credentials, personal data, private paths, or internal locations into the README.
3. This market version publishes only `SKILL.md` and `README.md`. If the Skill depends on `scripts/`, `references/`, `assets/`, or another sibling file, explain that it cannot yet be published and suggest inlining a short necessary instruction or removing the dependency. Never drop a dependency and claim the package is complete.
4. Call `skill_market_review` with only `skillId`. The host reads both files directly from the current project and checks format, market naming rules, sensitive data, credentials, privilege escalation, dangerous commands, and silent mutation requirements. A project Skill ID containing dots, underscores, repeated hyphens, or more than 64 characters must still be submitted for review so the host can return a specific rename finding; do not block it before review. Never put either complete document in tool arguments, chat, logs, or temporary files.
5. When `status` is `pass`, report only that it passed, any warnings, and the `reviewHash`; do not restate every check. When `status` is `needs_changes`, report each finding's `target`, `line`, `severity`, `message`, and `suggestion`, and never call the publish tool:
   - If the user requested review only, stop after the precise recommendations.
   - If the user also requested fixes, use project `edit` or `write` so the changes enter the shared Diff. State that the applied files need a new review and that the old `reviewHash` cannot be reused.
6. After `status` is `pass`, continue only when the latest user message explicitly requests publishing or uploading. Never guess the license or public publisher name; ask when either is missing. Category must be `engineering`, `operations`, `privacy`, `productivity`, `research`, or `writing`; choose 1–5 lowercase hyphenated tags; license must be `Apache-2.0`, `CC0-1.0`, or `MIT`.
7. Call `skill_market_publish` with the exact `reviewHash`, `skillId`, and public metadata. The host re-reads and re-reviews both files, checks the current market revision, binds a deterministic publication Patch to its SHA-256, creates a recovery point, and applies it. After 30 minutes, the host may continue directly only when both document digests and the fresh review match exactly. Stop and report any changed content, review result, project, conversation, or market revision; never bypass the host.
8. After success, report only the market `entryId`, `revision`, Patch SHA-256, receipt ID, recovery availability, and public README detail location. Explain that a downloader's `SKILL.md` is encrypted at rest, cannot be viewed in the UI, and is decrypted temporarily only during an Agent run that uses it.

Never treat README as a substitute for security review, hide warnings behind a passing headline, or use a browser or ordinary network tool to bypass the host publication tools.
