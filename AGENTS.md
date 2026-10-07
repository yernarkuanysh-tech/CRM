# AGENTS.md

Work directly on `main`.

## Before making any changes

Sync with the remote first:

```bash
git pull --rebase --autostash origin main
```

If the rebase hits conflicts you can't resolve cleanly, run `git rebase --abort` and ask the user.
