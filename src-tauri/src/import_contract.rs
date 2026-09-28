use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::NaiveDate;

use super::{alarm_sound_path, validate_schedule, video_extension, ImportFile};

/// Parses the established desktop backup format without changing how saved
/// app data is represented. This is also the validation boundary used by the
/// import UI and contract tests.
pub(crate) fn parse_and_validate(contents: &str) -> Result<ImportFile, String> {
    let imported: ImportFile = serde_json::from_str(contents)
        .map_err(|_| "This file is not a valid Daily Drive export.".to_string())?;
    if imported.format != "daily-drive" || ![1, 2].contains(&imported.version) {
        return Err("This Daily Drive export version is not supported.".into());
    }

    let start = parse_date(&imported.data.plan.start_date, "plan")?;
    let end = parse_date(&imported.data.plan.end_date, "plan")?;
    if end < start
        || (end - start).num_days() > 365
        || !(30.0..=300.0).contains(&imported.data.plan.start_weight)
        || !(30.0..=300.0).contains(&imported.data.plan.target_weight)
    {
        return Err("The export contains an invalid challenge plan.".into());
    }
    parse_date(&imported.data.tracking_since, "tracking start")?;
    validate_schedule(&imported.data.schedule)?;
    alarm_sound_path(&imported.data.alarm_sound)?;

    let time = imported.data.alarm_time.as_bytes();
    if time.len() != 5
        || time[2] != b':'
        || !time[..2].iter().all(u8::is_ascii_digit)
        || !time[3..].iter().all(u8::is_ascii_digit)
        || time[..2].iter().fold(0, |n, digit| n * 10 + (digit - b'0')) >= 24
        || time[3..].iter().fold(0, |n, digit| n * 10 + (digit - b'0')) >= 60
    {
        return Err("The export contains an invalid alarm time.".into());
    }

    for date in imported
        .data
        .completed
        .iter()
        .chain(imported.data.skipped.keys())
        .chain(imported.data.measurements.keys())
        .chain(imported.data.meals.keys())
        .chain(imported.data.actual_workouts.keys())
    {
        parse_date(date, "history")?;
    }
    for video in &imported.videos {
        if video.source.len() > 2048 {
            return Err("The export contains an invalid video path.".into());
        }
        video_extension(std::path::Path::new(&video.source))?;
        if video.contents.len() > 1_400_000_000 {
            return Err("A video in the backup is too large.".into());
        }
        let bytes = BASE64
            .decode(&video.contents)
            .map_err(|_| "The export contains damaged video data.".to_string())?;
        if bytes.len() > 1_000_000_000 {
            return Err("A video in the backup is too large.".into());
        }
    }
    Ok(imported)
}

fn parse_date(value: &str, category: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("The export contains an invalid {category} date."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_export() -> String {
        let schedule = super::super::Schedule::default();
        json!({
            "format": "daily-drive",
            "version": 2,
            "data": {
                "alarmTime": "07:00",
                "alarmSound": "Sosumi",
                "trackingSince": "2026-09-01",
                "completed": [],
                "skipped": {},
                "measurements": {},
                "meals": {},
                "plan": {"startDate":"2026-09-01","endDate":"2026-10-01","startWeight":80.0,"targetWeight":75.0},
                "schedule": schedule,
                "onboardingComplete": true
            }
        }).to_string()
    }

    #[test]
    fn accepts_supported_legacy_backup_and_defaults_optional_fields() {
        let parsed = parse_and_validate(&valid_export()).unwrap();
        assert_eq!(parsed.version, 2);
        assert!(parsed.data.actual_workouts.is_empty());
    }

    #[test]
    fn rejects_unsupported_versions_and_invalid_dates() {
        let version = valid_export().replace("\"version\":2", "\"version\":9");
        assert!(parse_and_validate(&version)
            .err()
            .unwrap()
            .contains("version"));
        let date = valid_export().replace("2026-09-01", "2026-02-30");
        assert!(parse_and_validate(&date).err().unwrap().contains("date"));
    }

    #[test]
    fn rejects_invalid_times_without_panicking_on_unicode() {
        let time = valid_export().replace("07:00", "99:00");
        assert!(parse_and_validate(&time)
            .err()
            .unwrap()
            .contains("alarm time"));
        let unicode = valid_export().replace("07:00", "ééééé");
        assert!(parse_and_validate(&unicode)
            .err()
            .unwrap()
            .contains("alarm time"));
    }

    #[test]
    fn rejects_damaged_video_data_during_preview_validation() {
        let video = valid_export().replace(
            "\"version\":2",
            "\"version\":2,\"videos\":[{\"source\":\"workout.mp4\",\"contents\":\"!\"}]",
        );
        assert!(parse_and_validate(&video)
            .err()
            .unwrap()
            .contains("video data"));
    }
}
