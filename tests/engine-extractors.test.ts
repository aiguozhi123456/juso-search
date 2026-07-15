import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEngineSearch } from '@/lib/engines/extractors';
import type { EngineId } from '@/lib/engines/types';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures/engines', name), 'utf8');

function extract(engine: EngineId, name: string, maxResults?: number) {
  const document = new DOMParser().parseFromString(fixture(name), 'text/html');
  return extractEngineSearch({ document, engine, query: 'test query', pageUrl: `https://www.${engine}.com/search?q=test`, maxResults });
}

describe('engine natural-result extractors', () => {
  it('extracts and cleans Google natural results', () => {
    expect(extract('google', 'google-basic.html')).toEqual({
      engine: 'google', query: 'test query', results: [
        { title: 'Example guide', url: 'https://example.com/guide', snippet: 'Useful guide text.' },
        { title: 'Second result', url: 'https://example.org/second', snippet: 'Second snippet' },
      ],
    });
  });

  it('excludes Google AI, knowledge, and featured-answer blocks', () => {
    expect(extract('google', 'google-special-blocks.html')).toEqual({
      engine: 'google', query: 'test query', results: [{ title: 'Natural result', url: 'https://example.com/natural', snippet: 'Natural snippet' }],
    });
  });

  it('only unwraps Google redirects hosted by Google', () => {
    expect(extract('google', 'google-external-url-path.html')).toEqual({
      engine: 'google', query: 'test query', results: [{ title: 'External URL path', url: 'https://example.com/url?q=https%3A%2F%2Fevil.example', snippet: 'External snippet' }],
    });
  });

  it('extracts Bing redirect URLs and rejects ads and invalid schemes', () => {
    expect(extract('bing', 'bing-basic.html')).toEqual({
      engine: 'bing', query: 'test query', results: [{ title: 'Bing title', url: 'https://example.com/bing', snippet: 'Bing snippet' }],
    });
  });

  it('only unwraps Bing redirects hosted by Bing', () => {
    expect(extract('bing', 'bing-external-ck-path.html')).toEqual({
      engine: 'bing', query: 'test query', results: [{ title: 'External CK path', url: 'https://example.com/ck/a?u=a1aHR0cHM6Ly9ldmlsLmV4YW1wbGU', snippet: 'External snippet' }],
    });
  });

  it('prefers Baidu mu URLs and deduplicates them', () => {
    expect(extract('baidu', 'baidu-basic.html')).toEqual({
      engine: 'baidu', query: 'test query', results: [{ title: 'Baidu title', url: 'https://example.cn/article', snippet: 'Baidu abstract' }],
    });
  });

  it('clamps the requested maximum result count', () => {
    expect((extract('google', 'google-basic.html', 1) as { results: unknown[] }).results).toHaveLength(1);
    expect((extract('google', 'google-basic.html', 0) as { results: unknown[] }).results).toHaveLength(1);
  });

  it.each([
    ['google', 'google-challenge.html', 'challenge'],
    ['bing', 'bing-consent.html', 'consent'],
    ['baidu', 'baidu-unsupported.html', 'no-results'],
  ] as const)('reports %s page states without treating them as empty results', (engine, name, error) => {
    expect(extract(engine, name)).toEqual({ engine, query: 'test query', error });
  });

  it('reports unsupported layout when a result root is absent', () => {
    const document = new DOMParser().parseFromString('<main><article>special card</article></main>', 'text/html');
    expect(extractEngineSearch({ document, engine: 'google', query: 'test', pageUrl: 'https://www.google.com/search?q=test' })).toEqual({
      engine: 'google', query: 'test', error: 'unsupported-layout',
    });
  });
});
