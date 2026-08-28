DROP POLICY IF EXISTS "Users can view own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can insert own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can update own preferences" ON public.user_preferences;
DROP POLICY IF EXISTS "Users can delete own preferences" ON public.user_preferences;

CREATE POLICY "Users and collaborators can view workspace preferences"
ON public.user_preferences
FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND c.status IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM auth.users au
          WHERE au.id = auth.uid()
            AND (c.email = au.email OR c.email ILIKE au.email)
        )
      )
  )
);

CREATE POLICY "Users and collaborators can insert workspace preferences"
ON public.user_preferences
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND c.status IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM auth.users au
          WHERE au.id = auth.uid()
            AND (c.email = au.email OR c.email ILIKE au.email)
        )
      )
  )
);

CREATE POLICY "Users and collaborators can update workspace preferences"
ON public.user_preferences
FOR UPDATE
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND c.status IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM auth.users au
          WHERE au.id = auth.uid()
            AND (c.email = au.email OR c.email ILIKE au.email)
        )
      )
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.owner_id = user_preferences.user_id
      AND c.status IN ('accepted', 'active')
      AND (
        c.collaborator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM auth.users au
          WHERE au.id = auth.uid()
            AND (c.email = au.email OR c.email ILIKE au.email)
        )
      )
  )
);

CREATE POLICY "Users can delete own preferences"
ON public.user_preferences
FOR DELETE
USING (auth.uid() = user_id);;
