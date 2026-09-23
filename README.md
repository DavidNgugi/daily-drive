# Daily Drive

A simple Mac workout companion for the Sep 7–Nov 28, 2026 transformation plan. Built with Tauri 2, Rust, React, and TypeScript.

## What it does

- Shows the day's strength, treadmill, or rest plan and the matching meals.
- Sounds a repeating Mac alarm and raises an always-on-top window at the chosen time, Monday–Saturday.
- Stops the alarm when you mark today's workout complete.
- Tracks weekly weight, waist, and workouts completed.
- Saves progress locally in the app data folder.
- Launches at login when the installed release app runs. You can turn this off in Alarm settings.

The default alarm is **7:00 AM**. Change it in the app. The Mac must be awake, the app must be running, and system volume must be audible. Closing the window keeps the app running; choosing Quit from the app menu stops the alarm.

## Run from source

```sh
npm install
npm run tauri dev
```

## Build the Mac app

```sh
npm run tauri build -- --bundles app
```

The result is in `src-tauri/target/release/bundle/macos/Daily Drive.app`. Copy it to Applications and launch it once to register it for login. No cloud account is needed.
