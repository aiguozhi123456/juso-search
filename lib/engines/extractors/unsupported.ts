// 不支持 headless 抽取的 engine 的占位 extractor。
//
// 当前所有已注册 engine（google/bing/baidu/yandex/duckduckgo/bilibili/xiaohongshu/douyin/weixin）
// 均有真实 extractor，无引擎映射到此占位。保留它是为「能力分层」机制兜底：未来新增的、
// 尚未实现 DOM 抽取的 engine 可映射到此处，无需新建文件——extractEngineSearch 调用
// hasNaturalResultsArea → 返回 false → 归一为 'unsupported-layout'，不产生结果也不抛错。
import type { EngineExtractor } from './types';

export const UNSUPPORTED_EXTRACTOR: EngineExtractor = {
  extract: () => [],
  pageState: () => null,
  hasNaturalResultsArea: () => false,
};
