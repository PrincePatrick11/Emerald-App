import { invoke } from '@tauri-apps/api/core';
import { LEFT_LIST_TAB_IDS, type LeftListTabId } from './modules';
import { oneOf } from './helpers';
import { LANGUAGE_OPTIONS, LANGUAGE_STORAGE_KEY, type AppLanguage } from '../i18n';
import {
  DEFAULT_EDITOR_FONT_ID, DEFAULT_EDITOR_FONT_SIZE, DEFAULT_THEME_ID, DEFAULT_UI_FONT_ID, DEFAULT_UI_SCALE,
  normalizeEditorFontId, normalizeEditorFontSize, normalizeThemeId, normalizeUIFontId, normalizeUIScale,
  type EditorFontSize, type FontId, type ThemeId, type UIScale,
} from '../themes/theme';

/**
 * Die Einstellungen eines Vaults, als `settings.json` in dessen Ordner.
 *
 * Jede Gruppe ist eine Einheit, die ein Backup-Import beim Zusammenführen
 * einzeln übernehmen kann. Eine neue Einstellung heißt: Feld in ihrer Gruppe,
 * Standard in `DEFAULT_VAULT_SETTINGS`, Prüfung in `normalizeVaultSettings`.
 */
export interface AppearanceSettings {
  language: AppLanguage;
  theme: ThemeId;
  uiFont: FontId;
  editorFont: FontId;
  uiScale: UIScale;
  editorFontSize: EditorFontSize;
}

/** Tage bis zum endgültigen Löschen; `null` = nie. */
export const TRASH_RETENTION_OPTIONS = [7, 14, 30, 60, 90, null] as const;
export type TrashRetention = (typeof TRASH_RETENTION_OPTIONS)[number];
export const DEFAULT_TRASH_RETENTION: TrashRetention = 30;

export interface TrashSettings {
  retentionDays: TrashRetention;
}

/** Einträge je Liste in der linken Seitenleiste; `null` = alle. */
export const LEFT_LIST_LIMIT_OPTIONS = [10, 25, 50, 100, null] as const;
export type LeftListLimit = (typeof LEFT_LIST_LIMIT_OPTIONS)[number];
export const DEFAULT_LEFT_LIST_LIMIT: LeftListLimit = null;

export interface LeftListSettings {
  /** Die sichtbaren Tabs, in der Reihenfolge der Leiste; nie leer. */
  tabs: LeftListTabId[];
  limit: LeftListLimit;
}

export interface EmojiSettings {
  /** Die Emojis, die jeder Picker ohne Suche anbietet; `null` = die eingebaute Auswahl. */
  defaults: string[] | null;
}

/** Deckel für eine eigene Liste — gegen aufgeblähte Dateien, nicht für die Oberfläche. */
const MAX_EMOJI_DEFAULTS = 500;
const MAX_EMOJI_LENGTH = 32;

/** Größte Kantenlänge eingefügter Bilder in px; `null` = Original. */
export const IMAGE_MAX_EDGE_OPTIONS = [1024, 1920, 2560, 3840, null] as const;
export type ImageMaxEdge = (typeof IMAGE_MAX_EDGE_OPTIONS)[number];
/** Größte Dateigröße nach dem Verkleinern in MB; `null` = unbegrenzt. */
export const IMAGE_MAX_SIZE_MB_OPTIONS = [1, 2, 5, 10, 20, null] as const;
export type ImageMaxSizeMb = (typeof IMAGE_MAX_SIZE_MB_OPTIONS)[number];

export interface ImageSettings {
  maxEdge: ImageMaxEdge;
  maxSizeMb: ImageMaxSizeMb;
}

export interface TagSettings {
  /** Ob das Tag-Feld (Einträge, Vorlagen) unbekannte Namen als neue Tags
   *  anlegt. Aus: neue Tags nur im Tags-Dashboard, und eine Vorlage bringt
   *  nur Tags mit, die es gibt. Importe legen fehlende Tags immer an. */
  createInline: boolean;
}

export interface VaultSettings {
  /** Nicht gelesen, wie `version` in `vaults.json`: erst eine Form, die eine
   *  Umrechnung braucht, zählt ihn hoch. Eine höhere Zahl aus einem neueren
   *  Build bleibt stehen — sonst bekäme der seine eigene Datei als ältere
   *  zurück, obwohl ihre unbekannten Schlüssel noch drin sind. */
  version: number;
  appearance: AppearanceSettings;
  trash: TrashSettings;
  leftList: LeftListSettings;
  emojis: EmojiSettings;
  images: ImageSettings;
  tags: TagSettings;
}

export type SettingsGroup = Exclude<keyof VaultSettings, 'version'>;

/** Jede Gruppe genau einmal — der Record erzwingt, dass eine neue nicht fehlt. */
const GROUP_SET: Record<SettingsGroup, true> = {
  appearance: true, trash: true, leftList: true, emojis: true, images: true, tags: true,
};
export const SETTINGS_GROUPS = Object.keys(GROUP_SET) as SettingsGroup[];

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  version: 1,
  appearance: {
    language: 'en',
    theme: DEFAULT_THEME_ID,
    uiFont: DEFAULT_UI_FONT_ID,
    editorFont: DEFAULT_EDITOR_FONT_ID,
    uiScale: DEFAULT_UI_SCALE,
    editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  },
  trash: {
    retentionDays: DEFAULT_TRASH_RETENTION,
  },
  leftList: {
    tabs: [...LEFT_LIST_TAB_IDS],
    limit: DEFAULT_LEFT_LIST_LIMIT,
  },
  emojis: {
    defaults: null,
  },
  images: {
    maxEdge: null,
    maxSizeMb: null,
  },
  tags: {
    createInline: true,
  },
};

const LANGUAGES = new Set<string>(LANGUAGE_OPTIONS.map((o) => o.code));

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
  // Leer hieße: jeder Picker öffnet ohne Auswahl. Dann lieber die eingebaute.
  return valid.length ? [...new Set(valid)].slice(0, MAX_EMOJI_DEFAULTS) : null;
}

/**
 * Macht aus beliebigem JSON gültige Einstellungen: jedes Feld wird geprüft,
 * Ungültiges fällt auf den Standard. Schlüssel, die dieser Build nicht kennt,
 * bleiben stehen — eine neuere Version, die den Vault vorher geöffnet hat,
 * soll ihre Einstellungen nach einem Abstecher in eine ältere wiederfinden.
 */
export function normalizeVaultSettings(raw: unknown): VaultSettings {
  const root = asRecord(raw);
  const appearance = asRecord(root.appearance);
  const language = asString(appearance.language);
  const trash = asRecord(root.trash);
  const leftList = asRecord(root.leftList);
  const emojis = asRecord(root.emojis);
  const images = asRecord(root.images);
  const tags = asRecord(root.tags);
  const tabs = Array.isArray(leftList.tabs) ? LEFT_LIST_TAB_IDS.filter((id) => (leftList.tabs as unknown[]).includes(id)) : [];
  const version = typeof root.version === 'number' && Number.isInteger(root.version) && root.version > 1
    ? root.version
    : 1;
  return {
    ...root,
    version,
    appearance: {
      ...appearance,
      language: language && LANGUAGES.has(language) ? (language as AppLanguage) : DEFAULT_VAULT_SETTINGS.appearance.language,
      theme: normalizeThemeId(asString(appearance.theme)),
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
      tabs: tabs.length ? tabs : [...LEFT_LIST_TAB_IDS],
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
    },
    tags: {
      ...tags,
      createInline: typeof tags.createInline === 'boolean' ? tags.createInline : DEFAULT_VAULT_SETTINGS.tags.createInline,
    },
  };
}

/**
 * Die Einstellungen aus einer Sicherung — `null`, wenn sie keine mitbringt.
 *
 * Anders als beim Lesen der eigenen `settings.json` fallen hier unbekannte
 * Schlüssel weg: eine fremde Datei könnte sie beliebig aufblähen, und der
 * Ballast landete über den Store in jedem späteren Schreiben (und scheiterte
 * dort an der Größengrenze) und im nächsten Export.
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

/** `current` mit den gewählten Gruppen aus `incoming` — fürs Zusammenführen einer Sicherung. */
export function withSettingsGroups(current: VaultSettings, incoming: VaultSettings, groups: readonly SettingsGroup[]): VaultSettings {
  const next: Record<string, unknown> = { ...current };
  for (const group of groups) next[group] = incoming[group];
  return next as unknown as VaultSettings;
}

/** Mirrors `SettingsRead` in `src-tauri/src/vault.rs`. */
type SettingsRead = { kind: 'missing' } | { kind: 'found'; contents: string } | { kind: 'unreadable' };

/**
 * `settings: null`, wenn der Vault keine brauchbare Datei hat. `corrupt` heißt:
 * da liegt etwas, nur nichts Lesbares — das wird nicht überschrieben, bevor der
 * Nutzer selbst etwas ändert. Den Vault sperrt es nie.
 */
export async function readVaultSettings(vaultId: string): Promise<{ settings: VaultSettings | null; corrupt: boolean }> {
  const read = await invoke<SettingsRead>('read_vault_settings', { vaultId });
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

// ── Umstieg von den app-weiten Einstellungen ─────────────────────────────────

/**
 * Vor den Vault-Einstellungen galten Sprache, Theme und Schriften app-weit
 * (localStorage). Damit nach dem Update nichts umspringt, merkt sich der erste
 * Start die damaligen Werte samt der damals bekannten Vaults — jeder davon
 * übernimmt sie, sobald er ohne `settings.json` geöffnet wird. Ein später
 * angelegter Vault kommt in der Liste nicht vor und startet mit den Standards.
 */
const LEGACY_SNAPSHOT_KEY = 'vault-settings-legacy';

interface LegacySnapshot {
  vaultIds: string[];
  appearance: AppearanceSettings;
}

/**
 * Die Schlüssel, unter denen die app-weiten Werte lagen. Sie bleiben als
 * Boot-Spiegel des zuletzt geöffneten Vaults in Gebrauch: `main.tsx` startet
 * damit, bevor ein Vault geladen ist. Das Boot-Skript in `index.html` liest
 * `theme-id` von Hand mit — es läuft vor dem Bundle.
 */
export const APPEARANCE_MIRROR_KEYS = {
  language: LANGUAGE_STORAGE_KEY,
  theme: 'theme-id',
  uiFont: 'ui-font-id',
  editorFont: 'editor-font-id',
  uiScale: 'ui-scale',
  editorFontSize: 'editor-font-size',
} as const;

/** Das Aussehen laut Boot-Spiegel, geprüft wie eine Datei. */
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
      language: read(APPEARANCE_MIRROR_KEYS.language),
      // `theme` ist der Schlüssel von vor den Theme-Ids ('light'/'dark').
      theme: read(APPEARANCE_MIRROR_KEYS.theme) ?? read('theme'),
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

/** Die Startwerte eines Vaults ohne `settings.json`. */
export function initialSettingsFor(vaultId: string): VaultSettings {
  try {
    const snapshot = JSON.parse(localStorage.getItem(LEGACY_SNAPSHOT_KEY) ?? 'null') as LegacySnapshot | null;
    if (snapshot && Array.isArray(snapshot.vaultIds) && snapshot.vaultIds.includes(vaultId)) {
      return normalizeVaultSettings({ appearance: snapshot.appearance });
    }
  } catch {
    // Kaputter Schnappschuss: dann eben die Standards.
  }
  return structuredClone(DEFAULT_VAULT_SETTINGS);
}
