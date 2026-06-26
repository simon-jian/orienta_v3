# Legacy Code

This folder keeps code that is no longer wired into the active dashboard, but may still be useful for reference or future restoration.

Guidelines:

- Active application code should stay under `src/`.
- Move unused components here instead of leaving them mixed into active source folders.
- If a legacy file is restored, update its imports and move it back under `src/`.
- Prefer deleting legacy code once it is clearly obsolete.
