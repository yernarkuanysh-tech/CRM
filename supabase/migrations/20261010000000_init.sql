-- GrantEd CRM schema for Supabase.
--
-- The browser talks to Supabase directly with the publishable key, so every rule the old
-- Node server enforced lives here: row level security, owner/staff roles, the 10-seat team
-- limit, one-time invitations, the owner recovery code and client card validation.
--
-- Only `public.clients` (read) and the `public.*` functions below are reachable through the
-- API. Everything else sits in the `private` schema, which the API does not expose.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------

create table private.workspace (
  id int primary key default 1 check (id = 1),
  organization text not null default 'GrantEd' check (length(btrim(organization)) between 1 and 100),
  year int not null default 2027 check (year between 2020 and 2100)
);
insert into private.workspace default values;

create table private.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null unique,
  name text not null check (length(btrim(name)) between 1 and 100),
  role text not null check (role in ('owner', 'staff')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);
create unique index profiles_single_owner on private.profiles (role) where role = 'owner';

create table private.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  sent_at timestamptz
);

create table private.owner_recovery (
  hash text primary key,
  created_at timestamptz not null default now()
);

create table private.audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  event text not null,
  detail text not null default ''
);

create table public.clients (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  data jsonb not null check (data ->> 'id' = id),
  revision int not null default 1,
  -- Newest first: the app lists clients by position descending.
  position bigint generated always as identity,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);
create index clients_position on public.clients (position desc);

-- ---------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------

create function private.fail(message text, code text default 'P0001') returns void
language plpgsql as $$
begin
  raise exception using message = message, errcode = code;
end $$;

create function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.profiles where id = auth.uid() and status = 'active');
$$;

create function private.require_member() returns private.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me private.profiles;
begin
  select * into me from private.profiles where id = auth.uid() and status = 'active';
  if not found then perform private.fail('Войдите в CRM.', '42501'); end if;
  return me;
end $$;

create function private.require_owner() returns private.profiles
language plpgsql stable security definer set search_path = '' as $$
declare me private.profiles := private.require_member();
begin
  if me.role <> 'owner' then perform private.fail('Это действие доступно только владельцу.', '42501'); end if;
  return me;
end $$;

create function private.audit(event text, detail text default '') returns void
language sql security definer set search_path = '' as $$
  insert into private.audit (actor, event, detail) values (auth.uid(), event, coalesce(detail, ''));
$$;

create function private.new_token() returns text
language sql volatile set search_path = '' as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
$$;

create function private.token_hash(token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
$$;

create function private.seats_used() returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*) from private.profiles where role = 'staff' and status = 'active')::int
       + (select count(*) from private.invitations where expires_at > now())::int;
$$;

create function private.check_password(password text) returns void
language plpgsql immutable as $$
begin
  if password is null or length(password) < 12 or length(password) > 256 then
    perform private.fail('Пароль должен содержать от 12 до 256 символов.', '22023');
  end if;
end $$;

-- Ends every session of a user (refresh tokens go with their sessions).
create function private.end_sessions(user_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from auth.refresh_tokens where user_id = end_sessions.user_id::text;
  delete from auth.sessions where user_id = end_sessions.user_id;
$$;

-- ---------------------------------------------------------------------------------------
-- Client card validation (ported from server/validation.mjs)
-- ---------------------------------------------------------------------------------------

create function private.is_text(value jsonb, max int) returns boolean
language sql immutable as $$
  select jsonb_typeof(value) = 'string' and length(value #>> '{}') <= max;
$$;

create function private.unique_ids(list jsonb) returns boolean
language sql immutable as $$
  select coalesce(bool_and(e ->> 'id' ~ '^[A-Za-z0-9_-]{1,100}$') and count(*) = count(distinct e ->> 'id'), true)
  from jsonb_array_elements(list) e;
$$;

create function private.validate_client(c jsonb, prior jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  field text;
  item jsonb;
  old jsonb;
  scale numeric[];
  score numeric;
  test_date date;
  today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if octet_length(c::text) > 4 * 1024 * 1024 then perform private.fail('Слишком большая карточка клиента.', '22023'); end if;
  if jsonb_typeof(c) <> 'object' or not coalesce(private.is_text(c -> 'name', 100), false) or btrim(c ->> 'name') = '' then
    perform private.fail('Некорректная карточка клиента.', '22023');
  end if;
  if coalesce(c ->> 'level', '') not in ('Бакалавриат', 'Магистратура', 'PhD')
     or jsonb_typeof(c -> 'year') is distinct from 'number'
     or (c ->> 'year')::numeric % 1 <> 0 or (c ->> 'year')::numeric not between 2020 and 2100 then
    perform private.fail('Проверьте уровень и год поступления.', '22023');
  end if;
  foreach field in array array['email', 'phone', 'country', 'academicField', 'semester', 'funding', 'english', 'exam', 'consultant', 'startDate', 'notes'] loop
    if c ? field and not private.is_text(c -> field, case when field = 'notes' then 20000 else 1000 end) then
      perform private.fail(format('Некорректное поле: %s', field), '22023');
    end if;
  end loop;

  foreach field in array array['apps', 'tasks', 'tests', 'reports'] loop
    if field in ('apps', 'tasks') or (c ? field and jsonb_typeof(c -> field) <> 'null') then
      if jsonb_typeof(c -> field) is distinct from 'array' or jsonb_array_length(c -> field) > (case when field = 'tests' then 200 else 1000 end) then
        perform private.fail(format('Некорректный список %s', field), '22023');
      end if;
      if not private.unique_ids(c -> field) then perform private.fail('Некорректный ID записи.', '22023'); end if;
    end if;
  end loop;

  for item in select * from jsonb_array_elements(c -> 'apps') loop
    if not (private.is_text(item -> 'university', 160) and private.is_text(item -> 'program', 160) and private.is_text(item -> 'country', 80)
            and private.is_text(item -> 'deadline', 10)
            and coalesce(item ->> 'status', '') in ('Подбор программы', 'Документы', 'Подана', 'Интервью', 'Оффер', 'Отказ')) then
      perform private.fail('Некорректная заявка.', '22023');
    end if;
    if jsonb_typeof(item -> 'feeAmount') = 'number' then
      if (item ->> 'feeAmount')::numeric < 0 or (item ->> 'feeAmount')::numeric > 10000000 or ((item ->> 'feeAmount')::numeric * 100) % 1 <> 0 then
        perform private.fail('Некорректная сумма application fee.', '22023');
      end if;
    elsif coalesce(jsonb_typeof(item -> 'feeAmount'), 'null') <> 'null' then
      perform private.fail('Некорректная сумма application fee.', '22023');
    end if;
    if item ? 'feeStatus' and coalesce(item ->> 'feeStatus', '') not in ('', 'unknown', 'unpaid', 'paid', 'waived') then
      perform private.fail('Некорректный статус оплаты.', '22023');
    end if;
    if item ->> 'feeStatus' = 'paid' and coalesce(jsonb_typeof(item -> 'feeAmount'), 'null') = 'null' then
      perform private.fail('У оплаченного сбора должна быть сумма.', '22023');
    end if;
    if item ? 'feeCurrency' and coalesce(item ->> 'feeCurrency', '') not in ('', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'KZT') then
      perform private.fail('Некорректная валюта.', '22023');
    end if;
  end loop;

  for item in select * from jsonb_array_elements(c -> 'tasks') loop
    if not (private.is_text(item -> 'title', 250) and private.is_text(item -> 'date', 10) and jsonb_typeof(item -> 'done') = 'boolean') then
      perform private.fail('Некорректная задача.', '22023');
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(nullif(c -> 'tests', 'null'), '[]')) loop
    scale := case item ->> 'type' when 'IELTS' then array[0, 9, .5] when 'TOEFL' then array[1, 6, .5]
                                  when 'TOEFL-120' then array[0, 120, 1] when 'DET' then array[10, 160, 5] end;
    if scale is null then perform private.fail('Некорректный тест.', '22023'); end if;
    if jsonb_typeof(item -> 'score') is distinct from 'number' then perform private.fail('Балл не соответствует шкале теста.', '22023'); end if;
    score := (item ->> 'score')::numeric;
    if score < scale[1] or score > scale[2] or ((score - scale[1]) / scale[3]) % 1 <> 0 then
      perform private.fail('Балл не соответствует шкале теста.', '22023');
    end if;
    if jsonb_typeof(item -> 'date') is distinct from 'string' then perform private.fail('Некорректная дата теста.', '22023'); end if;
    if item ->> 'date' <> '' then
      begin
        if item ->> 'date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad date'; end if;
        test_date := (item ->> 'date')::date;
      exception when others then
        test_date := null;
      end;
      if test_date is null or test_date > today then perform private.fail('Дата теста должна быть корректной и не позже сегодня.', '22023'); end if;
    end if;
  end loop;

  for item in select * from jsonb_array_elements(coalesce(nullif(c -> 'reports', 'null'), '[]')) loop
    if not (jsonb_typeof(item -> 'client') = 'object' and private.is_text(item -> 'client' -> 'name', 100)
            and private.is_text(item -> 'stage', 100) and private.is_text(item -> 'done', 500) and private.is_text(item -> 'next', 400)
            and private.is_text(item -> 'clientAction', 300) and private.is_text(item -> 'createdAt', 40)
            and private.is_text(item -> 'from', 10) and private.is_text(item -> 'to', 10)
            and jsonb_typeof(item -> 'applications') = 'array' and jsonb_array_length(item -> 'applications') <= 8
            and jsonb_typeof(item -> 'fees') = 'array' and jsonb_typeof(item -> 'periodFees') = 'array') then
      perform private.fail('Некорректный отчёт.', '22023');
    end if;
    select r into old from jsonb_array_elements(coalesce(nullif(prior -> 'reports', 'null'), '[]')) r where r ->> 'id' = item ->> 'id';
    if old is not null and (old - 'sent' - 'ack') <> (item - 'sent' - 'ack') then
      perform private.fail('Содержание сохранённого отчёта нельзя изменить. Создайте новый отчёт.', '22023');
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------
-- Sign-up: the first account becomes the owner; after that only invited emails can join.
-- ---------------------------------------------------------------------------------------

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}');
  invite private.invitations;
  user_email text := lower(new.email);
begin
  perform pg_advisory_xact_lock(hashtext('crm_signup'));
  if not exists (select 1 from private.profiles where role = 'owner') then
    insert into private.profiles (id, email, name, role)
    values (new.id, user_email, coalesce(nullif(btrim(meta ->> 'name'), ''), 'Администратор'), 'owner');
    insert into private.audit (actor, event) values (new.id, 'admin_created');
    return new;
  end if;

  select * into invite from private.invitations
  where token_hash = private.token_hash(meta ->> 'invite_token') and email = user_email and expires_at > now()
  for update;
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

create trigger crm_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------
-- API: auth and settings
-- ---------------------------------------------------------------------------------------

-- Whether the owner account exists (login page shows "create owner" until it does).
create function public.crm_initialized() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.profiles where role = 'owner');
$$;

-- Workspace settings and the signed-in user, or null when the user has no active CRM access.
create function public.crm_settings() returns jsonb
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
    result := result || jsonb_build_object('name', me.name, 'email', me.email, 'recoveryEnabled', exists (select 1 from private.owner_recovery));
  end if;
  return result;
end $$;

create function public.update_settings(p_name text, p_organization text, p_year int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me private.profiles := private.require_owner();
begin
  if p_name is null or btrim(p_name) = '' or length(p_name) > 100
     or p_organization is null or btrim(p_organization) = '' or length(p_organization) > 100
     or p_year is null or p_year not between 2020 and 2100 then
    perform private.fail('Проверьте имя, организацию и год набора.', '22023');
  end if;
  update private.profiles set name = btrim(p_name) where id = me.id;
  update private.workspace set organization = btrim(p_organization), year = p_year where id = 1;
  perform private.audit('settings_updated');
  return public.crm_settings();
end $$;

-- Creates a new owner recovery code (shown once; only its hash is stored).
create function public.create_recovery_code(p_current_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me private.profiles := private.require_owner();
  code text := private.new_token();
begin
  if not exists (select 1 from auth.users where id = me.id and encrypted_password = extensions.crypt(coalesce(p_current_password, ''), encrypted_password)) then
    perform private.fail('Неверный текущий пароль.', '28P01');
  end if;
  delete from private.owner_recovery where true;
  insert into private.owner_recovery (hash) values (private.token_hash(code));
  perform private.audit('recovery_created');
  return code;
end $$;

-- Resets the owner password with the recovery code; the code is single-use.
create function public.recover_owner_password(p_email text, p_code text, p_new_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare owner private.profiles;
begin
  perform private.check_password(p_new_password);
  select * into owner from private.profiles where role = 'owner';
  if not found or owner.email <> lower(btrim(coalesce(p_email, '')))
     or not exists (select 1 from private.owner_recovery where hash = private.token_hash(btrim(coalesce(p_code, '')))) then
    perform private.fail('Неверная почта или резервный код.', '28P01');
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() where id = owner.id;
  delete from private.owner_recovery where true;
  perform private.end_sessions(owner.id);
  insert into private.audit (actor, event) values (owner.id, 'password_recovered');
end $$;

-- ---------------------------------------------------------------------------------------
-- API: team
-- ---------------------------------------------------------------------------------------

create function public.team_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_owner();
  delete from private.invitations where expires_at <= now();
  return jsonb_build_object(
    'limit', 10,
    'used', private.seats_used(),
    'mailConfigured', false,
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'name', name, 'status', status, 'createdAt', created_at) order by status, email)
                       from private.profiles where role = 'staff'), '[]'),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'email', email, 'name', name, 'createdAt', created_at,
                                                                 'expires', (extract(epoch from expires_at) * 1000)::bigint, 'sentAt', sent_at) order by created_at desc)
                             from private.invitations), '[]'));
end $$;

-- Creates (or renews) an invitation and returns its one-time token.
create function public.create_invitation(p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  invite_email text := lower(btrim(coalesce(p_email, '')));
  invite_name text := btrim(coalesce(p_name, ''));
  token text := private.new_token();
  invite private.invitations;
begin
  perform private.require_owner();
  if invite_email !~ '^\S+@\S+\.\S+$' or length(invite_email) > 254 or invite_name = '' or length(invite_name) > 100 then
    perform private.fail('Проверьте имя и email сотрудника.', '22023');
  end if;
  if exists (select 1 from private.profiles where email = invite_email and role = 'owner') then
    perform private.fail('Владелец уже использует эту почту.', '23505');
  end if;
  if exists (select 1 from private.profiles where email = invite_email) then
    perform private.fail('Сотрудник с такой почтой уже существует.', '23505');
  end if;
  delete from private.invitations where expires_at <= now();
  if not exists (select 1 from private.invitations where email = invite_email) and private.seats_used() >= 10 then
    perform private.fail('Достигнут лимит: 10 сотрудников.', '23514');
  end if;
  insert into private.invitations (email, name, token_hash)
  values (invite_email, invite_name, private.token_hash(token))
  on conflict (email) do update set name = excluded.name, token_hash = excluded.token_hash, created_at = now(),
                                    expires_at = now() + interval '7 days', sent_at = null
  returning * into invite;
  perform private.audit('staff_invited', invite_email);
  return jsonb_build_object('id', invite.id, 'email', invite.email, 'name', invite.name,
                            'expires', (extract(epoch from invite.expires_at) * 1000)::bigint, 'token', token);
end $$;

create function public.revoke_invitation(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare invite_email text;
begin
  perform private.require_owner();
  delete from private.invitations where id = p_id returning email into invite_email;
  if invite_email is null then perform private.fail('Приглашение не найдено.', 'P0002'); end if;
  perform private.audit('staff_invite_revoked', invite_email);
  return public.team_overview();
end $$;

-- Enables or disables a staff member; disabling ends their sessions and blocks data access at once.
create function public.set_staff_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare member private.profiles;
begin
  perform private.require_owner();
  if p_status not in ('active', 'disabled') then perform private.fail('Неизвестный статус.', '22023'); end if;
  select * into member from private.profiles where id = p_id and role = 'staff' for update;
  if not found then perform private.fail('Сотрудник не найден.', 'P0002'); end if;
  if p_status = 'active' and member.status <> 'active' and private.seats_used() >= 10 then
    perform private.fail('Достигнут лимит: 10 сотрудников.', '23514');
  end if;
  update private.profiles set status = p_status where id = p_id;
  if p_status = 'disabled' then perform private.end_sessions(p_id); end if;
  perform private.audit(case when p_status = 'active' then 'staff_enabled' else 'staff_disabled' end, member.email);
  return public.team_overview();
end $$;

-- Public details of a pending invitation, for the invite page.
create function public.inspect_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare invite private.invitations;
begin
  if p_token is null or length(p_token) > 200 then perform private.fail('Приглашение недействительно.', '22023'); end if;
  select * into invite from private.invitations where token_hash = private.token_hash(p_token) and expires_at > now();
  if not found then perform private.fail('Приглашение истекло или было отозвано.', 'P0002'); end if;
  return jsonb_build_object('email', invite.email, 'name', invite.name,
                            'expires', (extract(epoch from invite.expires_at) * 1000)::bigint,
                            'organization', (select organization from private.workspace where id = 1));
end $$;

-- ---------------------------------------------------------------------------------------
-- API: clients
-- ---------------------------------------------------------------------------------------

-- Saves changed client cards atomically with optimistic concurrency per card.
-- p_upserts: [{data: Client, revision: number | null}] (null revision = new card, listed newest first)
-- p_deletes: [{id, revision}]
-- Returns {clientId: newRevision} for every upserted card.
create function public.save_clients(p_upserts jsonb default '[]', p_deletes jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  current_row public.clients;
  client_id text;
  new_revision int;
  result jsonb := '{}';
  conflict constant text := 'Данные изменились в другой вкладке или у другого сотрудника. Обновите страницу перед сохранением.';
begin
  perform private.require_member();
  if jsonb_typeof(p_upserts) is distinct from 'array' or jsonb_typeof(p_deletes) is distinct from 'array' then
    perform private.fail('Некорректный запрос.', '22023');
  end if;

  for item in select * from jsonb_array_elements(p_deletes) loop
    delete from public.clients where id = item ->> 'id' and revision = (item ->> 'revision')::int;
    if not found then perform private.fail(conflict, '40001'); end if;
  end loop;

  -- Reverse order so the first new card gets the highest position (shown first).
  for item in select e from jsonb_array_elements(p_upserts) with ordinality as t(e, n) order by n desc loop
    client_id := item -> 'data' ->> 'id';
    if client_id is null or client_id !~ '^[A-Za-z0-9_-]{1,100}$' then
      perform private.fail('Некорректная карточка клиента или повторяющийся ID.', '22023');
    end if;
    if coalesce(jsonb_typeof(item -> 'revision'), 'null') = 'null' then
      perform private.validate_client(item -> 'data', null);
      insert into public.clients (id, data, updated_by) values (client_id, item -> 'data', auth.uid())
      on conflict (id) do nothing;
      if not found then perform private.fail(conflict, '40001'); end if;
      new_revision := 1;
    else
      select * into current_row from public.clients where id = client_id for update;
      if not found or current_row.revision <> (item ->> 'revision')::int then perform private.fail(conflict, '40001'); end if;
      perform private.validate_client(item -> 'data', current_row.data);
      update public.clients set data = item -> 'data', revision = revision + 1, updated_at = now(), updated_by = auth.uid()
      where id = client_id returning revision into new_revision;
    end if;
    result := result || jsonb_build_object(client_id, new_revision);
  end loop;

  if (select count(*) from public.clients) > 2000 then perform private.fail('Допускается до 2000 клиентов.', '23514'); end if;
  perform private.audit('state_saved', format('%s saved, %s deleted', jsonb_array_length(p_upserts), jsonb_array_length(p_deletes)));
  return result;
end $$;

-- ---------------------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------------------

alter table private.workspace enable row level security;
alter table private.profiles enable row level security;
alter table private.invitations enable row level security;
alter table private.owner_recovery enable row level security;
alter table private.audit enable row level security;
alter table public.clients enable row level security;

revoke all on all tables in schema private from anon, authenticated;
revoke all on public.clients from anon, authenticated;
grant select on public.clients to authenticated;
create policy "Active members read clients" on public.clients for select to authenticated using (private.is_member());

-- RLS policies call private.is_member(), which needs schema usage; nothing else in private is granted.
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
  end if;
end $$;

revoke execute on function
  public.crm_initialized(), public.crm_settings(), public.update_settings(text, text, int),
  public.create_recovery_code(text), public.recover_owner_password(text, text, text),
  public.team_overview(), public.create_invitation(text, text), public.revoke_invitation(uuid),
  public.set_staff_status(uuid, text), public.inspect_invitation(text), public.save_clients(jsonb, jsonb)
from public, anon, authenticated;

grant execute on function public.crm_initialized(), public.inspect_invitation(text), public.recover_owner_password(text, text, text)
  to anon, authenticated;
grant execute on function
  public.crm_settings(), public.update_settings(text, text, int), public.create_recovery_code(text),
  public.team_overview(), public.create_invitation(text, text), public.revoke_invitation(uuid),
  public.set_staff_status(uuid, text), public.save_clients(jsonb, jsonb)
to authenticated;
