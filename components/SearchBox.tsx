import type { FormEvent } from 'react';
import { t, MSG } from '@/lib/i18n';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  onInterrupt?: () => void;
  loading?: boolean;
}

export function SearchBox({ value, onChange, onSearch, onInterrupt, loading }: Props) {
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (v) onSearch(v);
  }
  return (
    <form className="search-box" onSubmit={submit}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(MSG.search_placeholder)}
        autoFocus
        aria-label={t(MSG.search_aria)}
      />
      <button type="submit" disabled={loading}>
        {loading ? t(MSG.btn_searching) : t(MSG.btn_search)}
      </button>
      {loading && onInterrupt && (
        <button type="button" className="interrupt-button" onClick={onInterrupt}>
          {t(MSG.btn_interrupt)}
        </button>
      )}
    </form>
  );
}
