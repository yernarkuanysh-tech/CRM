# Security policy

GrantEd CRM stores client records. Use a private GitHub repository and never commit `.env`, database exports or secret keys. The Supabase publishable key in `.env.production` is public by design; never put a Supabase secret (`sb_secret_…`) or `service_role` key in the frontend or the repository.

## Reporting a vulnerability

Report security issues privately to the repository owner. Do not include client records, passwords, API keys or production database files in a public GitHub issue.

## Deployment requirements

- Serve the application over HTTPS.
- Access control lives in the database: keep row level security enabled and apply schema changes only through `supabase/migrations`.
- Enable Supabase backups and store JSON exports in protected storage.
- Require 12-character passwords in Supabase Auth settings.
- Rotate any credential that was accidentally disclosed and remove it from Git history before publishing.
