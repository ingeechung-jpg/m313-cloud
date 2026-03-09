# m313-cloud

Cloudflare Pages frontend for `ingeechung.pointtoline.com`.

## Runtime split

- `public/`
  Static frontend served by Cloudflare Pages.
- `functions/api.js`
  Same-origin proxy from Pages to the Apps Script JSON API.
- `wrangler.toml`
  Local/dev and Pages config.

## Operating flow

1. Frontend changes
   - Edit files under `public/` or `functions/`
   - Commit and push to `main`
   - Cloudflare Pages auto-deploys

2. Data/backend changes
   - Edit Apps Script files under `../src/`
   - `clasp push`
   - Redeploy the existing Apps Script web app

3. Domain routing
   - `ingeechung.pointtoline.com` should point to this Pages project
   - Old redirect rules and worker routes must stay removed

## Current performance policy

- Dashboard/profile/list payload is cached briefly in Apps Script for faster initial load
- Note markdown and inline image payloads are cached longer because Docs conversion is the slowest path
