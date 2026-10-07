# Security policy

GrantEd CRM stores client records and encrypted OAuth tokens. Use a private GitHub repository and never commit the `data/` directory, `.env`, production backups, API keys or `data/encryption.key`.

## Reporting a vulnerability

Report security issues privately to the repository owner. Do not include client records, passwords, OAuth tokens or production database files in a public GitHub issue.

## Deployment requirements

- Run the application behind HTTPS.
- Keep Node.js and the server operating system updated.
- Restrict the application process to its data directory.
- Back up `crm.sqlite` and `encryption.key` together in protected storage.
- Rotate any credential that was accidentally disclosed and remove it from Git history before publishing.
