import { useTranslation } from 'react-i18next';
import { Settings, type LucideIcon } from 'lucide-react';
import { Fragment, Suspense, lazy, useEffect, useState } from 'react';
import { AUX_VIEWS, MODULE_LIST, type ViewId } from '../../lib/modules';
import { useUIStore } from '../../store/uiStore';
import { useVaultStore } from '../../store/vaultStore';
import { asUpdateError, checkForUpdate, updateSettings } from '../../lib/updates';
import VaultModal, { VaultGlyph } from './VaultModal';

// SettingsModal zieht die komplette Backup-/Restore-Maschinerie (dbBackup)
// hinter sich her — als eigener Chunk erst beim ersten Oeffnen.
// VaultModal bleibt eager: VaultGlyph wird fuer den Rail-Button gebraucht,
// und AppShell rendert es beim Erststart ohnehin.
const SettingsModal = lazy(() => import('./settings/SettingsModal'));
// Nur der Typ — `import type` verschwindet beim Uebersetzen und zieht das
// Modul nicht in den Haupt-Chunk zurueck.
import type { SettingsPage } from './settings/SettingsModal';
import RailButton from '../ui/RailButton';

/** Breite der Rail. `AppShell` rechnet damit die Breite des <aside> und
 *  die Standardbreite der rechten Seitenleiste aus, deshalb steht sie als
 *  Zahl hier statt als `w-14`-Klasse unten: zwei Wahrheiten haetten eine
 *  geklippte Rail *und* eine falsche Breite rechts ergeben. */
// 44 = die 32px-Knoepfe mit je 6px Luft; knapp, damit die Liste nah an die
// Icons rueckt (`.app-sidebar-left-with-rail` in index.css).
export const RAIL_WIDTH = 44;

export default function LeftSidebarRail() {
  const { t } = useTranslation();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeViewType = useUIStore((s) => s.activeView.type);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('general');
  const [vaultOpen, setVaultOpen] = useState(false);
  // Selector auf ein Primitiv, nicht auf den Vault-Datensatz: `find` liefert
  // sonst bei jedem Store-Update ein Objekt, das zustand als geaendert liest.
  const activeVaultIcon = useVaultStore((s) => s.vaults.find((v) => v.id === s.activeVaultId)?.icon);

  // Die Pruefung beim Start haengt hier und nicht in App.tsx, weil ihr einziges
  // sichtbares Ergebnis der Punkt am Zahnrad darunter ist. Gefunden oder nicht:
  // sie meldet sich nie von selbst — ein Fenster, das ungefragt aufgeht, waere
  // die Art Unterbrechung, die eine lokale App nicht haben soll.
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (!(await updateSettings()).auto_check) return;
        const found = await checkForUpdate();
        if (!dead && found.available && found.installable) setUpdateVersion(found.version);
      } catch (e: unknown) {
        // Kein Netz, keine Quelle, kein Problem: der Punkt bleibt aus. Gesagt
        // wird es nur der Konsole — beim Start ungefragt eine Fehlermeldung zu
        // zeigen, waere schlimmer als das ausbleibende Update.
        console.error('[updates] check on start failed:', asUpdateError(e).detail);
      }
    })();
    return () => { dead = true; };
  }, []);

  // Ein Knopf pro Ansicht; hervorgehoben ist er, solange seine Ansicht offen
  // ist — auch mit einem geoeffneten Eintrag darin.
  const viewButton = (type: ViewId, meta: { icon: LucideIcon; navLabelKey: string }) => (
    <RailButton
      key={type}
      active={activeViewType === type}
      onClick={() => setActiveView({ type })}
      title={t(meta.navLabelKey)}
    >
      <meta.icon size={18} />
    </RailButton>
  );

  return (
    <div
      // Keine Trennlinie zur Liste: beide sind Teil des Rahmens.
      className="left-sidebar-rail flex flex-col items-center h-full flex-shrink-0"
      style={{ width: RAIL_WIDTH }}
    >
      {/* Die beiden Seitenleisten schaltet das Menü „Ansicht" (useTitleBarMenus,
          nativ auf macOS) — eigene Knöpfe hier oben waren eine zweite Stelle
          für dasselbe. */}

      {/* Main nav icons — navigate only, never touch the entry-list panel */}
      <div className="w-full flex flex-col items-center gap-1 py-2">
        {/* Der Weg zum Dashboard. Er hing vorher am Emerald-Logo in der
            Titelleiste, das niemand als Navigationsziel liest.
            Achtung bei MCP-Selektoren: lucide exportiert `Home` als Alias von
            `House`, das SVG traegt also `.lucide-house`, nicht `.lucide-home`. */}
        {viewButton('home', AUX_VIEWS.home)}
        {MODULE_LIST.map((mod) => (
          <Fragment key={mod.id}>
            {/* Das Lexikon ist kein Eintragsmodul, steht aber oben zwischen
                Wiki und Altar statt unten bei Bloecken und Vorlagen. */}
            {mod.id === 'altar' && viewButton('lexicon', AUX_VIEWS.lexicon)}
            {viewButton(mod.id, mod)}
          </Fragment>
        ))}
      </div>

      {/* Bottom nav — always visible: Blocks/Templates/Tags/Categories/Trash, then Vault/Settings */}
      <div className="sidebar-bottom-bar w-full flex-1 flex flex-col items-center justify-end gap-1 py-2">
        {viewButton('blocks', AUX_VIEWS.blocks)}
        {viewButton('templates', AUX_VIEWS.templates)}
        {viewButton('tags', AUX_VIEWS.tags)}
        {viewButton('categories', AUX_VIEWS.categories)}
        {viewButton('trash', AUX_VIEWS.trash)}
        <RailButton onClick={() => setVaultOpen(true)} title={t('nav.vaults')}>
          {/* 17px nur fuers Emoji: es traegt keine Strichstaerke und wirkt
              neben den lucide-Icons sonst zu gross. Das Ersatz-Glyph ist
              selbst ein lucide-Icon und bleibt bei den 18 seiner Nachbarn. */}
          <VaultGlyph icon={activeVaultIcon} size={activeVaultIcon ? 17 : 18} />
        </RailButton>
        <RailButton
          // Die Zielseite wird hier festgehalten und der Punkt sofort
          // geloescht: er hat seine Aufgabe erfuellt, sobald das Fenster
          // aufgeht. Andersherum spraenge das Zahnrad den Rest der Sitzung
          // auf „Updates" — und ein Loeschen ohne dieses Merken hiesse, dass
          // das Fenster wieder auf „Allgemein" aufginge, weil beide
          // Zustandsaenderungen im selben Rendern landen.
          onClick={() => {
            setSettingsPage(updateVersion ? 'updates' : 'general');
            setSettingsOpen(true);
            setUpdateVersion(null);
          }}
          title={updateVersion ? t('settings.updateFound', { version: updateVersion }) : t('nav.settings')}
          className="relative"
        >
          <Settings size={18} />
          {updateVersion && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: 'var(--accent)' }}
            />
          )}
        </RailButton>
      </div>

      {vaultOpen && <VaultModal onClose={() => setVaultOpen(false)} />}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            initialPage={settingsPage}
          />
        </Suspense>
      )}
    </div>
  );
}
