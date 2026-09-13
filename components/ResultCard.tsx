import { useState } from 'react';
import type { NormalizedResult } from '@/lib/providers/types';
import type { SourceId } from '@/lib/sources';
import { resolveIconUrl } from '@/lib/sources';
import type { ResultSourceBadge } from './ResultList';
import { t, MSG } from '@/lib/i18n';

export function ResultCard({ result, sourceId, sourceBadges, score }: {
  result: NormalizedResult;
  sourceId?: SourceId;
  /** 聚合视图（R5）：provenance 徽标行（多源多徽标）。 */
  sourceBadges?: ResultSourceBadge[];
  /** 聚合视图（R5）：rerank relevance_score（0–1），渲染为百分比。 */
  score?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <article className="result-card" data-source={sourceId}>
      <div className="result-head">
        {result.favicon && (
          <img
            src={result.favicon}
            alt=""
            width={16}
            height={16}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}
        <a href={result.url} target="_blank" rel="noreferrer" className="result-title">
          {result.title}
        </a>
        {typeof score === 'number' && Number.isFinite(score) && (
          <span className="result-score">{t(MSG.aggregate_result_score, [String(Math.round(score * 100))])}</span>
        )}
      </div>
      {sourceBadges && sourceBadges.length > 0 && (
        <div className="result-sources">
          {sourceBadges.map((badge, i) => (
            <span className="aggregate-badge" key={`${badge.id}-${i}`} data-member={badge.id}>
              {badge.favicon && (
                <img
                  src={resolveIconUrl(badge.favicon)}
                  alt=""
                  width={12}
                  height={12}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <span className="aggregate-badge-label">{badge.label}</span>
            </span>
          ))}
        </div>
      )}
      <div className="result-url">{result.url}</div>
      <p className="result-snippet">{result.snippet}</p>
      {result.content && (
        <>
          <button className="toggle" onClick={() => setOpen((o) => !o)}>
            {open ? t(MSG.collapse) : t(MSG.expand)}
          </button>
          {open && <div className="result-content">{result.content}</div>}
        </>
      )}
    </article>
  );
}
