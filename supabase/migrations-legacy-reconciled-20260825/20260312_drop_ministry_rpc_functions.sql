-- Drop ministry-related RPC functions
DROP FUNCTION IF EXISTS set_collaborators_ministry_groups(UUID, TEXT[]) CASCADE;
DROP FUNCTION IF EXISTS update_ministry_groups(TEXT[], UUID) CASCADE;
