# AI coding rules for NyxelOS

NyxelOS is an agentic OS (Bun/Hono/tRPC server, React/TanStack web, Drizzle
DB). These rules apply to every AI-assisted change in this repo.

## Commits
- Conventional Commits only (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- Concise, meaningful messages — state the "why", not a change log.
- Small, focused commits. Don't bundle unrelated fixes.
- Don't commit generated noise or formatting-only diffs unless the task requires them.

## Code
- Minimal, typed, secure, maintainable. No AI slop, no filler, no speculative features.
- No unused abstractions or wrappers "for later." Three similar lines beat a premature abstraction.
- Follow existing repo architecture and naming — no unrelated refactors.
- Never expose secrets (API keys, tokens, OAuth state) to browser/client responses.
- Avoid unsafe tool execution paths (unsandboxed eval, unchecked shell/file access) — match existing permission/approval patterns (`tools-builtin/*`, `approvals.ts`).
- Keep agent runtime behavior deterministic where possible (explicit status transitions, atomic claims over check-then-write).

## UI
- Do not change UI/UX unless the task requires it. No decorative or visual-redesign work.
- Preserve shadcn/default-theme conventions when UI changes are required.

## Validation
- Don't run the full test suite by default. Run targeted tests for the files/packages you touched.
- Typecheck only the changed package/app when feasible; lint only the touched area.
- Only run broad/global suites when a change touches shared core behavior and no smaller validation exists.
