
-- ============================================
-- Migration 4: Enable Realtime
-- ============================================

-- Enable realtime for core tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_preferences;
ALTER PUBLICATION supabase_realtime ADD TABLE public.collaborators;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_month_tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
;
