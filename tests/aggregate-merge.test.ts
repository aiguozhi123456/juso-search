import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_CANDIDATE_POOL_SIZE,
  buildRerankDocument,
  mergeAggregateMembers,
  normalizeResultUrl,
  type AggregateMemberContribution,
} from '@/lib/aggregate/merge';
import type { AggregateMemberId } from '@/lib/aggregate/types';
import type { NormalizedResult, NormalizedSearchResponse } from '@/lib/providers/types';

function contribution(sourceId: AggregateMemberId, results: { title: string; url: string }[], answerText?: string): AggregateMemberContribution {
  const response: NormalizedSearchResponse = {
    query: 'q',
    provider: sourceId as NormalizedSearchResponse['provider'],
    ...(answerText ? { answer: { text: answerText, citations: [] } } : {}),
    results: results.map((r) => ({ title: r.title, url: r.url, snippet: `snippet of ${r.title}` })),
  };
  return { sourceId, response };
}

describe('normalizeResultUrl (R5)', () => {
  it('lowercases the host', () => {
    expect(normalizeResultUrl('https://EXAMPLE.com/Page')).toBe('https://example.com/Page');
  });

  it('strips utm_* parameters (case-insensitive)', () => {
    expect(normalizeResultUrl('https://a.com/p?utm_source=x&utm_medium=y&utm_campaign=z&id=7')).toBe('https://a.com/p?id=7');
    expect(normalizeResultUrl('https://a.com/p?UTM_Source=x')).toBe('https://a.com/p');
  });

  it('strips known click-tracking parameters (fbclid 等)', () => {
    expect(normalizeResultUrl('https://a.com/p?fbclid=ABC&q=1')).toBe('https://a.com/p?q=1');
    expect(normalizeResultUrl('https://a.com/p?gclid=G&msclkid=M&dclid=D&keep=1')).toBe('https://a.com/p?keep=1');
  });

  it('strips the hash fragment', () => {
    expect(normalizeResultUrl('https://a.com/p#section')).toBe('https://a.com/p');
  });

  it('strips trailing slashes but keeps the root slash', () => {
    expect(normalizeResultUrl('https://a.com/p/')).toBe('https://a.com/p');
    expect(normalizeResultUrl('https://a.com/p///')).toBe('https://a.com/p');
    expect(normalizeResultUrl('https://a.com/')).toBe('https://a.com/');
    expect(normalizeResultUrl('https://a.com/p/?utm_source=x')).toBe('https://a.com/p');
  });

  it('keeps non-tracking parameters and their original casing', () => {
    expect(normalizeResultUrl('https://a.com/p?Id=2&q=hi')).toBe('https://a.com/p?Id=2&q=hi');
  });

  it('returns unparsable input trimmed as-is (dedupe key degrades to exact string)', () => {
    expect(normalizeResultUrl('  not a url  ')).toBe('not a url');
  });
});

describe('mergeAggregateMembers (R5/KTD8)', () => {
  it('keeps the first occurrence of a normalized URL and merges provenance from later members', () => {
    const output = mergeAggregateMembers([
      contribution('tavily', [{ title: 'First', url: 'https://a.com/p?utm_source=tavily' }]),
      contribution('exa', [{ title: 'Second', url: 'https://A.com/p' }]),
    ]);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]).toMatchObject({ title: 'First', url: 'https://a.com/p?utm_source=tavily', sources: ['tavily', 'exa'] });
    expect(output.dedupedCount).toBe(1);
  });

  it('records each distinct source once per merged entry', () => {
    const output = mergeAggregateMembers([
      contribution('tavily', [{ title: 'A', url: 'https://a.com/p' }]),
      contribution('exa', [{ title: 'B', url: 'https://a.com/p#frag' }]),
      contribution('brave', [{ title: 'C', url: 'https://a.com/p?fbclid=x' }]),
    ]);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]?.sources).toEqual(['tavily', 'exa', 'brave']);
    expect(output.dedupedCount).toBe(2);
  });

  it('does not duplicate a member own source when it returns the same URL twice', () => {
    const output = mergeAggregateMembers([
      contribution('tavily', [
        { title: 'A', url: 'https://a.com/p' },
        { title: 'B', url: 'https://a.com/p/' },
      ]),
    ]);
    expect(output.results).toHaveLength(1);
    expect(output.results[0]?.sources).toEqual(['tavily']);
    expect(output.dedupedCount).toBe(1);
  });

  it('crops the merged list to the candidate pool (KTD8: top 40) keeping first-seen order', () => {
    const results = Array.from({ length: AGGREGATE_CANDIDATE_POOL_SIZE + 5 }, (_, i) => ({ title: `R${i}`, url: `https://r-${i}.test` }));
    const output = mergeAggregateMembers([contribution('tavily', results)]);
    expect(output.results).toHaveLength(AGGREGATE_CANDIDATE_POOL_SIZE);
    expect(output.results[0]?.title).toBe('R0');
    expect(output.results[AGGREGATE_CANDIDATE_POOL_SIZE - 1]?.title).toBe(`R${AGGREGATE_CANDIDATE_POOL_SIZE - 1}`);
    expect(output.dedupedCount).toBe(0);
  });

  it('aggregates answers in member order and skips members without answers (R4)', () => {
    const output = mergeAggregateMembers([
      contribution('tavily', [{ title: 'A', url: 'https://a.com' }], 'answer from tavily'),
      contribution('exa', [{ title: 'B', url: 'https://b.com' }]),
      contribution('brave', [{ title: 'C', url: 'https://c.com' }], 'answer from brave'),
    ]);
    expect(output.answers).toEqual([
      { sourceId: 'tavily', answer: { text: 'answer from tavily', citations: [] } },
      { sourceId: 'brave', answer: { text: 'answer from brave', citations: [] } },
    ]);
  });

  it('returns empty output for no contributions', () => {
    expect(mergeAggregateMembers([])).toEqual({ answers: [], results: [], dedupedCount: 0 });
  });
});

describe('buildRerankDocument (KTD2)', () => {
  it('builds title + newline + snippet without using content', () => {
    const result: NormalizedResult = { title: 'Title', url: 'https://a.test/p', snippet: 'Snippet text', content: 'LONG CONTENT SHOULD BE IGNORED' };
    expect(buildRerankDocument(result)).toBe('Title\nSnippet text');
  });

  it('truncates the snippet to 512 characters', () => {
    const doc = buildRerankDocument({ title: 'T', snippet: 's'.repeat(600) });
    expect(doc).toBe(`T\n${'s'.repeat(512)}`);
    expect(doc.length).toBe(514);
  });

  it('drops metadata snippets from the rerank document (title only)', () => {
    // 用户反馈修复：小红书/B站/抖音的纯展示元数据 snippet（作者/点赞/播放等）稀释
    // cross-encoder（实测塌 5.6 倍）——snippetKind:'metadata' → 文档 = 仅 title。
    const doc = buildRerankDocument({
      title: '三亚旅游攻略',
      snippet: '作者: 某某 · 点赞: 1.2万 · 播放: 952.7万',
      snippetKind: 'metadata',
    });
    expect(doc).toBe('三亚旅游攻略');
    expect(doc).not.toContain('作者');
    expect(doc).not.toContain('点赞');
  });

  it('keeps concatenating unmarked snippets (absent snippetKind = semantic summary)', () => {
    // 无标记 = 语义正文（web 引擎与 provider 适配器）：照常 title + snippet。
    const doc = buildRerankDocument({ title: 'Title', snippet: 'Semantic summary text' });
    expect(doc).toBe('Title\nSemantic summary text');
  });

  it('handles legacy result shapes without the snippetKind field unchanged', () => {
    // 旧形状结果（无 snippetKind 字段，如历史缓存/旧抽取器输出）照常拼接。
    const doc = buildRerankDocument({ title: 'Legacy', snippet: 'Legacy snippet' });
    expect(doc).toBe('Legacy\nLegacy snippet');
  });
});
