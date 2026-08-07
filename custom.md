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

## Member Code Hydration Rule
- Name and phone search must not depend on member-code assignment readiness.
- Matching members remain visible while codes are loading.
- Member-code assignments must merge immutably and rerender badges without requiring another search input.
- The first search and an identical repeated search must return the same canonical members.
- Code hydration must never replace complete search results with a partial member list.
- Format and length changes must update visible codes after confirmation without clearing valid member results.
- Member cards use canonical member IDs as React keys, never display codes or array positions.

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

## Complete Member Code Assignment Rule
- Workspace member-code assignments hydrate from the authoritative workspace assignment store before member-card rendering depends on them.
- Assignment lookups, badges, search, QR/passes, and realtime updates use one stable canonical member identity, not a row position or preview-only identifier.
- Cache may show the last confirmed assignment snapshot immediately, but remote assignments reconcile in full pages and remain authoritative.
- Automatic allocation runs only after the complete current member index is available and only for genuinely unassigned canonical members.
- Adding a member requests a code assignment immediately after the member record is confirmed; editing a member never changes its code.
- Loading, syncing, and assignment failures keep existing confirmed codes visible and never replace them with synthetic or partial assignments.

## Immediate Member Code Allocation Rule
- Successful Add Member completion includes a confirmed canonical member ID and confirmed member-code assignment.
- New members appear immediately in local state and do not wait for a full refresh.
- Editing, searching, or reopening a member must never be required to create their code.
- Every active canonical member requiring a code must have exactly one confirmed workspace assignment.
- Confirmed codes load from a workspace-scoped cache before background reconciliation.
- Remote refresh must not blank last-confirmed badges.
- Missing assignments are recovered automatically through one deduplicated batched queue.
- Search filters existing member data and must never control code creation or hydration.
- Realtime confirmations merge idempotently and never duplicate members or assignments.

## Stable Member Search Rule
- Search results are deduplicated only by canonical member ID, never by name.
- Members with the same or similar names remain separate and must all appear.
- Local name search is immediate and does not depend on code hydration.
- Current valid results remain visible while background data reconciles.
- Partial preview rows must never replace complete member records.
- Stale async responses cannot replace results for a newer query.
- The first and repeated identical query return the same canonical member IDs.

## Stable Members and Marked Rule
- Members and Marked derive from the same authoritative canonical member store.
- Sync, realtime, attendance, and code hydration must not clear confirmed visible cards.
- New state is applied atomically; intermediate empty lists must not flash.
- Repeated app focus/resume events are coalesced into one synchronization pass.

## Add Member Code Rule
- Add Member completion includes the canonical member and confirmed code.
- The final success state is not shown before code allocation confirms.
- Collaborators use the workspace owner scope when allocating codes.
- Temporary allocation failure enters a deduplicated automatic recovery queue.
- Search, editing, refreshing, or reopening must never be required to create a member code.

## Incremental Member Code Allocation Rule
- Adding one member allocates only that member’s code.
- Normal allocation must never invoke full workspace code conversion.
- Code allocation is transaction-locked and returns only requested assignments.
- Code length is a minimum display width and numeric codes expand safely beyond it when needed.
- Typing a name may show a provisional next-code preview but must not reserve a code.
- Final allocation happens only after the member is successfully saved.

## Single-Flight Sync Rule
- Mount, focus, visibility, reconnect, realtime, and manual refresh use one coalesced synchronization coordinator.
- Schema metadata is cached and never fetched repeatedly per render.
- State written by a sync cannot immediately trigger another identical sync.
- Members, Marked, attendance, and code badges retain last-confirmed content during reconciliation.
- Stale responses cannot replace newer state.

## Local-First Realtime Rule
- Search always filters the local canonical member index and never performs network work while typing.
- The initiating mutation merges its confirmed database response immediately and never waits for Realtime.
- Realtime exists for targeted cross-device convergence.
- Realtime events patch only affected records and do not trigger full workspace reloads.
- One stable Realtime channel exists per active workspace.
- Cached confirmed members, codes, and attendance remain visible during reconciliation.
- Realtime connection failure must not clear current state.
- Reconnect runs one coalesced recovery sync.

## Monthly Realtime Publication Rule
- Every active monthly table must be included in the Supabase Realtime publication.
- Month creation automatically configures Realtime, RLS, indexes, and required columns.
- Schema-management RPCs are never called repeatedly by ordinary page rendering or search.
- Future month tables must not require manual publication repair.

## Live Request-Count Verification Rule
- A caching fix is incomplete until live Supabase logs confirm request counts decreased.
- Cache both resolved metadata and in-flight Promises.
- Use browser Network Initiator evidence to identify repeated call sites.
- Do not claim a request loop is fixed using unit tests alone.
- An idle authenticated session must not repeatedly fetch schema, attendance, members, or assignments.
- Search typing generates no network traffic.
- Add Member performs focused mutation requests and does not trigger a full workspace refresh.

## PWA Build Freshness Rule
- Every production build exposes its commit/build identifier.
- The service worker must not leave users running obsolete application JavaScript indefinitely.
- Updating static caches must preserve IndexedDB and offline member data.
- Real-device testing must verify that the installed PWA is running the expected commit.

## Runtime Schema Rule
- Normal application rendering must not call runtime schema-introspection RPCs.
- Attendance columns are derived deterministically from the active month and Sunday dates.
- Schema discovery belongs to explicit developer, migration, or recovery tools only.

## Shared Request Registry Rule
- Members, attendance, member codes, and schema fallbacks use one module-level request registry keyed by workspace, table, and request type.
- The registry reuses resolved data and in-flight promises across React mounts and StrictMode remounts.
- Failed requests remain retryable and never erase the last confirmed result.
- Scope changes invalidate only the previous workspace or table entries.

## Immediate Add Member Rule
- A confirmed Add Member response is merged directly into members, search, code assignments, and local caches.
- Add Member must not trigger a full member, attendance, badge, or workspace reconciliation.
- Realtime confirmation merges idempotently and does not duplicate the initiating member.

## Realtime Singleton Rule
- Exactly one physical Realtime subscription exists per active workspace and month.
- React remounts reuse the shared channel instead of creating duplicate subscriptions.
- Realtime events from the monthly member table patch only the affected member and attendance values; code and preference events patch only their matching state.
- Workspace, month, logout, and genuine shutdown changes release the previous channel cleanly.

## Runtime Symbol Safety Rule
- `npm run lint` with `no-undef: error` must pass with zero errors before every production build.
- Every function, variable, and import referenced in source must be defined or imported in its file scope.
- Dead-code branches (`{false && ...}`, `{false ? ... : null}`) that reference undefined symbols must be removed, not left guarded.
- Renaming or moving a utility function requires updating every call site and import in the same commit.

## Production Crash Hotfix Rule
- A production crash fix is not complete until `npm run lint` returns zero errors, `npm run build` succeeds, and the broken symbol is confirmed absent from `dist/`.
- The fix must be committed to `main` and pushed to `origin/main` so Vercel deploys the corrected bundle.
- The commit message must describe the specific crash (e.g., the undefined symbol name) not a generic "fix bug".

## Search Other Months Rule
- Normal search remains local and network-free.
- Cross-month search runs only after the user explicitly taps Search Other Months.
- Results are limited to the active workspace’s authorized monthly tables.
- Historical copies are deduplicated only by canonical member ID.
- Same-name members with different IDs remain separate.
- Historical search does not create Realtime subscriptions to old months.

## Historical Member Present Rule
- Presenting a member from another month preserves the canonical member ID and workspace code.
- The operation copies safe profile fields only.
- Historical attendance is never copied.
- Only the selected current-month attendance date is marked Present.
- Existing current-month members are never duplicated.
- Soft-deleted canonical members are restored rather than duplicated.
- The operation is transactional and idempotent.
- The initiating device merges the returned member, code, and attendance immediately.

## Dangerous Bulk Copy Rule
- `insert_selected_members` must never be used for incremental member recovery or attendance.
- Any function that deletes all target rows is forbidden in normal member import flows.
- Incremental recovery must never delete, truncate, or reset the current month.
