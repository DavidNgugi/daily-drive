# Daily Drive

A simple Mac workout companion. Built with Tauri 2, Rust, React, and TypeScript.

## What it does

- Shows the day's strength, treadmill, or rest plan and the matching meals.
- Shows a circular workout completion percentage, weight trend, and full-challenge day grid on Today.
- Includes a calendar of workouts and a weekly breakfast and dinner plan.
- Sounds a repeating Mac alarm and raises an always-on-top window at the chosen time, Monday–Saturday.
- Stops the alarm when you complete or deliberately skip today's workout.
- Counts unmarked workout days as missed from the date tracking began. Earlier days stay untracked. The Progress screen lets you correct a day later.
- Logs actual breakfast, lunch, dinner, and snacks separately from the suggested menu. Lunch is left open because the supplied menu did not assign lunches.
- Tracks weight, waist, and workouts over time. The current weight comes from the latest weigh-in.
- Lets you edit starting weight, target weight, and challenge dates in Settings.
- Saves progress locally in the app data folder.
- Launches at login when the installed release app runs. You can turn this off in Alarm settings.

The default alarm is **7:00 AM**. Change it in the app. The Mac must be awake, the app must be running, and system volume must be audible. Closing the window keeps the app running; choosing Quit from the app menu stops the alarm. A skip silences the alarm for that day; it does not erase your history.

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
