//! The one file the user chose for the import themselves — in the import
//! window's open dialog, or by dragging it into the window — which may be read
//! wherever it lies: a backup on another drive or a USB stick comes in without
//! being copied into the user's folders first.
//!
//! The choice is taken where the frontend cannot fake it: the open dialog is
//! opened here (`pick_import_file`), and a drop is the operating system's event,
//! which reaches Rust before the page hears of it (`note_drop`). The frontend
//! still names the path it wants to read, but outside the fixed roots that is
//! honoured only when it is exactly the file remembered here. Nothing else is
//! loosened: only reading, only the import's two readers (`read_emerald_file`,
//! and `read_file` for Markdown), only the endings the import window takes,
//! never a link or a folder, and only the latest choice — each new one
//! replaces it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// The endings the import window takes (`isImportPath` in
/// `src/lib/importPaths.ts`); `.vault.emerald` ends in `.emerald`.
const IMPORT_ENDINGS: [&str; 2] = ["emerald", "md"];

#[derive(Default)]
pub struct ChosenFile(Mutex<Option<PathBuf>>);

impl ChosenFile {
    fn set(&self, path: Option<PathBuf>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = path;
    }

    /// Whether `canonical` is the file chosen last.
    fn is(&self, canonical: &Path) -> bool {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).as_deref() == Some(canonical)
    }
}

fn import_ending(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| IMPORT_ENDINGS.iter().any(|ending| ext.eq_ignore_ascii_case(ending)))
}

/// The form a chosen file is remembered and compared in: an absolute path to
/// a plain file — no link, no folder — with an ending the import takes,
/// canonicalized. `None` for anything else.
fn resolve(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || !import_ending(path) {
        return None;
    }
    // `symlink_metadata`, as `guarded_read_path`: a link is refused, not followed.
    if !std::fs::symlink_metadata(path).ok()?.file_type().is_file() {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

/// Files dropped onto the main window. The import window takes the first one
/// with an ending of its own (`ImportModal`), so that one becomes the choice;
/// a drop without such a file — pictures for "Images", say — leaves the
/// previous choice alone. Called from the window event, before the page sees
/// the drop.
pub fn note_drop(app: &tauri::AppHandle, paths: &[PathBuf]) {
    if let Some(choice) = drop_choice(paths) {
        app.state::<ChosenFile>().set(choice);
    }
}

/// What a drop makes the choice: `None` leaves it alone, `Some(None)` clears
/// it (the import's file is a link, a folder, gone).
fn drop_choice(paths: &[PathBuf]) -> Option<Option<PathBuf>> {
    paths.iter().find(|path| import_ending(path)).map(|first| resolve(first))
}

/// The path a reader of the import may open: inside the fixed roots under
/// `guarded_read_path`'s rules as always, outside them only when it is the
/// file the user chose last. Its errors stay those of `guarded_read_path`.
pub(crate) fn guarded_import_read(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    if let Some(canonical) = resolve(Path::new(path)) {
        if app.state::<ChosenFile>().is(&canonical) {
            return Ok(canonical);
        }
    }
    crate::guarded_read_path(app, path)
}

/// The import window's open dialog, opened here so that the choice is the
/// user's and not the page's. `None` when it was cancelled. The path comes
/// back for display and for the readers, which accept it outside the fixed
/// roots only because it is remembered here.
#[tauri::command]
pub async fn pick_import_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    filter_name: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // As in `pick_auto_backup_dir`: with the dev bridge, a client that
        // drives an instance out of sight answers instead of a native dialog.
        #[cfg(feature = "devbridge")]
        let held = crate::devbridge::pick_file(&app);
        #[cfg(not(feature = "devbridge"))]
        let held: Option<Option<PathBuf>> = None;
        let picked = match held {
            Some(answer) => answer,
            None => match app
                .dialog()
                .file()
                .set_parent(&window)
                .add_filter(filter_name, &IMPORT_ENDINGS)
                .blocking_pick_file()
            {
                Some(picked) => Some(picked.into_path().map_err(|e| e.to_string())?),
                None => None,
            },
        };
        let Some(path) = picked else {
            return Ok(None);
        };
        // A name that is not UTF-8 could not come back as the same path.
        let text = path.to_str().ok_or("file name is not valid UTF-8")?.to_string();
        // A link, a folder or a wrong ending is not remembered: reading it then
        // fails as it always did, with the reader's own error.
        app.state::<ChosenFile>().set(resolve(&path));
        Ok(Some(text))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("emerald-chosen-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn endings_are_the_import_windows() {
        assert!(import_ending(Path::new("/x/backup.vault.emerald")));
        assert!(import_ending(Path::new("/x/Notes.MD")));
        assert!(!import_ending(Path::new("/x/secrets.json")));
        assert!(!import_ending(Path::new("/x/emerald")));
    }

    #[test]
    fn resolves_plain_files_only() {
        let dir = scratch("resolve");
        let file = dir.join("a.emerald");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(resolve(&file), Some(std::fs::canonicalize(&file).unwrap()));

        // A folder with the ending, a wrong ending, a relative path, a missing file.
        let folder = dir.join("b.emerald");
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(resolve(&folder), None);
        let other = dir.join("c.txt");
        std::fs::write(&other, b"x").unwrap();
        assert_eq!(resolve(&other), None);
        assert_eq!(resolve(Path::new("a.emerald")), None);
        assert_eq!(resolve(&dir.join("missing.emerald")), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_link() {
        let dir = scratch("link");
        let file = dir.join("a.emerald");
        std::fs::write(&file, b"x").unwrap();
        let link = dir.join("link.emerald");
        std::os::unix::fs::symlink(&file, &link).unwrap();
        assert_eq!(resolve(&link), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_drop_chooses_its_first_import_file() {
        let dir = scratch("drop");
        let picture = dir.join("p.png");
        let backup = dir.join("b.vault.emerald");
        let notes = dir.join("n.md");
        for file in [&picture, &backup, &notes] {
            std::fs::write(file, b"x").unwrap();
        }
        assert_eq!(drop_choice(&[picture.clone()]), None);
        assert_eq!(
            drop_choice(&[picture.clone(), backup.clone(), notes.clone()]),
            Some(Some(std::fs::canonicalize(&backup).unwrap()))
        );
        // The first import file is gone: the choice is cleared, not the next one taken.
        assert_eq!(drop_choice(&[dir.join("gone.emerald"), notes]), Some(None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_latest_choice_replaces_the_previous_one() {
        let dir = scratch("latest");
        let (a, b) = (dir.join("a.emerald"), dir.join("b.md"));
        std::fs::write(&a, b"x").unwrap();
        std::fs::write(&b, b"x").unwrap();
        let first = std::fs::canonicalize(&a).unwrap();
        let second = std::fs::canonicalize(&b).unwrap();
        let chosen = ChosenFile::default();
        assert!(!chosen.is(&first));
        chosen.set(Some(first.clone()));
        assert!(chosen.is(&first));
        chosen.set(Some(second.clone()));
        assert!(!chosen.is(&first) && chosen.is(&second));
        chosen.set(None);
        assert!(!chosen.is(&second));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
