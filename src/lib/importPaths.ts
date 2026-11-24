/**
 * The files the import window takes, by their ending — chosen in its dialog or
 * dragged in alike: `.emerald` and `.md`. `.vault.emerald` ends in `.emerald`;
 * what a file really is, Rust reads from its header. The same two endings are
 * the dialog's filter and what Rust remembers as the user's choice
 * (`IMPORT_ENDINGS` in `chosen_file.rs`). A module of its own: the picture
 * drops ask it too, without loading the import.
 */
// A name before the ending, as Rust's `Path::extension` wants: `.md` alone is no Markdown file.
const IMPORT_PATH_RE = /[^\\/]\.(emerald|md)$/i;

export function isImportPath(path: string): boolean {
  return IMPORT_PATH_RE.test(path);
}
