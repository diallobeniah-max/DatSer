REVOKE ALL ON FUNCTION public.accept_invite_for_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_admin_code_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_login_code(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.relink_collaborators_for_owner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_collaborator(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_collaborator(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.accept_invite_for_user(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_admin_code_status() FROM anon;
REVOKE ALL ON FUNCTION public.set_admin_login_code(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.relink_collaborators_for_owner(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.activate_collaborator(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.disable_collaborator(UUID) FROM anon;

GRANT EXECUTE ON FUNCTION public.accept_invite_for_user(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_code_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_login_code(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.relink_collaborators_for_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_collaborator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_collaborator(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.verify_admin_code_login(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_code_login(TEXT) TO authenticated;;
