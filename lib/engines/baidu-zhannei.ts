// Baidu 站内搜索（zhannei.baidu.com/cse/site）的合成 SERP surface（KTD3）。
//
// 与 baidu.ts 的区别：这是一个「surface engine」——
// - id 仍为 'baidu'（合法 EngineId，满足 SearchEngine 类型；backing engine 语义挂 baidu）；
// - matches() 只认 zhannei.baidu.com 的 /cse/site canonical 路径；
// - **不进 registry、不进 allEngines()、无裸 pill**——无 cc 的 zhannei 搜索无意义，
//   且会污染 allEngines() 驱动的快切栏/右键菜单/agent 列表；
// - 仅由 matchEngineByUrl 在主 registry 之后追加检查（serp-bar 据此在 zhannei
//   结果页挂载快切栏）；
// - **不可导航**：buildSerpUrl/buildHomeUrl 直接 throw——无 cc 的 zhannei URL 不是
//   合法搜索。全仓调用点均经 registry getEngine 或按 source kind 分派，surface
//   不可达；throw 把「非引擎」从注释约定升级为运行时契约，防未来重构误接导航路径。
import type { AnchorStrategy, SearchEngine } from './types';
import { isSerpUrl, isZhanneiSerpHostname } from './scopes';

const QUERY_PARAM = 'q';
// 真机确认（用户 devtools 探针）：结果页骨架为
// #wrap > #container(.clearfix) > #center.content > #results.content-main > .result×N
// （#results ≈540px 结果列；#container ≈1210px 全宽包裹）。首选 #results 前插并对齐
// （与 baidu 主站 content_left 同款位），#container/body 兜底。
const ANCHORS: AnchorStrategy[] = [
  { selector: '#results', append: 'before', alignTo: '#results' },
  { selector: '#container', append: 'first' },
  { selector: 'body', append: 'first' },
];

export const baiduZhanneiSurface: SearchEngine = {
  id: 'baidu',
  label: 'engine_baidu',
  favicon: '/icons/baidu.svg',
  buildSerpUrl(): string {
    throw new Error('baidu-zhannei surface is not navigable: zhannei requires a cc site — build a site-instance URL instead');
  },
  buildHomeUrl(): string {
    throw new Error('baidu-zhannei surface is not navigable');
  },
  matches(url: string): boolean {
    try {
      return isSerpUrl(new URL(url), isZhanneiSerpHostname, '/cse/site');
    } catch {
      return false;
    }
  },
  extractQuery(url: string): string | null {
    try {
      return new URL(url).searchParams.get(QUERY_PARAM);
    } catch {
      return null;
    }
  },
  anchors: ANCHORS,
};
