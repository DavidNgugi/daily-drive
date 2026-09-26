# Daily Drive project instructions

- After making a key application or user-facing change, rebuild the macOS app and reinstall it at `/Applications/Daily Drive.app` so the installed copy reflects the change. Preserve user data outside the app bundle.
- Local builds cannot sign Tauri updater artifacts because the private signing key is stored in GitHub Actions. For local rebuilds, disable only `bundle.createUpdaterArtifacts` in a temporary Tauri config override; keep the configured updater public key and do not generate or use a replacement updater key.
- If the build requires replacing the installed app, quit Daily Drive first and launch the rebuilt app after installation.
- Before approaching a context, token, or execution limit, give the user a concise handoff summary of what was completed, what is in progress, any blockers or temporary changes, and the exact next steps. Do this while there is still enough capacity to continue or hand off safely.
