//! Installed font families for Settings → Appearance (the webview can't enumerate them itself).

use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize)]
pub struct FontFamily {
    name: String,
    /// Every face of the family is monospaced (shown as a hint in the picker).
    mono: bool,
}

/// Family names of the system's fonts, sorted case-insensitively. Scans the font files, so it runs on a
/// blocking thread and only when the picker opens.
#[tauri::command]
pub async fn fonts_list() -> Result<Vec<FontFamily>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut families: BTreeMap<String, (String, bool)> = BTreeMap::new();
        for face in db.faces() {
            // The first family name is the English one when the font has it.
            let Some((name, _)) = face.families.first() else { continue };
            let name = name.trim();
            // Hidden/system-internal families start with a dot (e.g. macOS ".SF NS").
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            families
                .entry(name.to_lowercase())
                .and_modify(|(_, mono)| *mono &= face.monospaced)
                .or_insert_with(|| (name.to_string(), face.monospaced));
        }
        families.into_values().map(|(name, mono)| FontFamily { name, mono }).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_sorted_unique_families() {
        let list = tauri::async_runtime::block_on(super::fonts_list()).unwrap();
        let names: Vec<String> = list.iter().map(|f| f.name.to_lowercase()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(names, sorted);
        println!("{} families, {} monospaced", list.len(), list.iter().filter(|f| f.mono).count());
    }
}
