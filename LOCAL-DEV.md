Former22 (middleware) — Local Dev Setup

Prereqs

-   Docker Desktop with Compose v2
-   Node 18.13+ and npm 8.19.3+
-   Claroline dev stack running (exposes MySQL on 127.0.0.1:3307)

1. Start Claroline (dev)

-   From `Claroline/` run: `docker compose -f docker-compose.dev.yml up -d`
-   App: `http://localhost:8088`
-   DB: host `127.0.0.1`, port `3307`, db `claroline`, user `claroline`, pass `claroline`

2. Configure Former22

-   In `cep-former22/.env` set:
    -   `DATABASE_URL=mysql://claroline:claroline@127.0.0.1:3307/claroline`
    -   Leave mail-related keys empty for local dev.

3. Prisma schema (db pull + client)

Common pitfall on Windows/PowerShell:

-   If you have a global environment variable `DATABASE_URL` from another project (often PostgreSQL or SQLite), Prisma will prefer that value over `.env` and fail with P1012 (URL must start with `mysql://`).

Fix (choose one):

-   Temporary for current shell: `Remove-Item Env:DATABASE_URL` (PowerShell)
-   Or override for this run: `$env:DATABASE_URL="mysql://claroline:claroline@127.0.0.1:3307/claroline"`
-   Then run:
    -   `npm run schema` (runs `prisma db pull && prisma generate`)

4. Run Former22

-   Windows: `npm run start:dev` (runs without PM2). The script auto-loads `.env` for db-migrate.
-   macOS/Linux: `npm start` (PM2) or `npm run start:dev`.
-   Open `http://localhost:4000/api-docs` to verify the API is up.

5. Login flow during local dev

-   In the Admin UI (`http://localhost:3000`):
    -   Email: `claroline@example.com`
    -   Code: any 6 digits (code check is disabled in development)
    -   Token: a Claroline API token belonging to that email and with admin rights.

Create/get a Claroline API token

-   In Claroline (`http://localhost:8088`) login with the dev admin (default: `root / claroline`).
-   Use the Integration/Tokens tool to create a new token and copy its 36‑character value.
-   Paste that token in the Admin UI “Jeton d'authentification”.

Troubleshooting

-   `npm run schema` → P1012 (must start with mysql://): clear or override global `DATABASE_URL` (see step 3).
-   UI “Envoyer code” fails: ensure Former22 is running on `http://localhost:4000` and Claroline DB is reachable.
-   Swagger not loading: run `npm run start:dev` to see errors directly, then check port 4000 is free.
