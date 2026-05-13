# Cookie Rotation (Recommended)

Twitter/X cookies expire periodically. This repo now supports a safer semi-automatic rotation flow.

## Quick commands

```bash
npm run cookie:check
npm run cookie:replace -- /path/to/new-cookies.json
```

## What `cookie:replace` does

1. Validate JSON + required `auth_token` and `ct0`
2. Backup current `data/cookies.json` to `data/backups/`
3. Health-check new cookies using a lightweight Twitter request
4. Atomic swap only if health-check passes

If health-check fails, current cookies stay unchanged.

## Recommended ops SOP

- Rotate every 7-10 days proactively
- Rotate immediately on auth alerts (401/403/session expired)
- After rotate, run with lower comment rate for 30-60 minutes
