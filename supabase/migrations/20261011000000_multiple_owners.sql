-- Allows several owners. Owners can promote staff to owner and back from the team screen;
-- each owner keeps their own recovery code, and the workspace always keeps one active owner.

drop index private.profiles_single_owner;

-- Recovery codes now belong to one owner. Existing codes were created by the single owner.
alter table private.owner_recovery add column user_id uuid references private.profiles on delete cascade;
update private.owner_recovery set user_id = (select id from private.profiles where role = 'owner');
delete from private.owner_recovery where user_id is null;
alter table private.owner_recovery alter column user_id set not null;
create unique index owner_recovery_user on private.owner_recovery (user_id);

-- Serializes role and status changes so two owners cannot remove each other at the same time.
create function private.lock_roles() returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtext('crm_roles'));
$$;

create function private.require_active_owner_left() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.profiles where role = 'owner' and status = 'active') then
    perform private.fail('В CRM должен остаться хотя бы один активный владелец.', '23514');
  end if;
end $$;

create or replace function public.crm_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me private.profiles;
  ws private.workspace;
  result jsonb;
begin
  select * into me from private.profiles where id = auth.uid() and status = 'active';
  if not found then return null; end if;
  select * into ws from private.workspace where id = 1;
  result := jsonb_build_object(
    'organization', ws.organization,
    'year', ws.year,
    'teamCount', private.seats_used(),
    'currentUser', jsonb_build_object('id', me.id, 'email', me.email, 'name', me.name, 'role', me.role));
  if me.role = 'owner' then
    result := result || jsonb_build_object('name', me.name, 'email', me.email,
                                           'recoveryEnabled', exists (select 1 from private.owner_recovery where user_id = me.id));
  end if;
  return result;
end $$;

-- Creates a new recovery code for the calling owner (shown once; only its hash is stored).
create or replace function public.create_recovery_code(p_current_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me private.profiles := private.require_owner();
  code text := private.new_token();
begin
  if not exists (select 1 from auth.users where id = me.id and encrypted_password = extensions.crypt(coalesce(p_current_password, ''), encrypted_password)) then
    perform private.fail('Неверный текущий пароль.', '28P01');
  end if;
  delete from private.owner_recovery where user_id = me.id;
  insert into private.owner_recovery (hash, user_id) values (private.token_hash(code), me.id);
  perform private.audit('recovery_created');
  return code;
end $$;

-- Resets an owner's password with their own recovery code; the code is single-use.
create or replace function public.recover_owner_password(p_email text, p_code text, p_new_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare owner private.profiles;
begin
  perform private.check_password(p_new_password);
  select * into owner from private.profiles where role = 'owner' and email = lower(btrim(coalesce(p_email, '')));
  if not found or not exists (select 1 from private.owner_recovery
                              where user_id = owner.id and hash = private.token_hash(btrim(coalesce(p_code, '')))) then
    perform private.fail('Неверная почта или резервный код.', '28P01');
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() where id = owner.id;
  delete from private.owner_recovery where user_id = owner.id;
  perform private.end_sessions(owner.id);
  insert into private.audit (actor, event) values (owner.id, 'password_recovered');
end $$;

-- Team list now includes the other owners (everyone except the caller), with their role.
create or replace function public.team_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  delete from private.invitations where expires_at <= now();
  return jsonb_build_object(
    'limit', 10,
    'used', private.seats_used(),
    'mailConfigured', false,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'name', name, 'role', role, 'status', status, 'createdAt', created_at)
                                          order by role, status, email)
                         from private.profiles where id <> auth.uid()), '[]'),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'name', name, 'createdAt', created_at,
                                                                 'expires', (extract(epoch from expires_at) * 1000)::bigint, 'sentAt', sent_at) order by created_at desc)
                             from private.invitations), '[]'));
end $$;

-- Enables or disables another member (staff or owner); disabling ends their sessions at once.
create or replace function public.set_staff_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.profiles;
begin
  perform private.lock_roles();
  perform private.require_owner();
  if p_status not in ('active', 'disabled') then perform private.fail('Неизвестный статус.', '22023'); end if;
  if p_id = auth.uid() then perform private.fail('Нельзя изменить собственный доступ.', '42501'); end if;
  select * into member from private.profiles where id = p_id for update;
  if not found then perform private.fail('Сотрудник не найден.', 'P0002'); end if;
  if member.role = 'staff' and p_status = 'active' and member.status <> 'active' and private.seats_used() >= 10 then
    perform private.fail('Достигнут лимит: 10 сотрудников.', '23514');
  end if;
  update private.profiles set status = p_status where id = p_id;
  perform private.require_active_owner_left();
  if p_status = 'disabled' then perform private.end_sessions(p_id); end if;
  perform private.audit(case when p_status = 'active' then 'staff_enabled' else 'staff_disabled' end, member.email);
  return public.team_overview();
end $$;

-- Promotes a staff member to owner or demotes an owner to staff.
create function public.set_member_role(p_id uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.profiles;
begin
  perform private.lock_roles();
  perform private.require_owner();
  if p_role not in ('owner', 'staff') then perform private.fail('Неизвестная роль.', '22023'); end if;
  if p_id = auth.uid() then perform private.fail('Нельзя изменить собственную роль.', '42501'); end if;
  select * into member from private.profiles where id = p_id for update;
  if not found then perform private.fail('Сотрудник не найден.', 'P0002'); end if;
  if member.role = p_role then return public.team_overview(); end if;
  if p_role = 'staff' and member.status = 'active' and private.seats_used() >= 10 then
    perform private.fail('Достигнут лимит: 10 сотрудников.', '23514');
  end if;
  update private.profiles set role = p_role where id = p_id;
  perform private.require_active_owner_left();
  if p_role = 'staff' then delete from private.owner_recovery where user_id = p_id; end if;
  perform private.audit(case when p_role = 'owner' then 'owner_granted' else 'owner_revoked' end, member.email);
  return public.team_overview();
end $$;

revoke execute on function private.lock_roles(), private.require_active_owner_left() from public, anon, authenticated;
revoke execute on function public.set_member_role(uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_role(uuid, text) to authenticated;
