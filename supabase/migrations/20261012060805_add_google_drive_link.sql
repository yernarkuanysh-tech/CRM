-- Client cards are stored as JSONB, so no column is required. This constraint keeps
-- the new Google Drive link bounded and prevents non-Google or unsafe URL schemes.
alter table public.clients
  add constraint clients_google_drive_url
  check (
    not (data ? 'googleDriveUrl')
    or (
      jsonb_typeof(data -> 'googleDriveUrl') = 'string'
      and length(data ->> 'googleDriveUrl') <= 1000
      and (
        btrim(data ->> 'googleDriveUrl') = ''
        or data ->> 'googleDriveUrl' ~ '^https://(drive|docs)\.google\.com/'
      )
    )
  );
