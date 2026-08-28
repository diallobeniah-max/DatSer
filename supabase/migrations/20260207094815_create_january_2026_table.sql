
-- Create January_2026 month table
CREATE TABLE public."January_2026" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "Full Name" TEXT,
  "Gender" TEXT,
  "Phone Number" BIGINT,
  "Age" INTEGER,
  "Current Level" TEXT,
  inserted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  "Member" TEXT,
  "Regular" TEXT,
  "Newcomer" TEXT,
  "Manual Badge" TEXT,
  "Badge Type" TEXT,
  parent_name_1 TEXT,
  parent_phone_1 TEXT,
  parent_name_2 TEXT,
  parent_phone_2 TEXT,
  user_id UUID,
  workspace TEXT,
  notes TEXT,
  ministry TEXT,
  is_visitor BOOLEAN DEFAULT false,
  attendance_2026_01_04 TEXT,
  attendance_2026_01_11 TEXT,
  attendance_2026_01_18 TEXT,
  attendance_2026_01_25 TEXT
);

-- Enable RLS
ALTER TABLE public."January_2026" ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own rows" ON public."January_2026"
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT owner_id FROM public.collaborators
      WHERE lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      AND status IN ('pending', 'accepted', 'active')
    )
  );

CREATE POLICY "Users can insert own rows" ON public."January_2026"
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own rows" ON public."January_2026"
  FOR UPDATE USING (
    user_id = auth.uid()
    OR user_id IN (
      SELECT owner_id FROM public.collaborators
      WHERE lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      AND status IN ('pending', 'accepted', 'active')
    )
  );

CREATE POLICY "Users can delete own rows" ON public."January_2026"
  FOR DELETE USING (user_id = auth.uid());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public."January_2026";
;
