use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use uuid::Uuid;

/// Stable key for the exact legacy export bytes. Re-importing the same file
/// can therefore be recognized even when its row timestamps are unchanged.
pub(crate) fn fingerprint(contents: &[u8]) -> String {
    let digest = Sha256::digest(contents);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn mark_imported(fingerprints: &mut BTreeSet<String>, contents: &[u8]) -> bool {
    fingerprints.insert(fingerprint(contents))
}

/// Stable UUID for a legacy record. `legacy_key` is the record's natural
/// location in the export (for example `workout:2` or `measurement:2026-09-01`),
/// so later exports update the same cloud record instead of creating copies.
pub(crate) fn record_id(entity_kind: &str, legacy_key: &str) -> Uuid {
    let name = format!("daily-drive:legacy:v1:{entity_kind}:{legacy_key}");
    Uuid::new_v5(&Uuid::NAMESPACE_URL, name.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_fingerprint_is_stable_and_content_sensitive() {
        assert_eq!(fingerprint(b"backup"), fingerprint(b"backup"));
        assert_ne!(fingerprint(b"backup"), fingerprint(b"backup "));
        assert_eq!(fingerprint(b"backup").len(), 64);
    }

    #[test]
    fn legacy_ids_are_stable_and_namespaced_by_kind() {
        assert_eq!(
            record_id("measurement", "2026-09-01"),
            record_id("measurement", "2026-09-01")
        );
        assert_ne!(
            record_id("measurement", "2026-09-01"),
            record_id("meal_log", "2026-09-01")
        );
        assert_ne!(
            record_id("measurement", "2026-09-01"),
            record_id("measurement", "2026-09-02")
        );
    }

    #[test]
    fn same_backup_fingerprint_is_applied_once() {
        let mut fingerprints = BTreeSet::new();
        assert!(mark_imported(&mut fingerprints, b"backup"));
        assert!(!mark_imported(&mut fingerprints, b"backup"));
        assert!(mark_imported(&mut fingerprints, b"updated backup"));
    }
}
