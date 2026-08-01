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

## Development Server Workflow
- At the start of a Codex work session, run `npm run dev` automatically so the user does not have to start it manually.
- Only run `npm run dev` once per session/task unless it crashes or needs to be restarted.
- Before running it, check whether the dev server is already running. If it is already running, reuse the existing server instead of starting another one.
- If the dev server starts successfully, open the local preview/browser inside Codex so the user can see the app quickly.
- Do not repeatedly start duplicate dev servers.
- If the port is already in use, identify the existing dev server URL and open that instead.
- If `npm run dev` fails, summarize the key error lines and fix the root cause if it is related to the task.
- Keep the dev server running in the background while working when possible.
- Do not ask the user to run `npm run dev` manually unless Codex lacks terminal access or the command requires user action that Codex cannot provide.

## Android APK Build Rule
- When creating or preparing an Android APK, never include or enable the "Enter Developer Mode" button.
- Developer Mode is only for local laptop/development use.
- Production, deployed web, and Android APK builds must hide Developer Mode from normal users.
- Do not reintroduce Developer Mode into APK builds unless the user explicitly asks for a private developer-only build.

## iOS PWA App-Shell Rule
- In the installed iPhone/Home Screen web app, the top navigation and bottom action/search dock must remain anchored.
- Only the central content/member list should scroll.
- Use dynamic viewport units and iOS safe-area insets.
- Account for the visual viewport when the software keyboard opens.
- Do not use body/document scrolling for core app screens.
- Do not place fixed or sticky navigation inside transformed or incorrectly overflowing ancestors.
- Do not apply global overflow rules without verifying Settings, Export Center, modals, and other routes.
- Test iPhone standalone/PWA behavior after changes to Dashboard layout, headers, bottom controls, search, modals, or viewport CSS.

## Mobile Form Keyboard-Safety Rule
- Add, Edit, and Complete Missing Info forms must use a fixed modal/sheet shell with an internally scrolling body and an accessible action footer.
- Save, Cancel, and Add Member actions must remain visible above the mobile keyboard.
- Dismiss the keyboard when users move from text input to attendance, accordions, selectors, or other non-text controls where appropriate.
- Never allow the document body to scroll behind an open form/modal.
- Reuse the central visual viewport handling instead of adding conflicting keyboard calculations.
- Test the iPhone keyboard and autofill accessory bar after changing forms, modal layouts, attendance controls, or sticky action footers.

## Keyboard-Open Search Mode
- Do not permanently shrink normal member cards just to fit the mobile keyboard.
- While the software keyboard/search input is active, use compact readable member result rows.
- Automatically dismiss the keyboard before opening member details, Add Member, scanner, or other views needing more space.
- Restore normal full cards when the keyboard closes.
- Preserve fixed top navigation, fixed bottom search dock, and central internal scrolling.

## Known Issues/Product Reliability Backlog
- Team & Sharing previously displayed workspace collaborators but later showed `0` because the UI and invite flow drifted from the canonical collaborator data shape. Fix the existing sharing workflow before adding any separate collaborator system.
- App collaborators are separate from Supabase dashboard collaborators. Do not assume people listed in the Supabase project dashboard automatically have DatSer app workspace access.
- Admin Code Login needs owner/admin management from inside the app so the owner can rotate the hashed admin code and maintain the same collaborator records used by Team & Sharing.
- If collaborator records look empty or stale, first check `collaborators.email`, `collaborators.collaborator_email`, `collaborator_user_id`, `status`, and the Team & Sharing fetch logic before building a new table.
- A future secure Management API import can be considered for discovering Supabase dashboard users, but it must stay optional and must not expose service-role secrets to the frontend.
- Collaborator login can fail when an app-level collaborator row exists but the Supabase Auth password/login account is missing or the password is unset; show a reset/resend path instead of treating the row as fully ready.
- Team & Sharing must not depend on direct frontend access to protected `auth.users` or forbidden user tables; use owner/admin-safe RPCs for collaborator display and account status.
- Workspace override must save through a secure owner/admin RPC and must affect collaborator views consistently after refresh or realtime/background sync.
- Member Pass Share must behave like a bottom sheet on mobile/tablet and keep desktop positioning balanced.
- Notifications should be centralized, deduped, fast to dismiss, and clear about member/action/time for attendance feedback.
- QR expand/collapse animations must stay GPU-friendly and must not re-render or layout-animate the QR code repeatedly.
- Export Center needs polished responsive UI across desktop/tablet/mobile.
- Advanced options dropdown must be easy to use and accessible.
- Month comparison should fetch historical data only when opened to avoid unnecessary Supabase usage.
- Export Center animations must be lightweight and mobile-friendly.
- Dark mode and light mode must both be maintained.

## Canonical Member Identity
- All member mutations must use stable canonical identity, including the source monthly table, workspace owner, member UUID, and a minimal identity hint for recovery.
- A zero-row update must preserve form data, perform one safe owner-scoped lookup, and return a clear retryable error if the member still cannot be resolved.
- Never create a new member as an automatic fallback for a failed update, and never create silent duplicates.

## Design System
- Read `docs/DESIGN_SYSTEM.md` before making UI changes.
- Use the shared design tokens and reusable components before adding local styling.
- Do not introduce arbitrary colors, fonts, radii, spacing, sizes, or animations.

## Attendance Controls
- Use the shared `AttendanceChoice` component for Present, Absent, and Clear interactions.
- Preserve instant selected feedback, per-item saving/queued/error states, keyboard dismissal, accessibility labels, and reduced-motion behavior.

## Global Tag Visibility Rule
- The Show Tags setting is the single source of truth for optional member-tag visibility.
- Show Tags defaults to OFF when no saved preference exists.
- Add Member, Edit Member, Complete Missing Info, Members, Marked, Member Details, Search, and all other applicable views must follow the same setting.
- Turning tags off hides tag controls and displays but must never delete saved tag assignments.
- Turning tags back on must restore previously saved tags.
- Individual components must not use separate or hardcoded tag visibility defaults.
- Essential member codes, attendance states, validation messages, and system labels must not be treated as optional tags.

## Mobile Keyboard Safety
- Preserve the fixed app shell and the single central visual viewport system.
- Forms must use internally scrolling bodies with accessible headers and action footers above the keyboard.
- Do not add competing keyboard-height calculations or allow the document body to scroll behind a modal.

## Offline Reliability
- Use the IndexedDB-backed idempotent mutation queue for safe member and attendance changes.
- Store canonical identity, workspace scope, table/date, retry metadata, and only the minimum mutation payload; never store credentials or secrets.
- Compatible edits must coalesce, newest attendance intent must win, and no change may be silently lost, duplicated, or overwrite newer remote data.
- Be explicit that iOS does not guarantee background sync while a PWA is fully closed; flush on reopen, focus, reconnect, and visibility restore.

## Reliability Testing
- Do not depend on a live Sunday service for primary testing.
- Use synthetic data, unit/database tests, Playwright, two-account test workspaces, offline/reconnect tests, visual checks, and `npm run test:service-simulation`.
- Never run destructive tests against real production members or attendance rows.

## APK Rule
- Never display **Enter Developer Mode** in production, deployed web, or Android APK builds.
- Developer Mode is restricted to local laptop development on localhost and must remain disabled in native runtimes.

## Search and Deleted-Member Rule
- Deleted or soft-deleted members must not appear in active search.
- Exact, partial, and suggested matches must be clearly distinguished.
- Search counts and visible results must use the same source of truth.
- Debug information must remain development-only.
- Stale cache must never reintroduce deleted members.

## Member Search Rule
- Search must match any meaningful part of a member's full name, including first, middle, and surname tokens in any order.
- Member and guardian phone numbers must be searchable through normalized digits without exposing private numbers in results.
- Phone, tablet, and desktop must use the same authoritative active-member search dataset.
- Deleted members and stale cached records must never appear, and result counts must match the visible cards.

## Member Code Format Rule
- Development continues from stable `main`; `search-bar-experiment` remains separate and must not be merged automatically.
- Supported workspace member-code formats are Letters + Numbers, Letters Only, and Numbers Only.
- Both Letters Only and Numbers Only toggles being off means Letters + Numbers.
- Letters Only and Numbers Only are mutually exclusive.
- Letters-only codes use a deterministic alphabetical sequence.
- Numbers-only codes use a minimum three-digit sequence such as 001, 002 and 500, expanding beyond 999 when needed.
- Member-code format is workspace-wide and shared by collaborators.
- Conversions must be transactional and concurrency-safe.
- Search, badges, QR codes, scanners, passes, exports, caches, and forms must use the same current format.
- Exact code searches must return the exact matching member rather than the full list.
- Changing the format must never leave a partially converted workspace.

## Member Code Length Rule
- Workspace member codes use a configurable length from 3 to 6 characters and existing workspaces default to 3.
- Letters Only starts AAA, AAB, AAC and must never create one-character active codes.
- Numbers Only starts 001, 002, 003 and must never assign 000.
- Format and length are shared by collaborators, capacity-checked, and changed atomically.
- Badges, search, QR, scanner, passes, exports, and caches use the same confirmed format and length.

## Search Safety Rule
- Member search must never crash from user input; test 0, 00, and 000 explicitly.
- Search helpers must be in scope, defensive, and always return stable result types.
- Exact code matches rank above code prefixes, names, and phone matches.
- Short code prefixes must not return the unrelated full member list.

## Member Code Persistence Rule
- Confirmed Supabase workspace format and length remain active until an authorized user changes them.
- Startup must not overwrite confirmed values with temporary defaults or stale local cache.
- Cache may improve startup, but Supabase is authoritative and realtime updates must reach collaborators without manual refresh.

## Attendance Count Consistency Rule
- Attendance totals must derive from deduplicated active canonical members, not raw cached map entries.
- Local optimistic attendance updates must update totals immediately; stale refresh responses must never overwrite newer state.
- Realtime events must merge idempotently, and Manual Refresh Data must produce the same final total.
- Cached and remote copies must never be double-counted.

## Android Attendance Interaction Rule
- Present and Absent must use one canonical mutation path across Android, tablet, desktop, and compact cards.
- No overlay may block attendance controls, and competing touch and click handlers must never submit twice.
- Failed mutations must reset loading state and preserve a retryable action.
- Zero-row updates perform one safe canonical recovery and never create duplicates.

## PWA Resume Stability Rule
- Returning from another app must preserve the visible DatSer interface.
- Resume/focus must not clear state, remount the app, flash themes, or show full-page loaders.
- Deduplicate closely grouped lifecycle refresh triggers.
- Refresh in the background and merge only changed data.

## Parent and Guardian Form Rule
- Parent/Guardian Info must remain visible and must not be hidden in an accordion.
- Parent/Guardian 1 remains required according to existing rules.
- Parent/Guardian 2 remains optional.
- Add, Edit, and Complete Missing Info must share the same design, validation, and saving behavior.

## Attendance Visual Rule
- Member cards use two equal full-width actions: Present and Absent.
- Member-card Present uses DatSer orange.
- Member-card Absent uses DatSer red.
- Editable attendance forms use three equal full-width choices: Present, Absent, and Clear.
- Selected Present may use confirmed green in editable forms/history.
- Do not leave unused trailing layout space.
- Use shared tokens and components.

## Member Codes Accent Rule
- Member Codes uses the semantic deep-blue feature accent.
- Member Codes components must consume the shared Member Codes tokens and must not hardcode local blue, orange, yellow, or amber values for feature icons, labels, or status states.
