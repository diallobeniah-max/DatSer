
-- ============================================
-- Migration 1: Core Tables
-- ============================================

-- 1. user_preferences
CREATE TABLE public.user_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_name TEXT,
  theme TEXT DEFAULT 'light',
  font_size TEXT DEFAULT '14px',
  font_family TEXT DEFAULT 'Inter',
  selected_month_table TEXT,
  badge_filter JSONB,
  current_month_table TEXT,
  admin_sticky_month TEXT,
  admin_sticky_year INTEGER,
  admin_sticky_sundays TEXT[],
  owner_id UUID,
  command_k_enabled BOOLEAN DEFAULT true,
  animations_enabled BOOLEAN DEFAULT true,
  reduced_motion BOOLEAN DEFAULT false,
  high_contrast BOOLEAN DEFAULT false,
  focus_visible BOOLEAN DEFAULT true,
  performance_mode BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. collaborators
CREATE TABLE public.collaborators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'active', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, email)
);

-- 3. user_month_tables
CREATE TABLE public.user_month_tables (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  month_year TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, table_name)
);

-- 4. activity_logs
CREATE TABLE public.activity_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  details TEXT,
  target_owner_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
;
