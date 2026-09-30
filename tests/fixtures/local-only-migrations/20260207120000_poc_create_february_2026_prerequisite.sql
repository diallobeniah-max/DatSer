-- POC-only bootstrap reconciliation.
-- Production created February_2026 dynamically, so the historical policy
-- migrations assume this table already exists. Reproduce that canonical path
-- locally after January_2026 exists and before February policies are applied.
select public.create_month_from_current(
  'January_2026',
  'February_2026',
  array['2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22']
);
