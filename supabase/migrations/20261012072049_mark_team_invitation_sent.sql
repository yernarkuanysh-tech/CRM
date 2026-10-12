-- Records delivery only after the email provider accepts the invitation message.
-- The caller remains user-scoped; this function independently requires an owner.
create function public.mark_invitation_sent(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  invite_email text;
begin
  perform private.require_owner();
  update private.invitations set sent_at = now() where id = p_id returning email into invite_email;
  if not found then perform private.fail('Приглашение не найдено.', 'P0002'); end if;
  perform private.audit('staff_invite_sent', invite_email);
end $$;

revoke execute on function public.mark_invitation_sent(uuid) from public, anon, authenticated;
grant execute on function public.mark_invitation_sent(uuid) to authenticated;
