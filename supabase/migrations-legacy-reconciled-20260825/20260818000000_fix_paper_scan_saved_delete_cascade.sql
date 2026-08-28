-- Fix Saved Scan deletion when Final Save operations exist.
--
-- paper_scan_save_operations references paper_scan_saved with ON DELETE RESTRICT,
-- so deleting a Saved Scan fails once a Final Save operation has been recorded.
-- Operations and their steps are saved-scan-only dependent records, not member
-- or attendance data. Cascade them so deleting the Saved Scan removes only its
-- dependent operation ledger and never touches month/member/attendance rows.

alter table public.paper_scan_save_operations
  drop constraint if exists paper_scan_save_operations_saved_scan_id_fkey;

alter table public.paper_scan_save_operations
  add constraint paper_scan_save_operations_saved_scan_id_fkey
  foreign key (saved_scan_id)
  references public.paper_scan_saved(id)
  on delete cascade;

-- Cascades are enforced by the foreign-key trigger; browser clients must not
-- gain a direct DELETE surface on the private operation or step ledgers.
revoke delete on public.paper_scan_save_operations, public.paper_scan_save_steps
  from public, anon, authenticated;
