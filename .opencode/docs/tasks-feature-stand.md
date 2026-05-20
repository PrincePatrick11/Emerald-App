# Tasks Feature – Stand 12. Mai 2026

## Übersicht

Gestern wurde das komplette **Tasks-Feature** implementiert – eine neue Aufgabenverwaltung für Emerald mit Kategorien, Subtasks, Prioritäten, Filterung und Verlinkungen zu anderen Inhalten (Journal, Wiki, Operations).

---

## Geänderte & neue Dateien

| Datei | Aktion | Beschreibung |
|---|---|---|
| `src/types/index.ts` | Erweitert | Typen `TaskPriority`, `TaskCategory`, `TaskLink`, `Task`; `ActiveView` um `'tasks'` erweitert |
| `src/lib/db.ts` | Erweitert | Migration: 3 neue Tabellen + Seed-Daten + Auto-Purge |
| `src/store/taskStore.ts` | **Neu** | Vollständiger Zustand-Store (Zustand) |
| `src/store/uiStore.ts` | Erweitert | `tasksPrefs` + `setTasksPrefs` hinzugefügt |
| `src/store/trashStore.ts` | Erweitert | Support für `task` & `task_category` im Papierkorb |
| `src/components/views/TasksView.tsx` | **Neu** | Haupt-UI der Aufgabenverwaltung (799 Zeilen) |
| `src/components/views/TrashView.tsx` | Erweitert | Anzeige von Tasks & Task-Kategorien im Papierkorb |
| `src/components/layout/MainArea.tsx` | Erweitert | `case 'tasks'` → `TasksView` |
| `src/components/layout/LeftSidebar.tsx` | Erweitert | Nav-Button "Tasks" in der unteren Leiste |
| `src/components/layout/TabBar.tsx` | Erweitert | Tab-Support für Tasks |
| `src/lib/tabs.ts` | Erweitert | `isContentView` erkennt `'tasks'` |
| `src/index.css` | Erweitert | Neue CSS-Klassen (btn-primary, btn-ghost, etc.) |
| `src/i18n/locales/en.json` | Erweitert | ~30 Übersetzungsschlüssel (alle `tasks.*`) |
| `src/i18n/locales/de.json` | Erweitert | Deutsche Übersetzungen |
| `src/i18n/locales/es.json` | Erweitert | Spanische Übersetzungen |
| `src/i18n/locales/fr.json` | Erweitert | Französische Übersetzungen |
| `package.json` | Aktualisiert | Dependency-Versionen |
| `src-tauri/tauri.conf.json` | Aktualisiert | App-Konfiguration |

---

## Datenbank (3 neue Tabellen)

### `task_categories`
```sql
id         TEXT PRIMARY KEY
name       TEXT NOT NULL
emoji      TEXT NOT NULL DEFAULT '📋'
sort_order INTEGER NOT NULL DEFAULT 0
is_builtin INTEGER NOT NULL DEFAULT 0
deleted_at TEXT
```

### `tasks`
```sql
id             TEXT PRIMARY KEY
title          TEXT NOT NULL DEFAULT 'Untitled Task'
description    TEXT NOT NULL DEFAULT ''
category_id    TEXT NOT NULL
priority       TEXT NOT NULL DEFAULT 'medium'  -- 'low' | 'medium' | 'high'
due_date       TEXT
completed      INTEGER NOT NULL DEFAULT 0
completed_at   TEXT
parent_task_id TEXT              -- für Subtasks (NULL = Root-Task)
sort_order     INTEGER NOT NULL DEFAULT 0
created_at     TEXT NOT NULL
updated_at     TEXT NOT NULL
tags           TEXT NOT NULL DEFAULT '[]'
deleted_at     TEXT
```

### `task_links`
```sql
id          TEXT PRIMARY KEY
task_id     TEXT NOT NULL     -- FK → tasks
target_id   TEXT NOT NULL
target_type TEXT NOT NULL     -- 'journal' | 'wiki' | 'operation'
```

**Seed-Daten:** 3 Built-in-Kategorien:
- `general` / "Allgemein" / 📋
- `ritual` / "Ritual" / 🕯️
- `daily` / "Daily" / ☀️

**Auto-Purge:** Tasks & Kategorien, die älter als 30 Tage im Papierkorb sind, werden beim Start gelöscht.

---

## Task Store (`src/store/taskStore.ts`)

Der Store verwaltet drei Entitäten:

### Kategorien
- `addCategory(name, emoji)` → Neue Kategorie in DB + State
- `updateCategory(id, name, emoji)` → Kategorie umbenennen
- `deleteCategory(id)` → Soft-Delete (keine Built-in-Kategorien löschbar)
- `restoreCategory(id)` → Aus Papierkorb wiederherstellen
- `permanentlyDeleteCategory(id)` → Endgültig löschen

### Tasks
- `createTask(categoryId, parentTaskId?)` → Neue Task, optional als Subtask
- `updateTask(id, patch)` → Teilweises Update (title, priority, category, etc.)
- `toggleComplete(id)` → Task + rekursiv alle Subtasks als erledigt/unerledigt markieren
- `deleteTask(id)` → Soft-Delete + alle Subtasks + verlinkte Links
- `restoreTask(id)` → Aus Papierkorb wiederherstellen
- `permanentlyDeleteTask(id)` → Endgültig aus DB löschen

### Links
- `addLink(taskId, targetId, targetType)` → Verweis auf Journal/Wiki/Operation
- `removeLink(id)` → Link entfernen

---

## TasksView – UI-Funktionen

![Struktur: Header → ListToolbar → FilterPanel → Aufgabenliste]

### Header
- Titel "Tasks" + "New Task"-Button

### ListToolbar
- **Suchleiste** (Filtert nach Titel)
- **Sortierung:** Kategorie, Neueste, Älteste, A-Z, Z-A, Priorität
- **Ansicht:** Liste / Cards (Cards-Modus visuell reserviert)
- **Filter-Toggle** + Badge mit aktiver Filter-Anzahl
- **Show/Hide Completed** Button

### FilterPanel
- **Kategorie-Filter:** Chips mit Emoji + Name (Mehrfachauswahl via Toggle)
- **Status-Filter:** Active / Completed
- **Priorität-Filter:** High / Medium / Low als Pill-Buttons

### Kategorie-Ansicht (wenn Sort = "Category")
- Kategorien als einklappbare Gruppen
- Jede Gruppe zeigt: Emoji, Name, Task-Anzahl, "+" für neue Task in dieser Kategorie
- **"+ New Category"** Button (inline Form mit Emoji-Picker)

### Task-Zeile (TaskRow)
- **Checkbox** zum Erledigen/Unerledigen
- **Expand/Collapse** für Subtasks (▸/▾)
- **Inline-Editing** per Doppelklick → Enter speichert, Escape bricht ab
- **Priorität-Dropdown** (Flag-Icon mit Farbe: rot/gelb/grün)
- **Kategorie-Dropdown** (Emoji + Name), per Klick umschaltbar
- **Verlinkte Einträge** als kleine Tags (klickbar → öffnet Ziel-View)
- **Aktionsbuttons** (hover): Subtask hinzufügen, Link hinzufügen, Löschen
- **Context-Menü** (Rechtsklick): Mark complete/active, Add subtask, Link entry, Delete

### Subtask-System
- Tasks können beliebig tief verschachtelt werden
- Toggle-Complete betrifft alle Kind-Tasks rekursiv
- Delete löscht Parent + alle Subtasks mit

### Link-Modal
- Popup zum Verlinken auf Journal-Einträge, Wiki-Artikel oder Operations
- Tabs zum Umschalten zwischen Entitätstypen
- Suchleiste innerhalb des Modals
- Link erscheint als Tag an der Task

---

## Integration in bestehende Systeme

### Navigation
- **LeftSidebar:** Tasks-Button (CheckSquare-Icon) zwischen Wiki und Altar
- **TabBar:** Tasks können in eigenen Tabs geöffnet werden (wie Journal/Wiki)
- **Navigation History:** Back/Forward funktioniert mit Tasks-Views

### Papierkorb (TrashView)
- Tasks erscheinen mit `ListTodo`-Icon
- Task-Kategorien erscheinen unter "Categories" Gruppe
- Restore und Permanent-Delete funktioniert für beide Typen

### i18n
- Alle UI-Texte in 4 Sprachen übersetzt (en/de/es/fr)
- `nav.tasks`, `undo.taskDeleted`, `tasks.*` Schlüssel

---

## Bekannte Issues / To-Do

### "New Category" funktioniert nicht
- **Symptom:** Klick auf "+ New Category" zeigt das Formular, aber nach Eingabe von Name + Emoji und Bestätigen wird keine Kategorie erstellt.
- **Verdacht:** Möglicherweise ein Problem mit der Enter-Taste im `onKeyDown`-Handler oder der `addCategory`-Funktion.

### Fehlende Features (laut Plan)
- Calendar-Ansicht für Due-Dates (Feld existiert, aber keine Deadline-UI)
- Tags-System (Feld `tags` existiert, aber keine UI)
- Card-View-Layout (nur List-View implementiert)
- Drag & Drop für Task-Reihenfolge
- Bulk-Operationen (mehrere Tasks markieren)
