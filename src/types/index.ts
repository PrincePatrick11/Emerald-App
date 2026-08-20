export type ContentType = 'journal' | 'wiki' | 'operation';

export interface JournalEntry {
  id: string;
  title: string;
  content: string; // TipTap JSON serialized
  created_at: string;
  updated_at: string;
  tags: string[];
  moon_phase: string | null;
  mood: string | null;
  paradigm_id: string | null;
  linked_operation_ids: string[] | null;
  linked_wiki_ids: string[] | null;
  is_bannung: boolean;
  bannung_type_wiki_id: string | null;
  is_meditation: boolean;
  meditation_duration: number | null;
  meditation_type_wiki_id: string | null;
  deleted_at: string | null;
  entry_number?: number;
}

export interface WikiArticle {
  id: string;
  title: string;
  slug: string;
  content: string; // TipTap JSON serialized
  category_id: WikiCategory;
  created_at: string;
  updated_at: string;
  tags: string[];
  deleted_at: string | null;
  cover_image?: string;
  icon?: string;
  entry_number?: number;
}

export interface CategoryBase {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  is_builtin: boolean;
}

export interface OperationCategory extends CategoryBase {}

export interface WikiCategoryDef extends CategoryBase {}

export interface Operation {
  id: string;
  title: string;
  content: string;
  category_id: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  deleted_at: string | null;
  is_active: boolean;
  end_date: string | null;
  version: string | null;
  entry_number?: number;
  icon?: string;
  cover_image?: string;
  description?: string;
  target_reveal_date?: string | null;
  charging_technique_wiki_id?: string | null;
  is_loaded?: boolean;
  intention_text?: string;
  letter_bank?: string[];
  implemented_letters?: string[];
  show_intention_in_properties?: boolean;
  show_letter_bank_in_properties?: boolean;
  show_sigil?: boolean;
  drawing_data?: string | null;
  thumbnail_data?: string | null;
}

export interface TrashedItem {
  id: string;
  title: string;
  type: 'journal' | 'wiki' | 'tag' | 'operation' | 'wiki_category' | 'operation_category' | 'task' | 'task_category';
  deleted_at: string;
  category?: string;
}

export type WikiCategory = string;

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface InternalLink {
  source_id: string;
  source_type: ContentType;
  target_id: string;
  target_type: ContentType;
}

export interface Routine {
  id: string;
  name: string;
  emoji: string;
  content: string; // plain text; newlines → paragraphs on drop
  tags: string[];
  operation_ids: string[];
  wiki_ids: string[];
  created_at: string;
  updated_at: string;
}


export type MoonPhase =
  | 'new'
  | 'waxing_crescent'
  | 'first_quarter'
  | 'waxing_gibbous'
  | 'full'
  | 'waning_gibbous'
  | 'last_quarter'
  | 'waning_crescent';

export type AltarItemCategory = string;

export interface AltarCategory {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
}

export interface AltarRecord {
  id: string;
  title: string;
  intention: string;
  background_preset: string;
  background_image_data: string | null;
  background_overlay: number;
  background_overlay_color: string;
  created_at: string;
  updated_at: string;
  grid_enabled: boolean;
  grid_size: number;
  grid_opacity: number;
  grid_color: string;
  snap_to_grid: boolean;
  rotation_snap_enabled: boolean;
  rotation_snap_angle: number;
  snap_scale_to_grid: boolean;
  resolution: string;
  thumbnail_data?: string | null;
  icon_data?: string | null;
}

export interface AltarItem {
  id: string;
  name: string;
  emoji: string;
  category_id: AltarItemCategory;
  note: string;
  image_data?: string;
}

export interface AltarPlacement {
  id: string;
  altar_id?: string;
  item_id: string;
  // name, emoji, category_id und image_data stammen aus altar_items und werden
  // beim Laden hinzugejoint — sie sind keine Spalten von altar_placements.
  name: string;
  emoji: string;
  category_id: string;
  x: number;
  y: number;
  z_index: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  image_data?: string;
}

export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskCategory extends CategoryBase {
  deleted_at: string | null;
}

export interface TaskLink {
  id: string;
  task_id: string;
  target_id: string;
  target_type: ContentType;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  category_id: string;
  priority: TaskPriority;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  parent_task_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  tags: string[];
  deleted_at: string | null;
}

export interface ActiveView {
  type: ContentType | 'home' | 'tags' | 'trash' | 'altar' | 'operations' | 'tasks';
  id?: string;
  mode?: 'view' | 'edit';
}
