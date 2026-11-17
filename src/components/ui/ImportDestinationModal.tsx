import { useTranslation } from 'react-i18next';
import { useImportStore } from '../../store/importStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { dashboardLabel } from '../../lib/dashboards';
import DashboardGlyph from './DashboardGlyph';
import Modal from './Modal';
import Button from './Button';

/**
 * Where an imported Markdown file without a category goes: one of the
 * dashboards, in rail order. The entry starts in the dashboard's first
 * category and opens inside it.
 */
export default function ImportDestinationModal() {
  const { t } = useTranslation();
  const pending = useImportStore((s) => s.pending);
  const choose = useImportStore((s) => s.choose);
  const cancel = useImportStore((s) => s.cancel);
  const dashboards = useDashboardStore((s) => s.dashboards);

  if (!pending) return null;

  return (
    <Modal title={t('importDestination.title')} onClose={cancel}
      widthClassName="w-[420px]"
      className="overflow-hidden"
      bodyClassName="modal-body space-y-3"
      footer={<Button tone="neutral" onClick={cancel}>{t('importDestination.cancel')}</Button>}
    >
        <p className="text-sm text-muted">
          {t('importDestination.description', { title: pending.title })}
        </p>
        <div className="space-y-1">
          {dashboards.map((dashboard) => (
            <button
              key={dashboard.id}
              onClick={() => choose(dashboard.id)}
              className="menu-item rounded-md"
            >
              <DashboardGlyph dashboard={dashboard} size={14} />
              {dashboardLabel(t, dashboard)}
            </button>
          ))}
        </div>
    </Modal>
  );
}
