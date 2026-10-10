-- Keep the existing batch save API for ordinary edits, but prevent staff from using
-- its legacy p_deletes argument to bypass the owner-only deletion action below.
alter function public.save_clients(jsonb, jsonb) set schema private;
revoke execute on function private.save_clients(jsonb, jsonb) from public, anon, authenticated;

create function public.save_clients(p_upserts jsonb default '[]', p_deletes jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member();
  if jsonb_typeof(p_deletes) = 'array' and jsonb_array_length(p_deletes) > 0 then
    perform private.require_owner();
  end if;
  return private.save_clients(p_upserts, p_deletes);
end $$;

revoke execute on function public.save_clients(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_clients(jsonb, jsonb) to authenticated;

-- Deletes one client card with optimistic concurrency. Only the workspace owner may
-- perform this destructive action; related document metadata is removed by the FK.
create function public.delete_client(p_id text, p_revision int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  deleted_name text;
  conflict constant text := 'Данные изменились в другой вкладке или у другого сотрудника. Обновите страницу перед удалением.';
begin
  perform private.require_owner();
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,100}$' or p_revision is null or p_revision < 1 then
    perform private.fail('Некорректный запрос на удаление.', '22023');
  end if;

  delete from public.clients
  where id = p_id and revision = p_revision
  returning data ->> 'name' into deleted_name;
  if not found then perform private.fail(conflict, '40001'); end if;

  perform private.audit('client_deleted', format('%s (%s)', coalesce(deleted_name, 'Без имени'), p_id));
end $$;

revoke execute on function public.delete_client(text, int) from public, anon, authenticated;
grant execute on function public.delete_client(text, int) to authenticated;
