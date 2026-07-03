import { useState } from 'react';
import type { NormalizedResult } from '@/lib/providers/types';
import { t, MSG } from '@/lib/i18n';

export function ResultCard({ result }: { result: NormalizedResult }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="result-card">
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
      </div>
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
