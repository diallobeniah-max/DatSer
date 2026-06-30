# Custom Project Rules

## Token and Resource Efficiency
- Use tokens efficiently. The user's tokens are limited, so avoid waste.
- Prioritize the most important work first.
- Do not read, print, or summarize large files unless necessary.
- Use targeted searches such as `rg`, file-specific reads, and focused diffs instead of scanning the whole project repeatedly.
- Avoid repeating the same investigation steps after the answer is already clear.
- Do not paste huge logs into the response. Summarize the key error lines and mention where the full log can be found.
- Keep final responses clear and useful, but not unnecessarily long.
- When the task is simple, solve it directly without over-explaining.
- When the task is complex, explain only the important decisions, risks, changed files, tests, and next steps.
- Do not waste tokens on generic explanations the user did not ask for.
- Do not ask the user to do something Codex can safely do itself.

## Work Style
- Be direct and practical.
- Prefer fixing the root cause over making the UI only appear fixed.
- Preserve existing working behavior unless the requested change requires altering it.
- Avoid unnecessary rewrites of large components.
- Make the smallest safe change that properly solves the issue.
- When editing, respect the existing structure, naming, styling, and patterns of the codebase.
- Before adding new libraries, check whether the project already has a suitable dependency.

## Supabase and Data Safety
- Supabase is already configured in the Codex/workspace environment.
- When Supabase work is required, Codex should handle migrations, SQL, RPCs, policies, realtime setup, and verification directly where access allows.
- Do not ask the user to manually run Supabase commands unless Codex lacks permission, a secret is missing, or user confirmation is required.
- Never hardcode secrets, passwords, API keys, admin codes, or private tokens.
- Use migrations for database schema changes.
- Verify database changes after applying them.
- Saved attendance/member data must never silently disappear.
- Supabase remains the source of truth; local cache is only for speed, offline support, and fallback display.

## Reliability Rules
- If a save fails, show a clear error and keep the action retryable.
- Do not show "Saved" unless the save actually reached the source of truth or was clearly queued for retry.
- Background refresh should not block the user from seeing cached data.
- Avoid stuck loading screens, blur overlays, or blank states.
- Manual refresh should be a backup, not the normal way users see current data.
- Realtime sync should update the same state used by counts, marked lists, search results, and attendance buttons.

## Validation Rules
- Run only the relevant checks for the task.
- Prefer:
  - npm run lint
  - npm test
  - npm run build
  - available smoke tests
- Do not run expensive or unrelated commands unless needed.
- If tests fail, summarize the failing test and root cause instead of dumping full logs.
- Before finishing, mention:
  - files changed
  - validation run
  - whether anything was skipped
  - whether any manual Supabase step remains

## Git Rules
- Check the branch and working tree before editing.
- Do not overwrite unrelated user changes.
- Commit and push completed work to main unless the user says not to.
- Use clear commit messages that describe the actual fix.
- Leave generated artifacts, screenshots, logs, and temporary files unstaged unless they are intentionally part of the task.
