# Household Hero

A board game for sharing out the housework. Grown-ups build a weekly board of chores and hand them out by hand, by auto-suggest, or by drafting them like a game. Children tick chores off on their own phone and earn points. It is a PWA, so it installs to the home screen and keeps working offline.

## Stack

- React 19, TypeScript and Vite, with `vite-plugin-pwa` for the service worker and manifest
- Supabase: Postgres with row level security, magic-link sign-in for grown-ups, anonymous sign-in for children, realtime on `weeks` and `assignments`, and `pg_cron` for the scheduled jobs
- GitHub Actions deploying to GitHub Pages

Clients can only read tables. Every write goes through a `security definer` function in `supabase/migrations`, which re-checks who is asking.

## Setup

1. **Supabase project.** In Authentication, turn on "Allow anonymous sign-ins" (children use it) and add your Pages URL to the allowed redirect URLs (magic links use it).
2. **Migrations.** Run `supabase/migrations/0001` to `0010` in order, either with `supabase db push` or by pasting each file into the SQL editor. `0006` enables `pg_cron`. If you already ran 0001 to 0009, run only `0010`.
3. **GitHub Pages.** In the repo settings, set Pages to deploy from GitHub Actions.
4. **Variables.** Under Settings, Secrets and variables, Actions, Variables, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. They are variables rather than secrets because the anon key ships in the built app anyway.
5. **Lockfile.** Deploys use `npm ci`, which needs `app/package-lock.json`. Run the "Create lockfile" workflow once from the Actions tab. It commits the file and starts a deploy. After that you can delete `.github/workflows/lockfile.yml`.

The app is served from `/<repo-name>/`. CI takes that from the repository name, so renaming the repo is safe. For a custom domain, add a `VITE_BASE` variable set to `/`.

## Local development

```
cd app
npm install
npm run dev
```

Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `app/.env.local`. `npm test` runs the draft logic tests and `npm run build` type-checks and builds.

## How it works

- **People.** The first grown-up creates the household (name, timezone, week start day, reward note) and becomes the head. The head adds children, each with a join code the child types on their own phone. Another grown-up joins from the Family tab with an invite code, which works once and is then replaced.
- **Weeks.** Each week is a grid of chores by day. Adults fill it in, then lock it. Game Week lets people take turns picking, either on one phone or on their own phones with a turn timer. Unlocking is possible until something has been completed.
- **Points.** Effort times 10, plus 25% for on time, half for late, plus 5 before 9am. A perfect week adds 50. The numbers live in the `scoring_config` table.
- **Approvals.** If "Grown-up approves children's chores" is on, a child's chore waits in Approve until a grown-up signs it off. Nobody can approve their own chore. Only approved chores count toward a weekly result, so a late approval re-scores that week.
- **Scheduled jobs.** `hourly-misses` marks old chores as missed, `weekly-rollover` closes finished weeks and creates the next boards, and `expire-turns` auto-picks when a draft turn times out.

## Known limits

- Offline completions are replayed with the phone's clock. The server only accepts a time that is not in the future, within the last 48 hours, and not before the chore's day. Back-dating inside that window is still possible, and the completion time and on-time flag shown on each approval are how to spot it.
- Join codes are 8 characters with a per-account attempt limit. Anonymous sign-ins are free, so for a public deployment turn on CAPTCHA in Supabase Auth as well.
- An account belongs to one household.
