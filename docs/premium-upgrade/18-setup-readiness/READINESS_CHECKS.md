# Readiness Checks

## Status Model
- `ready`: check passed
- `warning`: non-blocking concern or unverified state
- `incomplete`: setup gap that blocks full readiness

Summary status is derived as:
1. `incomplete` if any incomplete checks exist
2. `warning` if no incomplete checks and at least one warning
3. `ready` otherwise

## Scoring
- Weighted score: `(passed + warning * 0.5) / total * 100`
- Rounded and clamped to `0..100`

## Implemented Sections

### 1) Statik Yapilandirma (`static-config`)
- Explicit guild static config present vs defaults fallback
- Example reason codes:
  - `static_config_explicit_present`
  - `static_config_defaults_in_use`

### 2) Ozel Oda Sistemi (`private-room`)
- `private_vc_enabled`
- Hub channel configured and valid
- Required role configured and valid
- Category optional check (warn/info when not set)
- Example reason codes:
  - `private_vc_disabled`
  - `private_vc_hub_channel_missing`
  - `private_vc_required_role_missing`
  - `private_vc_category_not_set`

### 3) Baslangic Ses Kanali (`startup-voice`)
- Startup channel configured or not
- Channel ID format
- Fallback source visibility (static vs env fallback)
- Example reason codes:
  - `startup_voice_channel_not_configured`
  - `startup_voice_channel_env_fallback`
  - `startup_voice_channel_invalid`

### 4) Moderasyon Rolleri (`moderation-roles`)
- Mute/jail/lock policy visibility
- Role checks conditioned by relevant policy flags
- Example reason codes:
  - `moderation_mute_role_not_configured`
  - `moderation_jail_role_missing`
  - `moderation_lock_role_missing`

### 5) Tag Rol Sistemi (`tag-role`)
- `tag_enabled`
- `tag_role` when enabled
- `tag_text` when enabled
- Example reason codes:
  - `tag_disabled`
  - `tag_role_missing`
  - `tag_text_missing`

### 6) Komut Politikalari (`command-policy`)
- Read-only visibility for command policy flags:
  - `log_enabled`, `warn_enabled`, `mute_enabled`, `kick_enabled`, `jail_enabled`, `ban_enabled`, `lock_enabled`
- No mutation behavior

## Safety Notes
- Checks are read-only snapshots.
- No external destructive runtime calls.
- Resource existence is verified conservatively from safely available static context.
