// buildSafeSearchUrl 是 openSearchPage handler 唯一的入参净化点。
// 这层测试锁死其安全不变量：无论入参是什么，产出永远是扩展内 /search.html 为 base、
// 仅含 provider/query 白名单参数的绝对 URL——路径层防 open-redirect、参数层防注入无关键。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildSafeSearchUrl } from '@/lib/search-page-url';

const EXT_ORIGIN = 'chrome-extension://fake-id';

beforeEach(() => {
  vi.stubGlobal('browser', {
    runtime: {
      getURL: (p: string) => `${EXT_ORIGIN}/${p.replace(/^\//, '')}`,
    },
  });
});

describe('buildSafeSearchUrl — 白名单参数转发', () => {
  it('保留 provider + query 参数', () => {
    expect(buildSafeSearchUrl('search.html?provider=tavily&query=hi')).toBe(
      `${EXT_ORIGIN}/search.html?provider=tavily&query=hi`,
    );
  });

  it('容忍前导斜杠的入参形状', () => {
    expect(buildSafeSearchUrl('/search.html?provider=exa&query=hello+world')).toBe(
      `${EXT_ORIGIN}/search.html?provider=exa&query=hello+world`,
    );
  });

  it('仅保留白名单参数；丢弃非白名单 key', () => {
    const got = buildSafeSearchUrl('search.html?provider=tavily&evil=1&query=x&tab=settings')!;
    expect(got).toContain('provider=tavily');
    expect(got).toContain('query=x');
    expect(got).not.toContain('evil');
    expect(got).not.toContain('tab');
  });

  it('只给 provider 也合法', () => {
    expect(buildSafeSearchUrl('search.html?provider=stepfun')).toBe(
      `${EXT_ORIGIN}/search.html?provider=stepfun`,
    );
  });

  it('空查询分支落 /search.html（无 query）', () => {
    expect(buildSafeSearchUrl('/search.html')).toBe(`${EXT_ORIGIN}/search.html`);
  });
});

describe('buildSafeSearchUrl — 路径层防 open-redirect（#2=B 核心）', () => {
  // 关键不变量：base 永远是 /search.html——入参的路径信息被完全丢弃。
  // 误用 caller 传 options.html 不会把当前 tab 导航到 options.html。
  it('把 options.html 入参收敛到 /search.html', () => {
    const got = buildSafeSearchUrl('options.html')!;
    expect(got.startsWith(`${EXT_ORIGIN}/search.html`)).toBe(true);
    expect(got).not.toContain('options');
  });

  it('把 options.html?x=1 入参收敛到 /search.html（参数也被丢弃）', () => {
    const got = buildSafeSearchUrl('options.html?x=1')!;
    expect(got.startsWith(`${EXT_ORIGIN}/search.html`)).toBe(true);
    expect(got).not.toContain('options');
    expect(got).not.toContain('x=1');
  });

  it('纯乱串（无 ?）仍落 /search.html', () => {
    expect(buildSafeSearchUrl('garbage')).toBe(`${EXT_ORIGIN}/search.html`);
  });

  it('带恶意路径 + 白名单参数的混合形态：路径丢弃，参数保留', () => {
    const got = buildSafeSearchUrl('//evil.com/options.html?provider=tavily&query=x')!;
    expect(got.startsWith(`${EXT_ORIGIN}/search.html`)).toBe(true);
    expect(got).toContain('provider=tavily');
    expect(got).toContain('query=x');
    expect(got).not.toContain('evil.com');
  });
});

describe('buildSafeSearchUrl — 非法入参返回 null', () => {
  it('拒绝空字符串', () => {
    expect(buildSafeSearchUrl('')).toBeNull();
  });

  it('拒绝 undefined', () => {
    expect(buildSafeSearchUrl(undefined)).toBeNull();
  });
});
