# AGENTS.md

Work directly on `main`.

## Before making any changes

Sync with the remote first:

```bash
git pull --rebase --autostash origin main
```

If the rebase hits conflicts you can't resolve cleanly, run `git rebase --abort` and ask the user.

## After making changes

Show the user a summary of the changes and wait for approval. Once approved, commit and push:

```bash
git add -A
git commit -m "<short description of the change>"
git push origin main
```

Never commit or push without approval.
