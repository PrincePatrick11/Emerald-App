/**
 * Is the tag with this ID alive? `tagStore` registers the check here
 * (`registerTagLookup`) — a module of its own instead of an import of
 * `tagStore`: that imports the content stores and the template store, and
 * they need exactly this check, a cycle.
 *
 * It is registered on the first import of `store/tagStore` — which
 * `store/moduleWiring` pulls in at startup, long before a template can be
 * applied.
 */
let isLiveTag: (id: string) => boolean = () => false;

export function registerTagLookup(lookup: (id: string) => boolean): void {
  isLiveTag = lookup;
}

/**
 * The tags an entry takes over from a template: the live ones. One
 * in the trash stays in the template (it can come back), but does not pass
 * into any new entry.
 */
export function usableTemplateTags(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => isLiveTag(id)))];
}

/** `template` with the tags it actually takes over (`usableTemplateTags`). */
export function withUsableTags<T extends { tags: readonly string[] }>(template: T): T {
  return { ...template, tags: usableTemplateTags(template.tags) };
}
