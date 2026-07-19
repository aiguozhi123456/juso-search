import type { NormalizedResult } from '@/lib/providers/types';
import type { SourceId } from '@/lib/sources';
import { ResultCard } from './ResultCard';
import { t, MSG } from '@/lib/i18n';
import { BrandMark } from './icons';

export function ResultList({ results, sourceId }: { results: NormalizedResult[]; sourceId?: SourceId }) {
  if (results.length === 0) {
    return (
      <div className="state state--empty" role="status">
        <span className="state-mark" aria-hidden="true">
          <BrandMark size={32} />
        </span>
        <span>{t(MSG.no_results)}</span>
      </div>
    );
  }
  return (
    <div className="result-list">
      {results.map((r, i) => (
        <ResultCard key={`${r.url}-${i}`} result={r} sourceId={sourceId} />
      ))}
    </div>
  );
}
