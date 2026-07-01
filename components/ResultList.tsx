import type { NormalizedResult } from '@/lib/providers/types';
import { ResultCard } from './ResultCard';

export function ResultList({ results }: { results: NormalizedResult[] }) {
  if (results.length === 0) {
    return <div className="state">无结果</div>;
  }
  return (
    <div className="result-list">
      {results.map((r, i) => (
        <ResultCard key={`${r.url}-${i}`} result={r} />
      ))}
    </div>
  );
}
