-- Drop RPC functions related to ministry groups
DROP FUNCTION IF EXISTS update_ministry_groups(uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS set_collaborators_ministry_groups(uuid, uuid, jsonb) CASCADE;;
