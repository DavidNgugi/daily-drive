# Daily Drive releases and updates

## What is already configured

- Pushing a matching `v*` tag starts a macOS release build. You can also start one from **GitHub → Actions → Desktop release → Run workflow**.
- The workflow caches Rust build output and npm packages to shorten repeat builds.
- Tauri signs in-app update bundles. The public key is embedded in `src-tauri/tauri.conf.json`; the private key and its password are GitHub Actions secrets.
- Users can see the app version and check for and install updates from **Settings → App updates**. GitHub Releases hosts the installer and update metadata.
- Apple signing and notarization are optional setup steps for this workflow. Until configured, it uses ad-hoc signing and releases are not notarized.

## GitHub secrets

Add secrets in the repository at **Settings → Secrets and variables → Actions → New repository secret**. The release workflow already reads these names.

| Secret | Where to get it | Notes |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Already generated and stored in the repository’s Actions secrets | Keep a separate secure backup. It is needed for every future in-app update. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Already generated and stored in the repository’s Actions secrets | Keep with the private key backup. |
| `APPLE_CERTIFICATE` | Export a **Developer ID Application** certificate and its private key from Keychain Access as a `.p12` file. Base64-encode that file before adding it. | A paid Apple Developer Program account with access to Certificates, Identifiers & Profiles is required to create a Developer ID certificate. This is the certificate, not an Apple Distribution certificate. |
| `APPLE_CERTIFICATE_PASSWORD` | Set when exporting the `.p12` from Keychain Access | This is the `.p12` export password. |
| `APPLE_SIGNING_IDENTITY` | Keychain Access certificate name, usually `Developer ID Application: Name (TEAMID)` | Use the full identity string shown for the installed certificate. |
| `APPLE_ID` | The Apple Account email used for the developer team | Used by Apple’s notarization service. |
| `APPLE_PASSWORD` | Create an app-specific password at [account.apple.com](https://account.apple.com/) under **Sign-In and Security → App-Specific Passwords** | Do not use the normal Apple Account password. |
| `APPLE_TEAM_ID` | Apple Developer account **Membership details** | Usually a 10-character team identifier. |

The certificate must include its private key. Exporting only a `.cer` file is not enough. Treat the `.p12` file, its password, and the app-specific password as credentials; don’t commit them or paste them into source files. Once the Apple secrets are saved, the release workflow will sign with Developer ID and submit releases for notarization.

### Base64-encode the certificate

On macOS, run this locally and copy the output into the `APPLE_CERTIFICATE` secret:

```sh
base64 -i DeveloperIDApplication.p12 | tr -d '\n'
```

The base64 value is still a secret. Don’t save it in the repository.

## Publish a version

Update all app version fields together using the project script, then commit and push the matching tag:

```sh
npm run version:set -- 0.1.1
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git commit -m "Release v0.1.1"
git tag v0.1.1
git push origin main --tags
```

The tag must match the version in `package.json`; the workflow checks this before building. The release action creates a GitHub release, uploads the macOS app and DMG, and publishes updater metadata. Once available, installed copies can update from **Settings → App updates**.

## If the updater signing key needs to be replaced

Replacing the Tauri updater key breaks updates for app installations that trust the current public key. Preserve the generated private key and password in a secure password manager or encrypted backup. If they are lost, existing users need to install a newly signed app manually before in-app updates will work again.
