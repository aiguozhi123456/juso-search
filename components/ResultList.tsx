import type { NormalizedResult } from '@/lib/providers/types';
import type { SourceId } from '@/lib/sources';
import { ResultCard } from './ResultCard';
import { t, MSG } from '@/lib/i18n';
import { BrandMark } from './icons';

/** 结果条目的来源徽标（聚合视图 R5：多源多徽标；favicon + label）。 */
export interface ResultSourceBadge {
  id: string;
  label: string;
  favicon?: string;
}

export function ResultList<T extends NormalizedResult>({ results, sourceId, sourcesForResult, showScore }: {
  results: T[];
  sourceId?: SourceId;
  /** 聚合视图（R5）：按结果返回 provenance 徽标；缺省 = solo 渲染（无徽标行）。 */
  sourcesForResult?: (result: T, index: number) => ResultSourceBadge[];
  /** 聚合视图（R5）：展示 rerank 相关度百分比（result.score ∈ [0,1]）。 */
  showScore?: boolean;
}) {
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
        <ResultCard
          key={`${r.url}-${i}`}
          result={r}
          sourceId={sourceId}
          sourceBadges={sourcesForResult?.(r, i)}
          score={showScore ? r.score : undefined}
        />
      ))}
    </div>
  );
}
