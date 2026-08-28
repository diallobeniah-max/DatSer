
-- ============================================
-- Migration 2: Enable RLS + Policies
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_month_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- ---- user_preferences ----
CREATE POLICY "Users can view own preferences"
  ON public.user_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON public.user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON public.user_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own preferences"
  ON public.user_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- ---- collaborators ----
-- Owners can do everything with their own collaborator rows
CREATE POLICY "Owners can view own collaborators"
  ON public.collaborators FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Owners can insert collaborators"
  ON public.collaborators FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update own collaborators"
  ON public.collaborators FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can delete own collaborators"
  ON public.collaborators FOR DELETE
  USING (auth.uid() = owner_id);

-- Collaborators can read rows where their email matches
CREATE POLICY "Collaborators can view invitations to them"
  ON public.collaborators FOR SELECT
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
  );

-- ---- user_month_tables ----
CREATE POLICY "Users can view own month tables"
  ON public.user_month_tables FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own month tables"
  ON public.user_month_tables FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own month tables"
  ON public.user_month_tables FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own month tables"
  ON public.user_month_tables FOR DELETE
  USING (auth.uid() = user_id);

-- Collaborators can read month tables of their owner
CREATE POLICY "Collaborators can view owner month tables"
  ON public.user_month_tables FOR SELECT
  USING (
    user_id IN (
      SELECT owner_id FROM public.collaborators
      WHERE lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      AND status IN ('pending', 'accepted', 'active')
    )
  );

-- ---- activity_logs ----
CREATE POLICY "Users can insert activity logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (auth.uid() = actor_id);

CREATE POLICY "Users can view own activity logs"
  ON public.activity_logs FOR SELECT
  USING (
    auth.uid() = actor_id
    OR auth.uid() = target_owner_id
  );
;
