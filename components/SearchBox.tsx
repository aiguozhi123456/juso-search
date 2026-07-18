import type { FormEvent } from 'react';
import { t, MSG } from '@/lib/i18n';
import { SearchIcon, StopIcon } from './icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  onInterrupt?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function SearchBox({ value, onChange, onSearch, onInterrupt, loading, disabled }: Props) {
  function submit(e: FormEvent) {
    e.preventDefault();
    if (loading || disabled) return;
    const v = value.trim();
    if (v) onSearch(v);
  }
  return (
    <form className="search-box" onSubmit={submit}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={t(MSG.search_placeholder)}
        autoFocus
        aria-label={t(MSG.search_aria)}
      />
      <button type="submit" disabled={loading || disabled}>
        <SearchIcon size={16} />
        <span>{loading ? t(MSG.btn_searching) : t(MSG.btn_search)}</span>
      </button>
      {loading && onInterrupt && (
        <button type="button" className="interrupt-button" onClick={onInterrupt}>
          <StopIcon size={14} />
          <span>{t(MSG.btn_interrupt)}</span>
        </button>
      )}
    </form>
  );
}
