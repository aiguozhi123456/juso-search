import type { EngineId } from '../types';
import { baiduExtractor } from './baidu';
import { bingExtractor } from './bing';
import { googleExtractor } from './google';
import type { EngineExtractor } from './types';
import { UNSUPPORTED_EXTRACTOR } from './unsupported';

const extractors: Record<EngineId, EngineExtractor> = {
  google: googleExtractor,
  bing: bingExtractor,
  baidu: baiduExtractor,
  // 抖音 / 小红书暂不做 headless 结果抽取：登录态 SPA，结果经异步接口渲染。
  // 用占位 extractor 满足全映射，归一为 'unsupported-layout'。
  douyin: UNSUPPORTED_EXTRACTOR,
  xiaohongshu: UNSUPPORTED_EXTRACTOR,
};

export function getEngineExtractor(engine: EngineId): EngineExtractor {
  return extractors[engine];
}
