# Technical Debt Notes

This project intentionally keeps some backward-compatible paths and files.
These are **not removed** to avoid breaking existing runtime flows.

## Deprecated / Legacy Kept Intentionally

1. `api/src/bot/moderation.ui.js`
- Kept for backward compatibility with older moderation UI response rendering.
- Current flow uses template-based sender from `application/messages/templateService.js`.

2. `api/src/voice/privateRoomService.js` mention-based whitelist session map
- Legacy mention-mode data structure is preserved for compatibility.
- Primary flow is user-select based (`pvru:sync:*`) whitelist management.

## Policy

- No file deletions.
- No feature removals.
- Backward-compatible hardening and incremental refactors only.
