import { invoke } from '@tauri-apps/api/core';
import { LEFT_LIST_TAB_IDS, type LeftListTabId } from './modules';
import { oneOf } from './helpers';
import type { Weekday } from './formatDate';
import {
  DEFAULT_EDITOR_FONT_ID, DEFAULT_EDITOR_FONT_SIZE, DEFAULT_UI_FONT_ID, DEFAULT_UI_SCALE,
  normalizeEditorFontId, normalizeEditorFontSize, normalizeUIFontId, normalizeUIScale,
  type EditorFontSize, type FontId, type UIScale,
} from '../themes/theme';

/**
 * A vault's settings, as `settings.json` in its folder.
 *
 * Each group is a unit that a backup import can adopt individually
 * when merging. A new setting means: field in its group,
 * default in `DEFAULT_VAULT_SETTINGS`, validation in `normalizeVaultSettings`.
 *
 * Language and theme are not here: they belong to the installation
 * (`deviceSettings.ts`). A `settings.json` from before still holds them under
 * `appearance`; they are carried along unread, and the first start took them
 * over for the device.
 */
export interface AppearanceSettings {
  uiFont: FontId;
  editorFont: FontId;
  uiScale: UIScale;
  editorFontSize: EditorFontSize;
}

/** Days until permanent deletion; `null` = never. */
export const TRASH_RETENTION_OPTIONS = [7, 14, 30, 60, 90, null] as const;
export type TrashRetention = (typeof TRASH_RETENTION_OPTIONS)[number];
export const DEFAULT_TRASH_RETENTION: TrashRetention = 30;

export interface TrashSettings {
  retentionDays: TrashRetention;
}

/** Entries per list in the left sidebar; `null` = all. */
export const LEFT_LIST_LIMIT_OPTIONS = [10, 25, 50, 100, null] as const;
export type LeftListLimit = (typeof LEFT_LIST_LIMIT_OPTIONS)[number];
export const DEFAULT_LEFT_LIST_LIMIT: LeftListLimit = null;

export interface LeftListSettings {
  /** Which list the entry list shows — all entries or those of one module.
   *  Replaces the former tab selection `tabs`; an old `tabs` stays in the file
   *  via the spread in `normalizeVaultSettings`, for older builds. */
  list: LeftListTabId;
  limit: LeftListLimit;
}

export interface EmojiSettings {
  /** The emojis that every picker offers without a search; `null` = the built-in selection. */
  defaults: string[] | null;
}

/** Cap for a custom list — against bloated files, not for the UI. */
const MAX_EMOJI_DEFAULTS = 500;
const MAX_EMOJI_LENGTH = 32;

/** Largest edge length of inserted images in px; `null` = original. */
export const IMAGE_MAX_EDGE_OPTIONS = [1024, 1920, 2560, 3840, null] as const;
export type ImageMaxEdge = (typeof IMAGE_MAX_EDGE_OPTIONS)[number];
/** Largest file size after shrinking in MB; `null` = unlimited. */
export const IMAGE_MAX_SIZE_MB_OPTIONS = [1, 2, 5, 10, 20, null] as const;
export type ImageMaxSizeMb = (typeof IMAGE_MAX_SIZE_MB_OPTIONS)[number];

export interface ImageSettings {
  maxEdge: ImageMaxEdge;
  maxSizeMb: ImageMaxSizeMb;
  /** A photo that arrives as PNG is stored as JPEG at full size (`lib/imageLimits.ts`). */
  optimizePhotos: boolean;
}

export interface TagSettings {
  /** Whether unknown names become new tags — typed into the tag field, from
   *  a template, from a `.emerald` import. Off: new tags only in the
   *  tags dashboard. A backup always brings its tags along. */
  createInline: boolean;
}

/** What the editor formats by itself while typing and pasting. Applies to every editor opened afterwards. */
export interface EditorSettings {
  /** Markdown shortcuts: `# ` heading, `- ` and `1. ` lists, `> ` quote, `[ ] ` task, `**bold**`, `==highlighted==` … */
  markdownShortcuts: boolean;
  /** Typography: typographic quotation marks, dashes, arrows, fractions, ©. */
  typography: boolean;
  /** A typed or pasted address becomes a link. */
  autoLinks: boolean;
}

export interface JournalSettings {
  /** Whether a new journal entry gets the day's moon phase. */
  moonPhase: boolean;
}

/** How often the automatic backup runs — whole days only, the file name carries the date. */
export const BACKUP_INTERVAL_OPTIONS = ['daily', 'weekly', 'monthly'] as const;
export type BackupInterval = (typeof BACKUP_INTERVAL_OPTIONS)[number];
export const BACKUP_WEEKDAY_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly Weekday[];
/** How many automatic backups are kept; `null` = all. The numbers
 *  are checked once more by `KEEP_CHOICES` in `auto_backup.rs` — change both together. */
export const BACKUP_KEEP_OPTIONS = [3, 5, 10, 30, null] as const;
export type BackupKeep = (typeof BACKUP_KEEP_OPTIONS)[number];

/** The automatic backup. The target folder is deliberately not here: it belongs
 *  to the installation (`auto_backup.rs`), not to the vault — otherwise an
 *  imported backup would bring a foreign path along. */
export interface BackupSettings {
  auto: boolean;
  interval: BackupInterval;
  /** Applies to `weekly` only. */
  weekday: Weekday;
  keep: BackupKeep;
}

export interface VaultSettings {
  /** Not read, like `version` in `vaults.json`: only a shape that needs a
   *  conversion increments it. A higher number from a newer
   *  build stays — otherwise that build would get its own file back as an older
   *  one, although its unknown keys are still in it. */
  version: number;
  appearance: AppearanceSettings;
  trash: TrashSettings;
  leftList: LeftListSettings;
  emojis: EmojiSettings;
  images: ImageSettings;
  tags: TagSettings;
  editor: EditorSettings;
  journal: JournalSettings;
  backup: BackupSettings;
}

export type SettingsGroup = Exclude<keyof VaultSettings, 'version'>;

/** Each group exactly once — the record forces a new one not to be missing. */
const GROUP_SET: Record<SettingsGroup, true> = {
  appearance: true, trash: true, leftList: true, emojis: true, images: true, tags: true,
  editor: true, journal: true, backup: true,
};
export const SETTINGS_GROUPS = Object.keys(GROUP_SET) as SettingsGroup[];

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  version: 1,
  appearance: {
    uiFont: DEFAULT_UI_FONT_ID,
    editorFont: DEFAULT_EDITOR_FONT_ID,
    uiScale: DEFAULT_UI_SCALE,
    editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  },
  trash: {
    retentionDays: DEFAULT_TRASH_RETENTION,
  },
  leftList: {
    list: 'all',
    limit: DEFAULT_LEFT_LIST_LIMIT,
  },
  emojis: {
    defaults: null,
  },
  images: {
    maxEdge: null,
    maxSizeMb: null,
    optimizePhotos: true,
  },
  tags: {
    createInline: true,
  },
  editor: {
    markdownShortcuts: true,
    typography: true,
    autoLinks: true,
  },
  journal: {
    moonPhase: true,
  },
  backup: {
    auto: false,
    interval: 'weekly',
    weekday: 1,
    keep: 10,
  },
};


export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeEmojiList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter((e): e is string => typeof e === 'string' && e.length > 0 && e.length <= MAX_EMOJI_LENGTH);
  // Empty would mean: every picker opens without a selection. Better the built-in one then.
  return valid.length ? [...new Set(valid)].slice(0, MAX_EMOJI_DEFAULTS) : null;
}

/**
 * Turns arbitrary JSON into valid settings: every field is validated,
 * invalid values fall back to the default. Keys that this build does not know
 * stay — a newer version that opened the vault earlier
 * should find its settings again after a detour into an older one.
 */
/** A vault from the time of the tab selection in which exactly one tab was visible
 *  practically showed only that list — it stays that one. Otherwise "All". */
function legacySingleList(tabs: unknown): LeftListTabId {
  if (!Array.isArray(tabs)) return DEFAULT_VAULT_SETTINGS.leftList.list;
  const valid = LEFT_LIST_TAB_IDS.filter((id) => tabs.includes(id));
  return valid.length === 1 ? valid[0] : DEFAULT_VAULT_SETTINGS.leftList.list;
}

export function normalizeVaultSettings(raw: unknown): VaultSettings {
  const root = asRecord(raw);
  const appearance = asRecord(root.appearance);
  const trash = asRecord(root.trash);
  const leftList = asRecord(root.leftList);
  const emojis = asRecord(root.emojis);
  const images = asRecord(root.images);
  const tags = asRecord(root.tags);
  const editor = asRecord(root.editor);
  const journal = asRecord(root.journal);
  const backup = asRecord(root.backup);
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const version = typeof root.version === 'number' && Number.isInteger(root.version) && root.version > 1
    ? root.version
    : 1;
  return {
    ...root,
    version,
    appearance: {
      ...appearance,
      uiFont: normalizeUIFontId(asString(appearance.uiFont)),
      editorFont: normalizeEditorFontId(asString(appearance.editorFont)),
      uiScale: normalizeUIScale(appearance.uiScale),
      editorFontSize: normalizeEditorFontSize(appearance.editorFontSize),
    },
    trash: {
      ...trash,
      retentionDays: oneOf(trash.retentionDays, TRASH_RETENTION_OPTIONS, DEFAULT_TRASH_RETENTION),
    },
    leftList: {
      ...leftList,
      list: oneOf(leftList.list, LEFT_LIST_TAB_IDS, legacySingleList(leftList.tabs)),
      limit: oneOf(leftList.limit, LEFT_LIST_LIMIT_OPTIONS, DEFAULT_LEFT_LIST_LIMIT),
    },
    emojis: {
      ...emojis,
      defaults: normalizeEmojiList(emojis.defaults),
    },
    images: {
      ...images,
      maxEdge: oneOf(images.maxEdge, IMAGE_MAX_EDGE_OPTIONS, DEFAULT_VAULT_SETTINGS.images.maxEdge),
      maxSizeMb: oneOf(images.maxSizeMb, IMAGE_MAX_SIZE_MB_OPTIONS, DEFAULT_VAULT_SETTINGS.images.maxSizeMb),
      optimizePhotos: flag(images.optimizePhotos, DEFAULT_VAULT_SETTINGS.images.optimizePhotos),
    },
    tags: {
      ...tags,
      createInline: typeof tags.createInline === 'boolean' ? tags.createInline : DEFAULT_VAULT_SETTINGS.tags.createInline,
    },
    editor: {
      ...editor,
      markdownShortcuts: flag(editor.markdownShortcuts, DEFAULT_VAULT_SETTINGS.editor.markdownShortcuts),
      typography: flag(editor.typography, DEFAULT_VAULT_SETTINGS.editor.typography),
      autoLinks: flag(editor.autoLinks, DEFAULT_VAULT_SETTINGS.editor.autoLinks),
    },
    journal: {
      ...journal,
      moonPhase: flag(journal.moonPhase, DEFAULT_VAULT_SETTINGS.journal.moonPhase),
    },
    backup: {
      ...backup,
      auto: flag(backup.auto, DEFAULT_VAULT_SETTINGS.backup.auto),
      interval: oneOf(backup.interval, BACKUP_INTERVAL_OPTIONS, DEFAULT_VAULT_SETTINGS.backup.interval),
      weekday: oneOf(backup.weekday, BACKUP_WEEKDAY_OPTIONS, DEFAULT_VAULT_SETTINGS.backup.weekday),
      keep: oneOf(backup.keep, BACKUP_KEEP_OPTIONS, DEFAULT_VAULT_SETTINGS.backup.keep),
    },
  };
}

/**
 * The settings from a backup — `null` if it brings none.
 *
 * Unlike when reading one's own `settings.json`, unknown keys are dropped
 * here: a foreign file could bloat them arbitrarily, and the
 * ballast would land via the store in every later write (and fail
 * there at the size limit) and in the next export.
 */
export function importableSettings(raw: unknown): VaultSettings | null {
  if (!isPlainObject(raw)) return null;
  const normalized = normalizeVaultSettings(raw);
  const known: Record<string, unknown> = { version: normalized.version };
  for (const group of SETTINGS_GROUPS) {
    const values = normalized[group] as unknown as Record<string, unknown>;
    known[group] = Object.fromEntries(Object.keys(DEFAULT_VAULT_SETTINGS[group]).map((field) => [field, values[field]]));
  }
  return known as unknown as VaultSettings;
}

/**
 * The settings without the keys a `settings.json` from before still carries of
 * language and theme (`appearance.language`, `.theme`, `.customThemes`): they
 * belong to the device now, and an export must not carry them on.
 */
export function withoutDeviceKeys(settings: VaultSettings): VaultSettings {
  const appearance = { ...settings.appearance } as Record<string, unknown>;
  delete appearance.language;
  delete appearance.theme;
  delete appearance.customThemes;
  return { ...settings, appearance: appearance as unknown as VaultSettings['appearance'] };
}

/** `current` with the chosen groups from `incoming` — for merging a backup. */
export function withSettingsGroups(current: VaultSettings, incoming: VaultSettings, groups: readonly SettingsGroup[]): VaultSettings {
  const next: Record<string, unknown> = { ...current };
  for (const group of groups) next[group] = incoming[group];
  return next as unknown as VaultSettings;
}

/** Mirrors `VaultFileRead` in `src-tauri/src/vault.rs` — the answer of `read_vault_settings` and `read_vault_drafts`. */
export type VaultFileRead = { kind: 'missing' } | { kind: 'found'; contents: string } | { kind: 'unreadable' };

/**
 * `settings: null` if the vault has no usable file. `corrupt` means:
 * something is there, just nothing readable — it is not overwritten before the
 * user changes something themselves. It never locks the vault.
 */
export async function readVaultSettings(vaultId: string): Promise<{ settings: VaultSettings | null; corrupt: boolean }> {
  const read = await invoke<VaultFileRead>('read_vault_settings', { vaultId });
  if (read.kind === 'missing') return { settings: null, corrupt: false };
  if (read.kind === 'found') {
    try {
      return { settings: normalizeVaultSettings(JSON.parse(read.contents)), corrupt: false };
    } catch (err) {
      console.warn('[settings] unreadable settings.json, using defaults', err);
    }
  } else {
    console.warn('[settings] settings.json is not a readable file, using defaults');
  }
  return { settings: null, corrupt: true };
}

export function writeVaultSettings(vaultId: string, settings: VaultSettings): Promise<void> {
  return invoke('write_vault_settings', { vaultId, contents: JSON.stringify(settings, null, 2) });
}

// ── Transition from the app-wide settings ────────────────────────────────────

/**
 * Before the vault settings, language, theme and fonts applied app-wide
 * (localStorage). So that nothing jumps after the update, the first
 * start remembers the values of that time together with the vaults known then — each of them
 * adopts them as soon as it is opened without a `settings.json`. A vault
 * created later is not in the list and starts with the defaults.
 */
const LEGACY_SNAPSHOT_KEY = 'vault-settings-legacy';

interface LegacySnapshot {
  vaultIds: string[];
  appearance: AppearanceSettings;
}

/**
 * The keys under which the app-wide values were stored. They remain in use as
 * the boot mirror of the most recently opened vault's fonts: `main.tsx` starts
 * with them before a vault is loaded. Language and theme have a mirror of
 * their own (`DEVICE_MIRROR_KEYS` in `deviceSettings.ts`).
 */
export const APPEARANCE_MIRROR_KEYS = {
  uiFont: 'ui-font-id',
  editorFont: 'editor-font-id',
  uiScale: 'ui-scale',
  editorFontSize: 'editor-font-size',
} as const;

/** The appearance according to the boot mirror, validated like a file. */
export function readAppearanceMirror(): AppearanceSettings {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  return normalizeVaultSettings({
    appearance: {
      uiFont: read(APPEARANCE_MIRROR_KEYS.uiFont),
      editorFont: read(APPEARANCE_MIRROR_KEYS.editorFont),
      uiScale: read(APPEARANCE_MIRROR_KEYS.uiScale),
      editorFontSize: read(APPEARANCE_MIRROR_KEYS.editorFontSize),
    },
  }).appearance;
}

export function captureLegacySettings(vaultIds: string[]): void {
  try {
    if (localStorage.getItem(LEGACY_SNAPSHOT_KEY) !== null) return;
    const snapshot: LegacySnapshot = { vaultIds, appearance: readAppearanceMirror() };
    localStorage.setItem(LEGACY_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('[settings] could not capture legacy settings', err);
  }
}

/** The starting values of a vault without `settings.json`. */
export function initialSettingsFor(vaultId: string): VaultSettings {
  try {
    const snapshot = JSON.parse(localStorage.getItem(LEGACY_SNAPSHOT_KEY) ?? 'null') as LegacySnapshot | null;
    if (snapshot && Array.isArray(snapshot.vaultIds) && snapshot.vaultIds.includes(vaultId)) {
      return normalizeVaultSettings({ appearance: snapshot.appearance });
    }
  } catch {
    // Broken snapshot: then the defaults, so be it.
  }
  return structuredClone(DEFAULT_VAULT_SETTINGS);
}
