# Tasks Feature

## Context

The Tasks system provides a hierarchical task manager with categories, priorities, and cross-references to Journal entries, Wiki articles, and Operations. Data is stored in a local SQLite database via `better-sqlite3` and managed through a Zustand store.

---

## 1. Data Model

### Database Tables

#### `task_categories`

| Column       | Type    | Default   | Notes                          |
| ------------ | ------- | --------- | ------------------------------ |
| `id`         | TEXT    | —         | Primary key                    |
| `name`       | TEXT    | —         | Display name                   |
| `emoji`      | TEXT    | `'📋'`    | Category icon                  |
| `sort_order` | INTEGER | `0`       | Manual ordering                |
| `is_builtin` | INTEGER | `0`       | Reserved for future built-ins  |
| `deleted_at` | TEXT    | `NULL`    | Soft-delete timestamp (ISO)    |

#### `tasks`

| Column         | Type    | Default              | Notes                          |
| -------------- | ------- | -------------------- | ------------------------------ |
| `id`           | TEXT    | —                    | Primary key (UUID)             |
| `title`        | TEXT    | `'Untitled Task'`    |                                |
| `description`  | TEXT    | `''`                 | Reserved; not rendered in UI   |
| `category_id`  | TEXT    | —                    | References `task_categories.id`; becomes `''` when category is deleted |
| `priority`     | TEXT    | `'medium'`           | One of `'low'`, `'medium'`, `'high'` |
| `due_date`     | TEXT    | `NULL`               | Reserved; not used in UI       |
| `completed`    | INTEGER | `0`                  | Stored as `0`/`1`, normalized to boolean |
| `completed_at` | TEXT    | `NULL`               | ISO timestamp on completion    |
| `parent_task_id`| TEXT   | `NULL`               | Self-reference for subtasks    |
| `sort_order`   | INTEGER | `0`                  | Manual ordering                |
| `created_at`   | TEXT    | —                    | ISO timestamp                  |
| `updated_at`   | TEXT    | —                    | ISO timestamp, updated on edit |
| `tags`         | TEXT    | `'[]'`               | JSON array of strings          |
| `deleted_at`   | TEXT    | `NULL`               | Soft-delete timestamp (ISO)    |

#### `task_links`

| Column        | Type | Default | Notes                                    |
| ------------- | ---- | ------- | ---------------------------------------- |
| `id`          | TEXT | —       | Primary key                              |
| `task_id`     | TEXT | —       | References `tasks.id`                    |
| `target_id`   | TEXT | —       | ID of the linked entry                   |
| `target_type` | TEXT | —       | One of `'journal'`, `'wiki'`, `'operation'` |

**Indexes:** `idx_task_links_task` on `task_id`, `idx_task_links_target` on `target_id`.

### TypeScript Types

```ts
type TaskPriority = 'low' | 'medium' | 'high';

interface TaskCategory extends CategoryBase {
  deleted_at: string | null;
}
// CategoryBase = { id, name, emoji, sort_order, is_builtin }

interface TaskLink {
  id: string;
  task_id: string;
  target_id: string;
  target_type: 'journal' | 'wiki' | 'operation';
}

interface Task {
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
```

Source: `src/types/index.ts`

---

## 2. Store API (`useTaskStore`)

Zustand store at `src/store/taskStore.ts`. All write actions persist to SQLite immediately.

### State

| Property   | Type              | Description              |
| ---------- | ----------------- | ------------------------ |
| `categories` | `TaskCategory[]` | Active (non-deleted) categories |
| `tasks`      | `Task[]`         | Active (non-deleted) tasks    |
| `links`      | `TaskLink[]`     | All task links                  |

### Actions

#### Data Loading

| Signature | Description |
| --------- | ----------- |
| `fetchAll(): Promise<void>` | Loads all categories, tasks, and links from DB. Excludes soft-deleted rows. |

#### Task CRUD

| Signature | Description |
| --------- | ----------- |
| `createTask(categoryId: string, parentTaskId?: string \| null): Promise<Task>` | Creates a task with title `'New Task'`, priority `'medium'`, no due date. Enters edit mode in UI. |
| `updateTask(id: string, patch: Partial<Task>): Promise<void>` | Merges patch into task, sets `updated_at`, writes to DB. |
| `toggleComplete(id: string): Promise<void>` | Toggles completion. **Cascades** to all descendants (subtasks and their subtasks). Sets `completed_at` on complete, clears on un-complete. |
| `deleteTask(id: string): Promise<void>` | Soft-deletes task and all descendants. Removes associated `task_links`. |
| `restoreTask(id: string): Promise<void>` | Clears `deleted_at`. Re-fetches all active tasks from DB. |
| `permanentlyDeleteTask(id: string): Promise<void>` | Hard-deletes task, all descendants, and associated `task_links`. |

#### Task Queries

| Signature | Description |
| --------- | ----------- |
| `getTask(id: string): Task \| undefined` | Find task by ID in state. |
| `getSubtasks(parentId: string): Task[]` | Direct children of a task. |
| `getRootTasks(): Task[]` | Tasks with `parent_task_id === null`. |

#### Category CRUD

| Signature | Description |
| --------- | ----------- |
| `addCategory(name: string, emoji: string): Promise<TaskCategory>` | Creates a user category appended to the list. `is_builtin` is always `false`. |
| `updateCategory(id: string, name: string, emoji: string): Promise<void>` | Updates name and emoji. |
| `deleteCategory(id: string): Promise<void>` | Soft-deletes category. Sets `category_id` of all tasks in that category to `''` (empty string), making them uncategorized. |
| `restoreCategory(id: string): Promise<void>` | Clears `deleted_at` and re-adds the category to state. |
| `permanentlyDeleteCategory(id: string): Promise<void>` | Hard-deletes category from DB. Does **not** delete tasks in that category. |
| `getCategory(id: string): TaskCategory \| undefined` | Find category by ID in state. |

#### Links

| Signature | Description |
| --------- | ----------- |
| `addLink(taskId: string, targetId: string, targetType: 'journal' \| 'wiki' \| 'operation'): Promise<void>` | Creates a link from task to a journal entry, wiki article, or operation. |
| `removeLink(id: string): Promise<void>` | Deletes a link by its ID. |
| `getLinksForTask(taskId: string): TaskLink[]` | All links originating from a task. |
| `getLinksForTarget(targetId: string): TaskLink[]` | All links pointing to a target entry. |

---

## 3. UI Features (`TasksView`)

### Toolbar

- **Search** — filters tasks by title (case-insensitive substring match).
- **Sort** — five modes controlled via `uiStore.tasksPrefs.sort`:

  | Value | Behavior |
  | ----- | -------- |
  | `'priority'` | Default. High → Medium → Low. |
  | `'alpha_asc'` | Alphabetical A–Z. |
  | `'alpha_desc'` | Alphabetical Z–A. |
  | `'date_desc'` | Newest first. |
  | `'date_asc'` | Oldest first. |
  | `'category'` | Groups tasks under their category headings. |

- **View** — currently only `'list'` is available.
- **Show/Hide completed** — toggle button (`CheckSquare` icon). Completed tasks are hidden by default and rendered at 50% opacity with strikethrough when shown.

### Filtering

Filter panel (opened via toolbar) supports:

- **Category chips** — multi-select by category. When any category is selected, only those categories are shown.
- **Priority chips** — multi-select by `high`, `medium`, `low`.

Filters are combined with AND logic across category and priority, and with search.

### Grouping

When sort mode is `'category'`:

- Tasks are grouped under their category headings.
- Each category section is collapsible (chevron toggle).
- An **Uncategorized** section appears for tasks whose `category_id` is empty or references a missing category.
- Empty categories show a placeholder message.

When sort mode is anything else, all tasks render as a flat list.

### Task Row

Each task row provides:

| Element | Interaction |
| ------- | ----------- |
| Checkbox | Toggle completion (cascades to subtasks). |
| Expand chevron | Shown only when subtasks exist. Toggles subtask list. |
| Title | Double-click to edit inline. Enter to save, Escape to cancel. |
| Link badges | Clickable badges for each linked entry. Navigate to the target view on click. |
| Category dropdown | Hover-revealed. Reassigns task to another category. |
| Priority dropdown | Hover-revealed. Flag icon. Changes priority with color coding: red (high), yellow (medium), green (low). |
| Add subtask (+) | Hover-revealed. Creates a subtask under this task. |
| Link button | Hover-revealed. Opens link modal. |
| Delete (trash) | Hover-revealed. Soft-deletes task and descendants. |

### Context Menu

Right-click on a task row opens a context menu with:

- Mark as active / Mark as completed
- Add subtask
- Link entry
- Delete (danger)

### Link Modal

Modal dialog for linking a task to content:

- Three tabs: Journal, Wiki, Operations.
- Search input filters items by title.
- Clicking an item creates a `TaskLink` and closes the modal.
- Linked entries appear as clickable badges on the task row.

---

## 4. Category Management

### Creating a Category

1. Click the **"+ Add category"** button at the top of the task list.
2. Pick an emoji from the emoji picker (40 options themed to the app).
3. Type a name and press Enter or click the checkmark.

### Editing a Category

1. Click the pencil icon next to a category heading.
2. Change the emoji via the picker, or edit the name inline.
3. Press Enter to save, Escape to cancel.

### Deleting a Category

1. Click the trash icon next to a category heading.
2. A confirmation prompt appears (click again to confirm).
3. On confirm:
   - The category is soft-deleted (`deleted_at` set).
   - All tasks in that category have `category_id` set to `''` (empty string).
   - Tasks move to the **Uncategorized** section (when grouped by category).
   - An undo entry is pushed to the undo store.

### Uncategorized Tasks

Tasks with an empty `category_id` or a `category_id` referencing a deleted/missing category appear under the **Uncategorized** heading when sort mode is `'category'`. This section is also collapsible.

### Default Category

On first run, a category is seeded: `id: 'general'`, name `'Allgemein'`, emoji `'📋'`. It is not marked as builtin (`is_builtin: 0`), so it can be deleted by the user.

---

## 5. Trash Integration

### What Goes to Trash

- **Tasks** — soft-deleted via `deleteTask()`. All descendants are soft-deleted recursively. Associated `task_links` are removed immediately.
- **Task categories** — soft-deleted via `deleteCategory()`. Tasks are not deleted; they become uncategorized.

### Restore

From the Trash view, items of type `'task'` and `'task_category'` can be restored:

- `restoreTask(id)` — sets `deleted_at = NULL` and re-fetches all active tasks.
- `restoreCategory(id)` — sets `deleted_at = NULL` and re-adds the category to state.

### Permanent Deletion

- `permanentlyDeleteTask(id)` — hard-deletes the task, all descendants, and their `task_links`.
- `permanentlyDeleteCategory(id)` — hard-deletes the category only.

### Empty Trash

`emptyTrash()` in `trashStore.ts` deletes all soft-deleted tasks, task categories, and their links in a single operation.

### Auto-Purge

On database initialization (`src/lib/db.ts`), tasks and categories with `deleted_at` older than a cutoff threshold are automatically hard-deleted. The cutoff value is computed at startup.

---

## Limits

- **Subtask depth** — no explicit limit, but `collectDescendantIds()` uses recursive walking. Very deep hierarchies could hit call-stack limits.
- **Description field** — exists in the schema and type but is not rendered or editable in the UI.
- **Due date field** — exists in the schema and type but is not used in the UI.
- **Tags field** — exists in the schema and type but has no UI for managing task tags.
- **No drag-and-drop reordering** — `sort_order` exists but is always `0`; no UI for manual ordering.
- **No built-in categories** — the seeded category has `is_builtin: 0`, so all categories are user-manageable.
- **Link modal** — links can only be created, not removed from the modal. Links are removed only when the task is deleted or via `removeLink()` programmatically.

---

## References

| File | Purpose |
| ---- | ------- |
| `src/types/index.ts` | `Task`, `TaskCategory`, `TaskLink`, `TaskPriority` types |
| `src/store/taskStore.ts` | Zustand store — all state and actions |
| `src/components/views/TasksView.tsx` | Main UI — list, filtering, sorting, categories, subtasks, links |
| `src/store/trashStore.ts` | Trash integration for tasks and task categories |
| `src/lib/db.ts` | SQLite table definitions, indexes, seed data, auto-purge |
| `src/i18n/locales/en.json` | All `tasks.*` translation keys |
