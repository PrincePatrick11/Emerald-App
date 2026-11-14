/**
 * Bringing a template into an existing entry — what happens for that outside the
 * block stack: title and tags via the entry's store (like the
 * properties sidebar in edit mode, the views pick up the state
 * through their sync effects) and "Save as template". The blocks are set by the stack itself
 * (`applyTemplate` in `BlockStack`) — it holds the live content.
 *
 * Import rule: this store reads the content stores and
 * the template store, none of them imports back.
 */
import { useEntryStore } from './entryStore';
import { useTemplateStore } from './templateStore';
import { useBlockSessionStore } from './blockSessionStore';
import { withUsableTags } from '../lib/templateTags';
import { serializeBlocks } from '../lib/blocks/blockHtml';
import {
  fieldsWithoutTemplate, fieldsWithTemplate,
  type Template, type TemplateFields,
} from '../lib/blocks/templates';

function entryFields(id: string): (TemplateFields & { content: string }) | undefined {
  return useEntryStore.getState().getEntry(id);
}

/** Writes only what has changed in title or tags. */
async function writeChangedFields(id: string, before: TemplateFields, after: TemplateFields): Promise<void> {
  const patch: Partial<TemplateFields> = {};
  if (after.title !== before.title) patch.title = after.title;
  // Not just the length: swapping for the same number of tags does not change it.
  if (after.tags.length !== before.tags.length || after.tags.some((tag, i) => tag !== before.tags[i])) patch.tags = after.tags;
  if (Object.keys(patch).length) await useEntryStore.getState().updateEntry(id, patch);
}

/**
 * Title and tags of the template into the entry (`fieldsWithTemplate`). The
 * caller first saves whatever is not yet saved in the editor — otherwise
 * this would read an older title, and the view's sync would overwrite the
 * current input.
 */
export async function applyTemplateFields(
  id: string,
  template: Pick<Template, 'title' | 'tags'>,
): Promise<void> {
  const fields = entryFields(id);
  if (!fields) return;
  await writeChangedFields(id, fields, fieldsWithTemplate(fields, withUsableTags(template)));
}

/**
 * Undo after an automatically applied template (`fieldsWithoutTemplate`)
 * — for a freshly created entry it carried none of its tags beforehand.
 * The stack clears the blocks.
 */
export async function undoTemplateFields(
  id: string,
  template: Pick<Template, 'title' | 'tags'>,
): Promise<void> {
  const fields = entryFields(id);
  if (!fields) return;
  await writeChangedFields(id, fields, fieldsWithoutTemplate(fields, template));
}

/**
 * Save an entry as a new template — its title becomes the name, content
 * and tags come along. If the entry is currently open in edit mode, the
 * live content of its stack counts, not the last autosave.
 */
export async function saveEntryAsTemplate(id: string): Promise<Template | undefined> {
  // Also from the context menu, for an entry never opened since startup.
  await useEntryStore.getState().ensureEntryContent(id);
  const entry = entryFields(id);
  if (!entry) return undefined;
  const session = useBlockSessionStore.getState().session;
  const content = session?.entryId === id && session.isEditing ? serializeBlocks(session.api.liveBlocks()) : entry.content;
  return useTemplateStore.getState().createTemplate(entry.title, {
    content,
    tags: entry.tags,
  });
}
