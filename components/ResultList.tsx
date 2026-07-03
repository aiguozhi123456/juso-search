import type { NormalizedResult } from '@/lib/providers/types';
import { ResultCard } from './ResultCard';
import { t, MSG } from '@/lib/i18n';

export function ResultList({ results }: { results: NormalizedResult[] }) {
  if (results.length === 0) {
    return <div className="state">{t(MSG.no_results)}</div>;
  }
  return (
    <div className="result-list">
      {results.map((r, i) => (
        <ResultCard key={`${r.url}-${i}`} result={r} />
      ))}
    </div>
  );
}
