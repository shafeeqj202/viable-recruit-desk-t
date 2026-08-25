# Viable Recruit Desk

A shared recruiting tracker: jobs, candidates, a guided status pipeline, and a
dashboard — built as a small Node.js + Express + PostgreSQL app so the whole
team can use it with their own logins.

## Local development

1. Have a PostgreSQL database available and export `DATABASE_URL` pointing to it.
2. Copy `.env.example` to `.env` and fill in the values (see below).
3. `npm install`
4. `npm start` — serves on `PORT` (default 3000).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. |
| `SESSION_SECRET` | yes (prod) | Random string used to sign session cookies. |
| `TEAM_INVITE_CODE` | yes | Shared passphrase teammates enter once when creating their account. Change it any time by updating this env var — it only gates new sign-ups, not existing logins. |
| `PORT` | no | Defaults to 3000. |
| `PGSSL` | no | Set to `disable` for a local Postgres with no SSL. Omit in production (Render's managed Postgres needs SSL). |

## Deploying

`render.yaml` is a Render Blueprint — it provisions a free web service and a
free Postgres database together. After deploying, set `TEAM_INVITE_CODE` in
the service's Environment tab (marked `sync: false` in the blueprint on
purpose, so it isn't committed anywhere).

The first person to sign up becomes the first user — there's no separate
admin step. Everyone who knows the invite code can create their own account
and has full read/write access to jobs and candidates.

## Data model

- **Jobs**: title, skills, client, partner, location, work rights, contract/perm,
  onshore/offshore, start date, duration, onshore/offshore rate, description, status.
- **Candidates**: name, job, work rights, location, availability, cost, billing
  rate, notes, resume (stored in the database, 3 MB cap), and a 13-stage guided
  status pipeline (Shortlisted → … → Onboarded) with a full history and an
  explicit "override" escape hatch for correcting mistakes.
- **Dashboard**: candidate counts per job per stage, filterable by job status,
  onshore/offshore, partner, and candidate status.

## Backup & restore

Any logged-in user can download a full JSON backup from the **Backup** button
in the top bar, and restore from one the same way — useful before a risky
change, or if you want an offline copy.
