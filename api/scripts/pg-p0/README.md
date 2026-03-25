## PostgreSQL P0 Baseline Kit

Bu klasor sadece PostgreSQL runtime state + audit baseline'i icindir. Runtime koduna
dogrudan baglanmaz; current schema ve veriyi operasyonel snapshot olarak tasir.

Amac:
- Canli PostgreSQL runtime/audit verisini deterministik sekilde export etmek
- Current runtime schema ile uyumlu P0 semayi kurmak
- Export edilen baseline'i bos PostgreSQL ortamina import etmek
- Import sonrasi artifact ile birebir dogrulama yapmak

## Kapsam (P0 tablolar)
- mod_logs
- timed_penalties
- timed_penalty_role_snapshots
- reaction_rules
- reaction_rule_logs
- reaction_rule_only_once_executions
- private_voice_rooms
- text_channel_lock_snapshots
- custom_commands
- custom_command_audit
- private_voice_room_logs

## Notlar
- Static config tablolari (`settings`, `bot_presence_settings`) ve retired tablolar bu kite
  dahil edilmez; current architecture'da runtime source degildirler.
- Artifact schema snapshot'i `sql/001_p0_schema.sql` dosyasinin birebir kopyasidir.
- Runtime repository veya bot davranisi bu kit ile degismez.

## Onkosullar
- PostgreSQL baglantisi icin `api/.env`
- Import icin `psql` PATH'te olmali
- PostgreSQL baglantisi `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` env ile
  veya `DATABASE_URL` ile verilmelidir

## Adimlar
1. PostgreSQL export artifact olustur:
```powershell
cd api
node scripts/pg-p0/pg_export_p0.js
```

2. PostgreSQL P0 semasini kur:
```powershell
psql -v ON_ERROR_STOP=1 -f scripts/pg-p0/sql/001_p0_schema.sql
```

3. Export edilen artifact'tan PostgreSQL'e import et:
```powershell
node scripts/pg-p0/pg_import_p0_from_export.js --artifact "<artifact_klasoru>"
```

4. Import sonrasi dogrulama:
```powershell
node scripts/pg-p0/pg_validate_p0_import.js --artifact "<artifact_klasoru>"
```

## Uretilen artifactlar
- `schema/001_p0_schema.sql`
- `data/<table>.csv`
- `data/<table>.ndjson`
- `meta/row_counts.json`
- `meta/timed_penalties_active.csv`
- `meta/reaction_only_once_summary.json`
- `meta/private_voice_rooms_active.csv`
- `meta/mod_logs_summary.json`
- `meta/manifest.json`
