import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Library, BookOpen, Wand2 } from 'lucide-react';
import { useUIStore } from '../../../store/uiStore';
import { fetchBacklinks, type BacklinkEntry } from '../../../lib/links';
import { viewTypeForEntryType } from '../../../lib/tabs';

export default function BacklinksPanel({ currentId }: { currentId?: string }) {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const [backlinks, setBacklinks] = useState<BacklinkEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentId) {
      setBacklinks([]);
      return;
    }
    setLoading(true);
    fetchBacklinks(currentId)
      .then(setBacklinks)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentId]);

  if (!currentId) {
    return (
      <p className="text-xs text-stone-600 px-2 py-3">{t('backlinks.none')}</p>
    );
  }

  if (loading) {
    return <p className="text-xs text-stone-600 px-2 py-3">Loading…</p>;
  }

  if (backlinks.length === 0) {
    return (
      <p className="text-xs text-stone-600 px-2 py-3">{t('backlinks.none')}</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {backlinks.map((link) => (
        <button
          key={link.id}
          onClick={() =>
            setActiveView({ type: viewTypeForEntryType(link.type), id: link.id, mode: 'view' })
          }
          className="sidebar-item w-full text-left"
        >
          {link.type === 'journal' ? (
            <BookOpen size={13} className="text-stone-500 flex-shrink-0" />
          ) : link.type === 'wiki' ? (
            <Library size={13} className="text-stone-500 flex-shrink-0" />
          ) : (
            <Wand2 size={13} className="text-stone-500 flex-shrink-0" />
          )}
          <span className="flex-1 truncate text-xs">{link.title}</span>
          <span className="text-stone-600 text-xs capitalize">{link.type}</span>
        </button>
      ))}
    </div>
  );
}
