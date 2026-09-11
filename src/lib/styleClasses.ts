export const OP_PROP_SELECT_CLASSES =
  'op-prop-select w-full bg-stone-800/60 rounded-md px-3 py-1.5 text-xs text-stone-300 outline-none ' +
  'border border-stone-700/40 focus:border-stone-600 transition-colors placeholder-stone-700';

/* Die Aktionsleiste oben in der rechten Seitenleiste (Bearbeiten/Fertig eines
   Eintrags, Speichern eines eigenen Blocks). Spiegelt die Tab-Leiste in
   `LeftSidebarEntryList`, damit beide Seitenleisten ihre Unterkante auf
   derselben Linie haben — beide synchron halten, mit einer bekannten Ausnahme: jene Leiste ist `min-h-14` und
   bricht in eine zweite Reihe um, sobald die Eintragsliste schmaler gezogen
   wird als ihre sechs Tabs. Das hier nachzubilden hieße, diese Leiste aus einem
   Grund wachsen zu lassen, der mit ihrem Inhalt nichts zu tun hat — sie bleibt
   56px. */
export const SIDEBAR_ACTION_BAR_CLASSES = 'flex items-center gap-0.5 px-3 h-14 border-b border-stone-700/60 flex-shrink-0';
