# DatSer Reliability Testing

DatSer reliability checks use synthetic records only. Never point destructive tests at real church members or attendance rows.

## Commands

- `npm run test:service-simulation` runs deterministic queue/realtime tests and the local developer-mode browser simulation.
- `npm test` runs the complete unit/component suite.
- `npm run test:smoke` validates the local application shell, keyboard-safe forms, notifications, and developer launchers.
- `npm run test:smoke:prod` validates the production build and confirms local Developer Mode is hidden.

## What the service simulation covers

- newest Present/Absent/Clear intent wins;
- repeated member edits merge without dropping guardian, level, or tag fields;
- stale or duplicated realtime events cannot replace queued local intent;
- final marked counts come from one attendance map;
- mobile attendance feedback is immediate while offline;
- reconnect does not remove the optimistic choice;
- Add Member actions remain accessible in the keyboard-safe sheet.

The synthetic identifiers use the `synthetic-` prefix and the non-production table name `Synthetic_July_2099`. The deterministic unit simulation does not call Supabase. Browser simulation uses local Developer Mode and does not create production rows.

## Database and collaborator verification

Before a release, verify on a non-production/test workspace:

1. canonical member RPCs return exactly one target for a valid member;
2. owner and active collaborator RLS policies permit the required reads and writes;
3. member and normalized attendance tables are in the realtime publication;
4. two authenticated browser contexts receive member and attendance changes;
5. reconnect flushes IndexedDB mutations once, without duplicate rows;
6. final Present/Absent totals match a direct source-of-truth query.

Authenticated two-account tests require test-account credentials supplied through the test environment. They must remain skipped when those credentials are absent; do not substitute production accounts.

## Failure evidence

Playwright writes screenshots and traces under `test-results/`. Keep generated evidence untracked unless it is intentionally captured as a reviewed baseline. Report the first actionable failure and preserve the full artifact path.

## iOS limitation

An installed iPhone PWA preserves IndexedDB work while closed, but iOS does not guarantee background sync for a fully terminated PWA. DatSer flushes queued work immediately when reopened, focused, or reconnected.
