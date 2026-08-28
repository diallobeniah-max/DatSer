
-- Add invite tracking columns to collaborators table
ALTER TABLE public.collaborators 
  ADD COLUMN IF NOT EXISTS invite_token text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '7 days'),
  ADD COLUMN IF NOT EXISTS invited_by_name text,
  ADD COLUMN IF NOT EXISTS collaborator_user_id uuid REFERENCES auth.users(id);

-- Create index on invite_token for fast lookups
CREATE INDEX IF NOT EXISTS idx_collaborators_invite_token ON public.collaborators(invite_token);

-- Create index on collaborator_user_id for fast lookups  
CREATE INDEX IF NOT EXISTS idx_collaborators_collaborator_user_id ON public.collaborators(collaborator_user_id);

-- Update the status check constraint to include 'expired' status
ALTER TABLE public.collaborators DROP CONSTRAINT IF EXISTS collaborators_status_check;
ALTER TABLE public.collaborators ADD CONSTRAINT collaborators_status_check 
  CHECK (status = ANY (ARRAY['pending', 'accepted', 'active', 'rejected', 'expired']));

-- Function to auto-accept collaborator when they sign in
-- Called after a user logs in via invite link
CREATE OR REPLACE FUNCTION public.accept_invite_for_user(user_email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  collab_record record;
  result json;
BEGIN
  -- Find pending invite for this email
  SELECT * INTO collab_record
  FROM public.collaborators
  WHERE email = lower(user_email)
    AND status IN ('pending', 'active')
  ORDER BY created_at DESC
  LIMIT 1;

  IF collab_record IS NULL THEN
    RETURN json_build_object('accepted', false, 'reason', 'No pending invite found');
  END IF;

  -- Update status to accepted
  UPDATE public.collaborators
  SET status = 'accepted',
      collaborator_user_id = auth.uid()
  WHERE id = collab_record.id;

  RETURN json_build_object(
    'accepted', true, 
    'owner_id', collab_record.owner_id,
    'collaborator_id', collab_record.id
  );
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.accept_invite_for_user(text) TO authenticated;
;
