import type { NormalizedResult } from '@/lib/providers/types';
import { ResultCard } from './ResultCard';
import { t, MSG } from '@/lib/i18n';
import { BrandMark } from './icons';

export function ResultList({ results }: { results: NormalizedResult[] }) {
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
        <ResultCard key={`${r.url}-${i}`} result={r} />
      ))}
    </div>
  );
}
