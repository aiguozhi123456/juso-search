import { describe, expect, it } from 'vitest';
import { baiduZhanneiSurface } from '@/lib/engines/baidu-zhannei';
import { allEngines, matchEngineByUrl } from '@/lib/engines/registry';
import { SERP_CONTENT_MATCH_PATTERNS, SERP_HOSTS, SERP_HOST_MATCH_PATTERNS } from '@/lib/engines/scopes';

describe('baiduZhanneiSurface (KTD3)', () => {
  it('matches only the canonical /cse/site route on zhannei.baidu.com', () => {
    expect(baiduZhanneiSurface.matches('https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn')).toBe(true);
    // 非 canonical 路径拒绝：/cse/search（自定义搜索框形态，非目标）与其他路径。
    expect(baiduZhanneiSurface.matches('https://zhannei.baidu.com/cse/search?s=abc&q=x')).toBe(false);
    expect(baiduZhanneiSurface.matches('https://zhannei.baidu.com/')).toBe(false);
    // http / 带端口拒绝。
    expect(baiduZhanneiSurface.matches('http://zhannei.baidu.com/cse/site?q=x&cc=a.com')).toBe(false);
    expect(baiduZhanneiSurface.matches('https://zhannei.baidu.com:8443/cse/site?q=x&cc=a.com')).toBe(false);
    // 主站 baidu SERP 不归 surface 管。
    expect(baiduZhanneiSurface.matches('https://www.baidu.com/s?wd=x')).toBe(false);
  });

  it('extracts the raw q parameter', () => {
    expect(baiduZhanneiSurface.extractQuery('https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn')).toBe('python');
    expect(baiduZhanneiSurface.extractQuery('https://zhannei.baidu.com/cse/site?cc=52pojie.cn')).toBeNull();
  });

  it('is not navigable: URL builders throw (surface, not an engine)', () => {
    expect(() => baiduZhanneiSurface.buildSerpUrl('q')).toThrow(/not navigable/);
    expect(() => baiduZhanneiSurface.buildHomeUrl()).toThrow(/not navigable/);
  });

  it('is reachable via matchEngineByUrl after the main registry', () => {
    expect(matchEngineByUrl('https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn')).toBe(baiduZhanneiSurface);
    // 主 registry 优先级不变。
    expect(matchEngineByUrl('https://www.baidu.com/s?wd=x')?.id).toBe('baidu');
    expect(matchEngineByUrl('https://zhannei.baidu.com/cse/search?s=abc')).toBeNull();
  });

  it('reports id baidu (backing-engine semantics) without joining allEngines()', () => {
    expect(baiduZhanneiSurface.id).toBe('baidu');
    // surface 不进 registry：allEngines 仍只有一个 baidu（不出现重复裸 pill）。
    expect(allEngines().filter((engine) => engine.id === 'baidu')).toHaveLength(1);
  });

  it('composes R5: hidden bare baidu still mounts when a matching instance stays visible', async () => {
    const { shouldMountForEngine } = await import('@/lib/serp-bar-mount');
    const engine = matchEngineByUrl('https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn');
    expect(engine).toBe(baiduZhanneiSurface);
    const { resolveSerpContext } = await import('@/lib/serp-handoff');
    const defs = [{ id: 'site:z' as const, name: '52pojie', target: 'https://52pojie.cn', engineId: 'baidu' as const, options: { mode: 'zhannei' as const } }];
    const url = 'https://zhannei.baidu.com/cse/site?q=python&cc=52pojie.cn';
    const visibleInstance = resolveSerpContext(engine!, url, defs, 'site:z', undefined, ['baidu']);
    expect(visibleInstance.matchingSiteId).toBe('site:z');
    expect(shouldMountForEngine(engine!.id, ['baidu'], visibleInstance.matchingSiteId)).toBe(true);
    // 引擎与实例都隐藏 → 无可见匹配，栏不挂载。
    const allHidden = resolveSerpContext(engine!, url, defs, 'site:z', undefined, ['baidu', 'site:z']);
    expect(allHidden.matchingSiteId).toBeNull();
    expect(shouldMountForEngine(engine!.id, ['baidu', 'site:z'], allHidden.matchingSiteId)).toBe(false);
  });

  it('scopes arrays expose the zhannei host for manifest + favicon WAR derivation', () => {
    expect(SERP_HOSTS).toContain('zhannei.baidu.com');
    expect(SERP_HOST_MATCH_PATTERNS).toContain('https://zhannei.baidu.com/*');
    expect(SERP_CONTENT_MATCH_PATTERNS).toContain('https://zhannei.baidu.com/cse/site*');
  });
});
