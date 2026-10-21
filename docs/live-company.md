# Live company

One hosted project named `sitepack-live`. Shaun is the first owner. No fixture seed.

`supabase/seed.sql` stays for local `supabase start` and for fixture mode (blank URL, or `EXPO_PUBLIC_USE_FIXTURES=1`). Do not load it here.

## Once

Log in to the Supabase CLI:

```bash
npx supabase login
```

Export these in the shell. Do not put them in the repo.

```bash
export SHAUN_EMAIL="you@example.com"
export SHAUN_PASSWORD="a real password"
export COMPANY_NAME="Your company"
export SUPABASE_DB_PASSWORD="database password for the new project"
```

Optional: `SHAUN_DISPLAY_NAME` (default Shaun), `SUPABASE_ORG_ID` if the account has more than one org, `SITEPACK_REGION` (default `eu-west-2`). `WEB_ORIGIN` defaults to `https://sitepack-preview.vercel.app`. Set it only for a different https origin. An http origin, including localhost, is refused.

The script checks that `{WEB_ORIGIN}/set-password` is in `additional_redirect_urls`, then sets the edge secret `INVITE_REDIRECT_URL` to that URL.

Hosted auth (set in the dashboard; `supabase/config.toml` is what `config push` would copy):

- Site URL: `https://sitepack-preview.vercel.app`
- Redirect allow-list includes `https://sitepack-preview.vercel.app` and `https://sitepack-preview.vercel.app/set-password`, plus the localhost entries and `sitepack://set-password`
- Edge secret: `INVITE_REDIRECT_URL=https://sitepack-preview.vercel.app/set-password`

Redeploy `invite-person` after this code is on the project. The function has no localhost fallback. If `INVITE_REDIRECT_URL` is missing, or is not https (`http` is accepted only for `127.0.0.1` and `localhost`), it returns `{ "error": "invite_redirect_not_configured" }` and does not send mail.

Local `supabase functions serve` needs `INVITE_REDIRECT_URL=http://127.0.0.1:8081/set-password` in the shell or in `supabase/functions/.env` (do not commit that file). Local `supabase start` still allow-lists that URL.

Check, then run:

```bash
node scripts/live-company.mjs --check
node scripts/live-company.mjs
```

The script creates or reuses `sitepack-live`, turns public signup off, pushes both migrations, creates the owner, deploys `invite-person`, and writes `.env.local`. It does not run `seed.sql`.

Restart the web app:

```bash
npm run web
```

Home must not say “Running on local seed”.

## Smoke

1. Sign in as Shaun with email and password. No fixture names on screen.
2. Create one site. Invite one real email as an operative on that site.
3. The invite link is one-time. This one was already opened. If the address bar still has `access_token` and `type=invite`, reload that page, set the new person’s password, and press **Save password**. They should land on their home, with only the site you assigned. If the address bar has no `access_token`, stop. The email cannot be opened again. Do not click the same invite.
4. Upload one real PDF into a folder (Ground floor or another preset). It shows as current, with revision and date.
5. The invited person sees that site only. A site they are not assigned to is not on their home.

The invite email is Supabase’s own mail. The auth config allows two emails an hour, which is enough for one invite.

Do not run `supabase db reset`, `supabase seed`, or `supabase db push --include-seed` against this project.
