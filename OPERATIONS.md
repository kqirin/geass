# Runtime Operations Note

This project intentionally does **not** implement an internal self-restart loop.
On fatal failures (`uncaughtException`, `unhandledRejection`) process exits with non-zero code.

Use an external supervisor for restart behavior:

- `pm2` with `autorestart: true`
- `systemd` with `Restart=always`
- `docker` with `restart: unless-stopped` (or `always`)

Reason: external supervisors provide safer restart/backoff controls and avoid duplicate bot instances inside one process.

## Supervisor Examples

- PM2 (`ecosystem.config.js`):
  - `autorestart: true`
  - `max_restarts: 10`
  - `exp_backoff_restart_delay: 200`
- systemd (`service`):
  - `Restart=always`
  - `RestartSec=2`
  - `StartLimitBurst=10`
- Docker Compose:
  - `restart: unless-stopped`
