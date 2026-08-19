import { PropertySummarySectionTitle } from './PropertySummaryRow';

interface PropertiesReadViewProps {
  sectionTitle?: string;
  footnote?: string;
  children: React.ReactNode;
}

export default function PropertiesReadView({ sectionTitle, footnote, children }: PropertiesReadViewProps) {
  return (
    <div className="flex flex-col gap-1.5 pb-5">
      {sectionTitle && <PropertySummarySectionTitle label={sectionTitle} />}
      <div className="flex flex-col gap-1.5">{children}</div>
      {footnote && (
        <p className="mt-4 px-1 text-[10.5px] leading-relaxed text-stone-600">{footnote}</p>
      )}
    </div>
  );
}
