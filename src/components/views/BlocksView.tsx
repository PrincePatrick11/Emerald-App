import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Blocks, Plus, SlidersHorizontal, Type } from 'lucide-react';
import { useBlockDefinitionStore } from '../../store/blockDefinitionStore';
import { copyUsage, useBlockContentRows } from '../../store/blockCopies';
import { definitionLabel } from '../../lib/blocks/blockAttrs';
import { ELEMENT_KINDS, elementKindLabelKey } from '../../lib/blocks/fields';
import { ELEMENT_KIND_ICONS } from '../../lib/blocks/presets';
import Button from '../ui/Button';
import BlockGlyph from '../blocks/BlockGlyph';
import BlockDefinitionEditor, { type DefinitionDraft } from '../blocks/BlockDefinitionEditor';

/**
 * Die Rail-Ansicht „Blöcke": links die eigenen Blöcke mit ihrer Verwendung,
 * rechts der Baukasten des gewählten — oder, ohne Auswahl, die eingebauten
 * Blöcke im Überblick. Eigene Blöcke entstehen hier ohne Code aus den
 * Feldarten; eingefügt werden sie in jedem Eintrag über „Block hinzufügen".
 */
export default function BlocksView() {
  const { t } = useTranslation();
  const definitions = useBlockDefinitionStore((s) => s.definitions);
  const createDefinition = useBlockDefinitionStore((s) => s.createDefinition);
  const rows = useBlockContentRows();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const usage = useMemo(() => copyUsage(rows, definitions), [rows, definitions]);
  const selected = definitions.find((d) => d.id === selectedId) ?? null;

  // Ungespeicherte Entwürfe je Block: der Baukasten montiert pro Auswahl neu,
  // und ein Klick auf einen anderen Block soll keine Arbeit verwerfen. Nur
  // solange die Ansicht offen ist.
  const drafts = useRef(new Map<string, DefinitionDraft>());
  const rememberDraft = useCallback((id: string, draft: DefinitionDraft | null) => {
    if (draft) drafts.current.set(id, draft);
    else drafts.current.delete(id);
  }, []);

  const create = async () => {
    const def = await createDefinition(t('blocks.library.defaultName'));
    setSelectedId(def.id);
  };

  return (
    <div className="flex h-full">
      <div className="w-64 flex-shrink-0 border-r border-stone-700/60 flex flex-col">
        <div className="px-4 py-5 border-b border-stone-700/60 space-y-3">
          <div className="flex items-center gap-2">
            <Blocks size={16} className="text-stone-500" />
            <h1 className="text-sm font-semibold text-stone-200">{t('nav.blocks')}</h1>
          </div>
          <Button tone="neutral" small className="w-full" onClick={() => void create()}>
            <Plus size={12} />
            <span>{t('blocks.library.newBlock')}</span>
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`sidebar-item w-full ${selected === null ? 'active' : ''}`}
          >
            <span className="text-xs">{t('blocks.library.builtIn')}</span>
          </button>

          <p className="label-xs px-4 pt-4 pb-1">{t('blocks.library.custom')}</p>
          {definitions.length === 0 && (
            <p className="text-xs text-stone-600 px-4 py-2">{t('blocks.library.noCustom')}</p>
          )}
          {definitions.map((def) => {
            const u = usage.get(def.id);
            return (
              <button
                type="button"
                key={def.id}
                onClick={() => setSelectedId(def.id)}
                className={`sidebar-item w-full ${selected?.id === def.id ? 'active' : ''}`}
              >
                <BlockGlyph icon={def.icon} />
                <span className="flex-1 truncate text-xs text-left">{definitionLabel(t, def)}</span>
                {!!u?.outdated && (
                  <span className="block-library-outdated-dot" title={t('blocks.library.outdated', { count: u.outdated })} />
                )}
                <span className="text-stone-700 text-xs" title={t('blocks.library.usedIn', { count: u?.entries ?? 0 })}>
                  {u?.entries ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <BlockDefinitionEditor
            key={selected.id}
            definition={selected}
            usage={usage.get(selected.id)}
            savedDraft={drafts.current.get(selected.id)}
            onDraftChange={(draft) => rememberDraft(selected.id, draft)}
            onDeleted={() => {
              rememberDraft(selected.id, null);
              setSelectedId(null);
            }}
          />
        ) : (
          <BuiltInOverview onCreate={() => void create()} />
        )}
      </div>
    </div>
  );
}

/** Die eingebauten Blöcke im Überblick — sie gibt es in jedem Eintrag, ohne dass man sie hier anlegt. */
function BuiltInOverview({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-300">{t('blocks.library.builtIn')}</h2>
        <p className="text-xs text-stone-500 mt-1">{t('blocks.library.builtInHint')}</p>
      </div>

      <div className="panel p-4 space-y-1">
        <div className="flex items-center gap-2 text-sm text-stone-200">
          <Type size={14} className="text-stone-500" />
          {t('blocks.types.text.label')}
        </div>
        <p className="text-xs text-stone-500">{t('blocks.types.text.description')}</p>
      </div>

      <div className="panel p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-stone-200">
          <SlidersHorizontal size={14} className="text-stone-500" />
          {t('blocks.types.fields.label')}
        </div>
        <p className="text-xs text-stone-500">{t('blocks.types.fields.description')}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {ELEMENT_KINDS.map((kind) => {
            const Icon = ELEMENT_KIND_ICONS[kind];
            return (
              <span key={kind} className="block-kind-chip">
                <Icon size={12} />
                {t(elementKindLabelKey(kind))}
              </span>
            );
          })}
        </div>
      </div>

      <div className="panel p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm text-stone-200">
          <Blocks size={14} className="text-stone-500" />
          {t('blocks.library.custom')}
        </div>
        <p className="text-xs text-stone-500">{t('blocks.library.customHint')}</p>
        <Button tone="jade" small onClick={onCreate}>
          <Plus size={12} />
          <span>{t('blocks.library.newBlock')}</span>
        </Button>
      </div>
    </div>
  );
}
