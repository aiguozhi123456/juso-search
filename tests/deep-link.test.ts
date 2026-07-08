import { describe, it, expect } from 'vitest';
import { parseSearchDeepLink, buildSearchDeepLink } from '@/lib/deep-link';

describe('parseSearchDeepLink', () => {
  it('parses provider + query', () => {
    expect(parseSearchDeepLink('?provider=tavily&query=hello')).toEqual({
      provider: 'tavily',
      query: 'hello',
    });
  });

  it('parses only query', () => {
    expect(parseSearchDeepLink('?query=react')).toEqual({ query: 'react' });
  });

  it('parses only provider', () => {
    expect(parseSearchDeepLink('?provider=exa')).toEqual({ provider: 'exa' });
  });

  it('rejects unknown provider id (e.g. engine id)', () => {
    expect(parseSearchDeepLink('?provider=google&query=x')).toEqual({ query: 'x' });
  });

  it('rejects bogus provider value', () => {
    expect(parseSearchDeepLink('?provider=nope&query=x')).toEqual({ query: 'x' });
  });

  it('returns empty for no params', () => {
    expect(parseSearchDeepLink('')).toEqual({});
  });

  it('decodes encoded query', () => {
    expect(parseSearchDeepLink('?query=hello%20world').query).toBe('hello world');
  });
});

describe('buildSearchDeepLink', () => {
  it('builds a search.html deep link with provider + query', () => {
    expect(buildSearchDeepLink('tavily', 'hello world')).toBe(
      'search.html?provider=tavily&query=hello+world',
    );
  });
});
