# Capability Matrix

| Capability | Required Plan | Active Now? | Gating Mode | Current Usage |
|---|---|---|---|---|
| `protected_dashboard` | `free` | Yes | `enforced` | Existing protected dashboard flows (auth+guild protected routes). |
| `dashboard_preferences_read` | `free` | Yes | `enforced` | Existing protected preferences read contract. |
| `dashboard_preferences_write` | `free` | Yes | `enforced` | Existing low-risk preferences write seam. |
| `advanced_dashboard_preferences` | `pro` | Yes | `annotated_only` | Exposed in capability payloads; not hard-blocking existing routes yet. |
| `future_reaction_rules_write` | `pro` | No | `future_only` | Visibility only; no write route activated. |
| `future_private_room_advanced` | `business` | No | `future_only` | Visibility only; no write route activated. |
| `future_moderation_write` | `business` | No | `future_only` | Visibility only; no write route activated. |

## Active vs future-only notes
- `future_only` capabilities always deny (`capability_not_active`) even for higher plans.
- `annotated_only` capability is evaluable and visible now, but route-level hard enforcement is intentionally deferred.

## Annotated vs actually gated
- Existing route behavior was preserved.
- New plan/capability data is exposed via read-only contracts and protected dashboard context payloads.
- No previously working route was newly premium-blocked in this phase.
