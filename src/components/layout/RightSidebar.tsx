import { useTranslation } from 'react-i18next';
import { entryBlockSummary } from '../../lib/blocks/entrySummary';
import type { ComponentType } from 'react';
import { Pencil, Maximize2, Minimize2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { findEntry, useEntryStore } from '../../store/entryStore';
import type { ActiveView } from '../../types';
import { entryTypeForView, LIBRARY_VIEW_IDS, moduleMeta, type ViewId } from '../../lib/modules';
import BlockSidebarArea from '../blocks/BlockSidebarArea';
import JournalPropertiesPanel from '../sidebar/panels/JournalPropertiesPanel';
import WikiPropertiesPanel from '../sidebar/panels/WikiPropertiesPanel';
import OperationPropertiesPanel from '../sidebar/panels/OperationPropertiesPanel';
import AltarSidebarPanel from '../sidebar/panels/AltarSidebarPanel';
import Button from '../ui/Button';
import SidebarColumn, { EditActionBar, SidebarActionBar } from '../ui/SidebarColumn';

// Eager, nicht lazy: die Panels hängen ohnehin an Stores, die beim Start
// geladen sind, und die Seitenleiste ist ab dem ersten Frame sichtbar.
// tasks hat bewusst kein Panel (Aufgaben werden inline bearbeitet).
const PROPERTIES_PANELS: Partial<Record<ViewId, ComponentType>> = {
  journal: JournalPropertiesPanel,
  wiki: WikiPropertiesPanel,
  operations: OperationPropertiesPanel,
  altar: AltarSidebarPanel,
};

/**
 * Views ohne Einträge. Sie bekommen nie die Eintrags-Aktionsleiste: ein
 * Tiefenlink aus der Suche (`{ type: 'tags' | 'categories', id }`) trägt eine
 * id, bekäme sonst die Eintrags-Aktionsleiste und darin einen
 * „Bearbeiten"-Knopf, der `mode: 'edit'` auf eine Ansicht ohne Editor setzt.
 * Die Seite eines eigenen Blocks oder einer Vorlage (`{ type: 'blocks' |
 * 'templates', id }`) bringt ihre Leiste selbst mit und portalt sie in
 * denselben Host wie ein Dashboard.
 */
const VIEWS_WITHOUT_ENTRIES: ReadonlySet<ViewId> = new Set<ViewId>(['home', 'tags', 'categories', ...LIBRARY_VIEW_IDS]);


function PropertiesContent({ activeView }: { activeView: ActiveView }) {
  const { t } = useTranslation();
  const Panel = PROPERTIES_PANELS[activeView.type];
  if (!Panel) return <p className="text-xs text-stone-600 px-2 py-3">{t('properties.noEntry')}</p>;
  return <Panel />;
}

function RightSidebarActionBar() {
  const { t } = useTranslation();
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const editActions = useUIStore((s) => s.editActions);
  const editLocked = useUIStore((s) => s.editLocked);
  const altarWindowFullscreen = useUIStore((s) => s.altarWindowFullscreen);
  const setAltarWindowFullscreen = useUIStore((s) => s.setAltarWindowFullscreen);
  // Der Inhalt des offenen Eintrags — für die Sperre einer geladenen Sigille.
  const entryType = entryTypeForView(activeView.type);
  const content = useEntryStore((s) => (entryType && activeView.id ? findEntry(s.entries, activeView.id, entryType)?.content : undefined));

  if (!activeView.id) return null;
  const isEditing = activeView.mode === 'edit';

  if (isEditing) {
    if (!editActions) return null;
    // Die Sperre gilt ab dem Klick, der sie auslöst — nicht erst, wenn die
    // Knöpfe als gesperrt gezeichnet sind: deshalb fragt jeder Griff den Store.
    const unlessLocked = (run: () => void | Promise<void>) => () => {
      if (!useUIStore.getState().editLocked) void run();
    };
    return (
      <EditActionBar
        onDone={unlessLocked(editActions.onSave)}
        onDelete={editActions.onDelete && unlessLocked(editActions.onDelete)}
        onCancel={unlessLocked(editActions.onCancel)}
        locked={editLocked}
      />
    );
  }

  // Eine geladene Sigille mit Sperre „ganzer Eintrag" lässt sich nicht
  // bearbeiten — der Ladung-Block entscheidet, in jeder Eintragsart. Der Knopf
  // bleibt stehen und sagt, warum er nichts tut.
  const locked = content !== undefined && !!entryBlockSummary(activeView.id, content).sigil?.lockEntry;
  const isAltar = activeView.type === 'altar';

  return (
    <SidebarActionBar>
      {/* Der Tooltip hängt an einer Hülle: ein gesperrter Tone-Button lässt
          keine Maus an sich heran (`disabled:pointer-events-none`). */}
      <span className="flex flex-1 min-w-0" title={locked ? t('editor.lockedBySigil') : undefined}>
        <Button
          tone="amber"
          fill
          disabled={locked}
          title={locked ? undefined : t('editor.edit')}
          aria-label={t('editor.edit')}
          onClick={() => setActiveView({ ...activeView, mode: 'edit' })}
        >
          <Pencil size={14} />
          <span className="truncate">{t('editor.edit')}</span>
        </Button>
      </span>
      {isAltar && (
        <Button
          tone="jade"
          active={altarWindowFullscreen}
          compact
          title={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
          aria-label={altarWindowFullscreen ? t('altar.exitWindowFullscreen') : t('altar.windowFullscreen')}
          onClick={() => setAltarWindowFullscreen(!altarWindowFullscreen)}
        >
          {altarWindowFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Button>
      )}
    </SidebarActionBar>
  );
}

export default function RightSidebar() {
  const activeView = useUIStore((s) => s.activeView);
  const setListHeaderHost = useUIStore((s) => s.setListHeaderHost);
  const dashboardMounted = useUIStore((s) => s.dashboardMounted);

  // Ist ein Dashboard gemountet, gehört die Leiste seinem Kopf —
  // Aktions-Buttons, Toolbar und Filter portalt es hierher. Das entscheidet
  // seine Anmeldung, nicht `activeView.id`: Aufgaben zeigen ihre Liste auch
  // mit einer id (Sprungziel, kein offener Eintrag), und die id eines
  // gelöschten Eintrags fällt ebenfalls aufs Dashboard zurück.
  // Views ohne Einträge und Listenansichten ohne id bekommen den Host auch
  // vor der Anmeldung, damit er bereitsteht, solange der Chunk einer lazy
  // geladenen Ansicht noch lädt. Einen Platzhalter braucht es nicht mehr:
  // jede View ohne Einträge hat ein Dashboard (die Blöcke dazu ihre Seite).
  if (dashboardMounted || VIEWS_WITHOUT_ENTRIES.has(activeView.type) || !activeView.id) {
    return <div ref={setListHeaderHost} className="flex flex-col h-full" />;
  }

  // Lesen und Bearbeiten zeigen dieselben Abschnitte (`SidebarSection`) ohne
  // Linie untereinander; der Abstand kommt von hier.
  return (
    <SidebarColumn bar={<RightSidebarActionBar />} bodyClassName="flex flex-col gap-5">
      <PropertiesContent activeView={activeView} />
      {moduleMeta(activeView.type)?.usesBlocks && <BlockSidebarArea />}
    </SidebarColumn>
  );
}
