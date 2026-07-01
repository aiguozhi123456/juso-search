import type { NormalizedResult } from '@/lib/providers/types';
import { ResultCard } from './ResultCard';

export function ResultList({ results }: { results: NormalizedResult[] }) {
  return (
    <div className="result-list">
      {results.map((r) => (
        <ResultCard key={r.url} result={r} />
      ))}
    </div>
  );
}
