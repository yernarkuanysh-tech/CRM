-- Client documents: files live in the private Storage bucket `client-documents` at
-- `<client id>/<document id>`; `public.client_documents` holds their names and sizes.
-- Active members can list, upload, download and delete; nobody else can reach either.

create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 255),
  size bigint not null check (size between 1 and 20 * 1024 * 1024),
  mime_type text not null default '' check (length(mime_type) <= 255),
  created_at timestamptz not null default now(),
  uploaded_by uuid default auth.uid() references auth.users on delete set null
);
create index client_documents_client on public.client_documents (client_id, created_at desc);

alter table public.client_documents enable row level security;
revoke all on public.client_documents from anon, authenticated;
grant select, insert (id, client_id, name, size, mime_type), delete on public.client_documents to authenticated;

create policy "Active members read documents" on public.client_documents
  for select to authenticated using (private.is_member());
create policy "Active members add documents" on public.client_documents
  for insert to authenticated with check (private.is_member() and uploaded_by = auth.uid());
create policy "Active members delete documents" on public.client_documents
  for delete to authenticated using (private.is_member());

-- 20 MB per file; documents, scans and photos only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 20 * 1024 * 1024, array[
  'application/pdf',
  'image/jpeg', 'image/png', 'image/heic', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'application/zip'
]);

create policy "Active members read client files" on storage.objects
  for select to authenticated using (bucket_id = 'client-documents' and private.is_member());
-- Uploads go only into the folder of an existing client.
create policy "Active members upload client files" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'client-documents' and private.is_member()
    and exists (select 1 from public.clients where id = (storage.foldername(name))[1]));
create policy "Active members delete client files" on storage.objects
  for delete to authenticated using (bucket_id = 'client-documents' and private.is_member());
