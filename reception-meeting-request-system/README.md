# Reception Meeting Request System

A front-desk workflow app: visitors are logged by the receptionist, employees (MD, COO,
President, staff) accept / transfer / decline requests, and admins manage accounts.

**Stack:** React 19 + Vite + Tailwind 4 (frontend) · Express 5 API · Zod validation.
Deploys to Vercel as a static site plus one serverless function.

## Run locally

Requires Node.js 20.19+ (22 recommended).

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. `npm run dev` starts both the Vite dev server (5173) and the
API (3001, proxied under `/api`). No `.env` and no database are needed: data is stored in
`.data/reception.json`.

First visit: the app asks you to create the first **Admin** account (password 12+ characters).
Then use *Admin → users* to create Receptionist / MD / COO / President / Employee logins.

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Frontend + API with hot reload                |
| `npm run build`     | Production build into `dist/`                 |
| `npm run preview`   | Serve the production build locally            |
| `npm run typecheck` | Type-check frontend and server                |
| `npm test`          | Unit tests (store, access control, storage)   |

## Deploy to Vercel

1. Push this folder to a Git repository and **Import** it in Vercel.
   Vercel detects Vite; no build settings to change (`vercel.json` is included).
2. **Add a database** (required, see below): Project → **Storage** → create **Upstash Redis**
   (Marketplace) and connect it to the project. This sets `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically.
3. *(Recommended)* In **Settings → Environment Variables** add `ADMIN_BOOTSTRAP_TOKEN`
   (any long random string). Without it, **whoever opens the site first can create the admin
   account.** Optionally add `SESSION_SECRET` (`openssl rand -hex 32`); if omitted, one is
   derived from the Redis token.
4. **Redeploy** (env var changes only apply to new deployments), open the site and create the admin.

### Why a database is needed on Vercel

Vercel functions have a read-only, ephemeral filesystem, so the local JSON file cannot hold
users, sessions or requests there. The app therefore switches storage automatically:

| Environment                         | Storage                                  |
| ----------------------------------- | ---------------------------------------- |
| Local (`npm run dev`)               | `.data/reception.json` (no setup)        |
| Redis variables present             | Redis over HTTPS (no extra packages)     |
| On Vercel **without** Redis         | API answers 503 with setup instructions  |

All data is kept as one JSON document with compare-and-set writes, so simultaneous requests on
different serverless instances don't overwrite each other. That suits a small team; for heavy
traffic, replace `RedisRepository` in `server/lib/storage.ts` with a SQL implementation of the
same two-method `AppDataRepository` interface. Local data is not migrated automatically.

## Project structure

```
api/index.ts        Vercel function entry (re-exports the Express app)
server/             Express API
  app.ts            app + error handling          dev.ts   local server (npm run dev)
  routes/           auth, reception, health
  lib/              storage.ts (file + Redis), auth-session.ts, config.ts, app-data.ts
shared/api.ts       Zod schemas + types shared by API and UI
src/                React app (pages, components, lib)
docs/openapi.yaml   API reference (documentation only)
vercel.json         /api/* -> function, everything else -> index.html (SPA)
```

## Environment variables

See `.env.example`. All are optional locally.

## Troubleshooting

- **Port in use:** set `API_PORT` in `.env` (Vite's port auto-increments by itself).
- **"No database is connected" on Vercel:** do step 2 above, then redeploy.
- **Logged out after changing `SESSION_SECRET`:** expected; sign in again.
