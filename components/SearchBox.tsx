import { useState, type FormEvent } from 'react';

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
        placeholder="输入搜索词…"
        autoFocus
        aria-label="搜索词"
      />
      <button type="submit" disabled={loading}>
        {loading ? '搜索中…' : '搜索'}
      </button>
    </form>
  );
}
