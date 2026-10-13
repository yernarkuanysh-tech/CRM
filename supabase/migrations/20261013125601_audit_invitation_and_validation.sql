-- Compatible with old callers: the new token argument defaults to a server token.
-- A supplied token identifies one attempt, so retries do not renew it or use seats twice.
drop function public.create_invitation(text, text);
create function public.create_invitation(p_email text, p_name text, p_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  invite_email text := lower(btrim(coalesce(p_email, '')));
  invite_name text := btrim(coalesce(p_name, ''));
  token text := coalesce(p_token, private.new_token());
  invite private.invitations;
begin
  perform private.lock_roles();
  perform private.require_owner();
  if invite_email !~ '^\S+@\S+\.\S+$' or length(invite_email) > 254
     or invite_name = '' or length(invite_name) > 100 or token !~ '^[A-Za-z0-9_-]{43}$' then
    perform private.fail('Проверьте имя, email и токен приглашения.', '22023');
  end if;
  if exists (select 1 from private.profiles where email = invite_email) then
    perform private.fail('Участник с такой почтой уже существует. Для отключённого сотрудника включите доступ в списке команды.', '23505');
  end if;
  delete from private.invitations where expires_at <= now();
  select * into invite from private.invitations where email = invite_email for update;
  if found and invite.token_hash = private.token_hash(token) then
    return jsonb_build_object('id', invite.id, 'email', invite.email, 'name', invite.name, 'token', token);
  end if;
  if invite.id is null and private.seats_used() >= 10 then
    perform private.fail('Достигнут лимит: 10 сотрудников.', '23514');
  end if;
  insert into private.invitations (email, name, token_hash)
  values (invite_email, invite_name, private.token_hash(token))
  on conflict (email) do update set name = excluded.name, token_hash = excluded.token_hash,
    created_at = now(), expires_at = now() + interval '7 days', sent_at = null
  returning * into invite;
  perform private.audit('staff_invited', invite_email);
  return jsonb_build_object('id', invite.id, 'email', invite.email, 'name', invite.name, 'token', token);
end $$;

create or replace function public.inspect_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare invite private.invitations;
begin
  if p_token is null or length(p_token) > 200 then perform private.fail('Приглашение недействительно.', '22023'); end if;
  select * into invite from private.invitations where token_hash = private.token_hash(p_token) and expires_at > now();
  if not found then perform private.fail('Приглашение истекло, уже использовано или было отозвано.', 'P0002'); end if;
  return jsonb_build_object('email', invite.email, 'name', invite.name,
    'expires', (extract(epoch from invite.expires_at) * 1000)::bigint,
    'organization', (select organization from private.workspace where id = 1),
    'existingAccount', exists (select 1 from auth.users where lower(email) = invite.email));
end $$;

-- Existing Supabase accounts prove their identity by signing in first. No email or role
-- supplied by the browser is trusted, and disabled members cannot re-enable themselves.
create function public.accept_invitation(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare invite private.invitations; user_email text;
begin
  perform private.lock_roles();
  select lower(email) into user_email from auth.users
    where id = auth.uid() and email_confirmed_at is not null
      and exists (select 1 from auth.sessions s where s.user_id = auth.uid() and s.id::text = auth.jwt() ->> 'session_id');
  if user_email is null then perform private.fail('Войдите с подтверждённой почтой приглашённого аккаунта.', '42501'); end if;
  select * into invite from private.invitations
    where token_hash = private.token_hash(p_token) and email = user_email and expires_at > now() for update;
  if not found then perform private.fail('Приглашение истекло, уже использовано или было отозвано.', 'P0002'); end if;
  if exists (select 1 from private.profiles where id = auth.uid() or email = user_email) then
    perform private.fail('Аккаунт уже состоит в CRM. Для изменения доступа обратитесь к владельцу.', '23505');
  end if;
  if (select count(*) from private.profiles where role = 'staff' and status = 'active') >= 10 then
    perform private.fail('В команде уже 10 сотрудников.', '23514');
  end if;
  insert into private.profiles (id, email, name, role) values (auth.uid(), user_email, invite.name, 'staff');
  delete from private.invitations where id = invite.id;
  perform private.audit('staff_joined', user_email);
end $$;

-- All seat-changing operations use the same advisory lock (role/status updates already do).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'); invite private.invitations; user_email text := lower(new.email);
begin
  perform private.lock_roles();
  if not exists (select 1 from private.profiles where role = 'owner') then
    insert into private.profiles (id, email, name, role)
      values (new.id, user_email, left(coalesce(nullif(btrim(meta ->> 'name'), ''), 'Администратор'), 100), 'owner');
    insert into private.audit (actor, event) values (new.id, 'admin_created');
    return new;
  end if;
  select * into invite from private.invitations
    where token_hash = private.token_hash(meta ->> 'invite_token') and email = user_email and expires_at > now() for update;
  if not found then perform private.fail('Регистрация доступна только по приглашению владельца.', '42501'); end if;
  if (select count(*) from private.profiles where role = 'staff' and status = 'active') >= 10 then
    perform private.fail('В команде уже 10 сотрудников.', '23514');
  end if;
  insert into private.profiles (id, email, name, role)
    values (new.id, user_email, left(coalesce(nullif(btrim(meta ->> 'name'), ''), invite.name), 100), 'staff');
  delete from private.invitations where id = invite.id;
  insert into private.audit (actor, event, detail) values (new.id, 'staff_joined', user_email);
  return new;
end $$;

-- A late provider response must not mark a newer token as sent.
drop function public.mark_invitation_sent(uuid);
create function public.mark_invitation_sent(p_id uuid, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare invite_email text;
begin
  perform private.require_owner();
  update private.invitations set sent_at = coalesce(sent_at, now())
    where id = p_id and token_hash = private.token_hash(p_token) and expires_at > now() returning email into invite_email;
  if not found then perform private.fail('Приглашение уже заменено, использовано или отозвано.', 'P0002'); end if;
  perform private.audit('staff_invite_sent', invite_email);
end $$;

-- Disabling access or revoking sessions also rejects still-unexpired JWTs.
create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.profiles p join auth.users u on u.id = p.id
    where p.id = auth.uid() and p.status = 'active' and u.email_confirmed_at is not null
      and exists (select 1 from auth.sessions s where s.user_id = p.id and s.id::text = auth.jwt() ->> 'session_id')
  );
$$;

create or replace function private.require_member() returns private.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me private.profiles;
begin
  if not private.is_member() then perform private.fail('Войдите в CRM. Сессия завершена или доступ отключён.', '42501'); end if;
  select * into me from private.profiles where id = auth.uid();
  return me;
end $$;

-- Settings use the same access predicate as clients and files.
alter function public.crm_settings() rename to crm_settings_unchecked;
alter function public.crm_settings_unchecked() set schema private;
revoke execute on function private.crm_settings_unchecked() from public, anon, authenticated;
create function public.crm_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member() then return null; end if;
  return private.crm_settings_unchecked();
end $$;

-- A recovery token is checked AND locked before use to prevent concurrent reuse.
create or replace function public.recover_owner_password(p_email text, p_code text, p_new_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare owner private.profiles;
begin
  perform private.check_password(p_new_password);
  select * into owner from private.profiles where role = 'owner' and status = 'active'
    and email = lower(btrim(coalesce(p_email, '')));
  if not found then perform private.fail('Неверная почта или резервный код.', '28P01'); end if;
  perform 1 from private.owner_recovery where user_id = owner.id
    and hash = private.token_hash(btrim(coalesce(p_code, ''))) for update;
  if not found then perform private.fail('Неверная почта или резервный код.', '28P01'); end if;
  update auth.users set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() where id = owner.id;
  delete from private.owner_recovery where user_id = owner.id;
  perform private.end_sessions(owner.id);
  insert into private.audit (actor, event) values (owner.id, 'password_recovered');
end $$;

create function private.valid_date(value text, optional boolean default false) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  if optional and coalesce(value, '') = '' then return true; end if;
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(value::date, 'YYYY-MM-DD') = value;
exception when others then return false;
end $$;

-- Keep prior validation and report immutability; add strict checks because SQL NULL
-- used to let missing fields pass `if not (...)` conditions.
alter function private.validate_client(jsonb, jsonb) rename to validate_client_legacy;
create function private.validate_client(c jsonb, prior jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare item jsonb; old jsonb; event jsonb; field text; lower_date text; today text := to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM-DD');
begin
  perform private.validate_client_legacy(c, prior);
  if not private.valid_date(c ->> 'startDate', true) then perform private.fail('Некорректная дата старта.', '22023'); end if;
  for item in select * from jsonb_array_elements(c -> 'apps') loop
    if not coalesce(private.is_text(item -> 'university', 160) and btrim(item ->> 'university') <> ''
      and private.is_text(item -> 'program', 160) and btrim(item ->> 'program') <> ''
      and private.is_text(item -> 'country', 80) and btrim(item ->> 'country') <> ''
      and private.valid_date(item ->> 'deadline'), false) then perform private.fail('Проверьте обязательные поля и дедлайн заявки.', '22023'); end if;
    if not private.valid_date(item ->> 'feePaidDate', true) or coalesce(item ->> 'feePaidDate', '') > today then
      perform private.fail('Некорректная дата оплаты.', '22023');
    end if;
  end loop;
  for item in select * from jsonb_array_elements(c -> 'tasks') loop
    if not coalesce(private.is_text(item -> 'title', 250) and btrim(item ->> 'title') <> ''
      and private.valid_date(item ->> 'date') and jsonb_typeof(item -> 'done') = 'boolean', false) then
      perform private.fail('Проверьте название, дату и состояние задачи.', '22023');
    end if;
  end loop;
  for old in select * from jsonb_array_elements(coalesce(nullif(prior -> 'reports', 'null'), '[]')) loop
    if not exists (select 1 from jsonb_array_elements(coalesce(nullif(c -> 'reports', 'null'), '[]')) r where r ->> 'id' = old ->> 'id') then
      perform private.fail('Сохранённый отчёт нельзя удалить из истории.', '22023');
    end if;
  end loop;
  for item in select * from jsonb_array_elements(coalesce(nullif(c -> 'reports', 'null'), '[]')) loop
    if not coalesce(jsonb_typeof(item -> 'client') = 'object' and private.is_text(item -> 'client' -> 'name', 100)
      and private.is_text(item -> 'stage', 100) and private.is_text(item -> 'done', 500)
      and private.is_text(item -> 'next', 400) and private.is_text(item -> 'clientAction', 300)
      and private.is_text(item -> 'createdAt', 40) and jsonb_typeof(item -> 'applications') = 'array'
      and jsonb_typeof(item -> 'fees') = 'array' and jsonb_typeof(item -> 'periodFees') = 'array', false) then
      perform private.fail('Некорректный отчёт.', '22023');
    end if;
    if not coalesce(private.valid_date(item ->> 'from') and private.valid_date(item ->> 'to')
      and item ->> 'from' <= item ->> 'to' and item ->> 'to' <= today, false) then
      perform private.fail('Некорректный период отчёта.', '22023');
    end if;
    lower_date := coalesce(item ->> 'createdDate', left(item ->> 'createdAt', 10));
    select r into old from jsonb_array_elements(coalesce(nullif(prior -> 'reports', 'null'), '[]')) r where r ->> 'id' = item ->> 'id';
    foreach field in array array['sent', 'ack'] loop
      event := item -> field;
      if old is not null and jsonb_typeof(old -> field) = 'object' and old -> field is distinct from event then
        perform private.fail('Сохранённую отметку отчёта нельзя изменить.', '22023');
      end if;
      if coalesce(jsonb_typeof(event), 'null') <> 'null' then
        if not coalesce(jsonb_typeof(event) = 'object' and private.valid_date(event ->> 'date')
          and event ->> 'date' >= lower_date and event ->> 'date' <= today
          and event ->> 'channel' in ('WhatsApp', 'Email', 'Личная встреча', 'Звонок', 'Другой канал')
          and private.is_text(event -> 'note', 250) and event ->> 'source' = 'admin_manual'
          and private.is_text(event -> 'recordedAt', 40), false) then perform private.fail('Некорректная отметка отчёта.', '22023'); end if;
        if field = 'ack' and (coalesce(jsonb_typeof(item -> 'sent'), 'null') <> 'object' or btrim(event ->> 'note') = '') then
          perform private.fail('Ознакомление требует отправки и подтверждения абитуриента.', '22023');
        end if;
      end if;
      if field = 'sent' and jsonb_typeof(event) = 'object' then lower_date := event ->> 'date'; end if;
    end loop;
  end loop;
end $$;

revoke execute on function public.create_invitation(text, text, text), public.accept_invitation(text),
  public.mark_invitation_sent(uuid, text), public.crm_settings() from public, anon, authenticated;
grant execute on function public.create_invitation(text, text, text), public.accept_invitation(text),
  public.mark_invitation_sent(uuid, text), public.crm_settings() to authenticated;
