# Security policy

GrantEd CRM stores client records. Use a private GitHub repository and never commit the `data/` directory, `.env`, production backups or API keys.

## Reporting a vulnerability

Report security issues privately to the repository owner. Do not include client records, passwords, API keys or production database files in a public GitHub issue.

## Deployment requirements

- Run the application behind HTTPS.
- Keep Node.js and the server operating system updated.
- Restrict the application process to its data directory.
- Back up `crm.sqlite` in protected storage.
- Rotate any credential that was accidentally disclosed and remove it from Git history before publishing.
