# Railway + External PostgreSQL Setup

This project does not use an ORM. It uses PostgreSQL directly via the `pg` package.
Tables are created at startup with idempotent `CREATE TABLE IF NOT EXISTS` statements in `api/src/postgresSchema.js`.

## 1) Which service?

Recommended order:
- Supabase: strong free tier, mature dashboard, easy connection string management.
- Neon (alternative): strong serverless Postgres option with good pooling/branching flow.

Both services are compatible with this codebase. Main requirement is PostgreSQL URL + SSL.

## 2) Railway environment variable approach

Set at least these values in the Railway API service:
- `NODE_ENV=production`
- `LOG_FORMAT=json`
- `TOKEN=...`
- `TARGET_GUILD_ID=...`
- `DATABASE_URL=postgresql://...?...sslmode=require`
- `DB_SSL=1`

Notes:
- If `DATABASE_URL` is set, `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME` are optional.
- `DB_SSL=1` is recommended for hosted PostgreSQL providers.

## 3) Migration / schema / table creation

Migration command:
- `npm run migrate`

What it does:
- Calls `runMigrations()`
- Runs `ensurePostgresStartupSchema()` to create/update runtime tables idempotently.

## 4) If DB is not ready on first boot

Startup behavior now:
- Migration step retries with exponential backoff until it succeeds.
- Startup continues automatically once DB becomes reachable.
- Process does not crash only because DB is temporarily unavailable.

## 5) Commands to bring up from zero

Inside `api`:

```bash
npm install
npm run migrate
npm start
```

If you want a separate Railway migration job:

```bash
npm run migrate
```

Then start command:

```bash
npm start
```
