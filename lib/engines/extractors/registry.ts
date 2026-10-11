import type { EngineId } from '../types';
import { baiduExtractor } from './baidu';
import { bilibiliExtractor } from './bilibili';
import { bingExtractor } from './bing';
import { douyinExtractor } from './douyin';
import { duckduckgoExtractor } from './duckduckgo';
import { googleExtractor } from './google';
import type { EngineExtractor } from './types';
import { weixinExtractor } from './weixin';
import { xiaohongshuExtractor } from './xiaohongshu';
import { yandexExtractor } from './yandex';

const extractors: Record<EngineId, EngineExtractor> = {
  google: googleExtractor,
  bing: bingExtractor,
  baidu: baiduExtractor,
  douyin: douyinExtractor,
  xiaohongshu: xiaohongshuExtractor,
  bilibili: bilibiliExtractor,
  yandex: yandexExtractor,
  duckduckgo: duckduckgoExtractor,
  weixin: weixinExtractor,
};

export function getEngineExtractor(engine: EngineId): EngineExtractor | null {
  // 普通对象字面量继承 Object.prototype——'toString' 等键会命中继承函数（truthy），
  // 让调用方的 `!= null` 漂移守卫失效。按 own property 判定，非本表键返回 null。
  return Object.prototype.hasOwnProperty.call(extractors, engine) ? extractors[engine] : null;
}
