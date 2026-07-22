// 不支持 headless 抽取的 engine 的占位 extractor。
//
// 抖音/小红书为登录态 SPA，结果经异步接口渲染且布局频繁变动，当前不做真实 DOM 抓取。
// 此 stub 满足 Record<EngineId, EngineExtractor> 全映射约束：extractEngineSearch 调用
// hasNaturalResultsArea → 返回 false → 归一为 'unsupported-layout'，不会产生结果也不会抛错。
import type { EngineExtractor } from './types';

export const UNSUPPORTED_EXTRACTOR: EngineExtractor = {
  extract: () => [],
  pageState: () => null,
  hasNaturalResultsArea: () => false,
};
