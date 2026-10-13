-- Applicant tags stay inside the JSONB card. The constraint keeps them small,
-- textual and unique regardless of which client submits the save request.
create function private.valid_client_tags(value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(value) <> 'array' then false else
    jsonb_array_length(value) <= 20
    and coalesce((
      select bool_and(
        jsonb_typeof(tag) = 'string'
        and length(btrim(tag #>> '{}')) between 1 and 40
      ) and count(*) = count(distinct lower(btrim(tag #>> '{}')))
      from jsonb_array_elements(value) as items(tag)
    ), true)
  end;
$$;

alter table public.clients
  add constraint clients_tags
  check (not (data ? 'tags') or private.valid_client_tags(data -> 'tags'));
