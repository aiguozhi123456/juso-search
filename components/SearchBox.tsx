import { useState, type FormEvent } from 'react';
import { t, MSG } from '@/lib/i18n';

interface Props {
  onSearch: (query: string) => void;
  loading?: boolean;
}

export function SearchBox({ onSearch, loading }: Props) {
  const [q, setQ] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (v) onSearch(v);
  }
  return (
    <form className="search-box" onSubmit={submit}>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t(MSG.search_placeholder)}
        autoFocus
        aria-label={t(MSG.search_aria)}
      />
      <button type="submit" disabled={loading}>
        {loading ? t(MSG.btn_searching) : t(MSG.btn_search)}
      </button>
    </form>
  );
}
