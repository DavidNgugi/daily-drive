# Legacy import identity contract

The existing desktop file remains unchanged. Its JSON parser validates the
current `daily-drive` v1/v2 envelope, while the sync adapter maps legacy
locations to deterministic UUIDv5 identifiers using the fixed
`daily-drive:legacy:v1` name namespace.

| Legacy record | Stable natural key |
| --- | --- |
| Imported challenge | `challenge:primary` |
| Weekly workout plan entry | `workout_plan_entry:weekly:<Sunday-zero weekday>` |
| Weekly workout exercise | `workout_plan_exercise:weekly:<weekday>:<position>` |
| Weekly meal plan entry | `meal_plan_entry:weekly:<Sunday-zero weekday>` |
| Workout date override | `workout_plan_entry:date:<YYYY-MM-DD>` |
| Override exercise | `workout_plan_exercise:date:<YYYY-MM-DD>:<position>` |
| Meal date override | `meal_plan_entry:date:<YYYY-MM-DD>` |
| Workout status | `workout_day_status:<YYYY-MM-DD>` |
| Actual workout (legacy maximum one per date) | `actual_workout:<YYYY-MM-DD>` |
| Actual exercise | `actual_workout_exercise:<YYYY-MM-DD>:<position>` |
| Meal log | `meal_log:<YYYY-MM-DD>` |
| Measurement | `measurement:<YYYY-MM-DD>` |
| Profile and reminder settings | Server-owned `user_id` primary key |

The complete source file's SHA-256 is its import fingerprint. The desktop
persists imported fingerprints in its local data so applying the exact same
backup twice is a no-op. Record IDs are independent of that fingerprint, so a
later backup updates the same logical records. The fingerprint identifies an
import operation; UUIDv5 IDs identify the legacy record across import versions.
