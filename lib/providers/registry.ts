import type { ProviderAdapter, ProviderId } from './types';
import { tavilyAdapter } from './tavily';
import { exaAdapter } from './exa';
import { braveAdapter } from './brave';
import { stepfunAdapter } from './stepfun';
import { stepfunPlanAdapter } from './stepfun-plan';
import { jinaAdapter } from './jina';
import { doubaoAdapter } from './doubao';
import { doubaoGlobalAdapter } from './doubao-global';
import { parallelAdapter } from './parallel';
import { deepseekAdapter } from './deepseek';
import { anysearchAdapter } from './anysearch';

const adapters: Record<ProviderId, ProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  brave: braveAdapter,
  stepfun: stepfunAdapter,
  'stepfun-plan': stepfunPlanAdapter,
  jina: jinaAdapter,
  doubao: doubaoAdapter,
  'doubao-global': doubaoGlobalAdapter,
  parallel: parallelAdapter,
  deepseek: deepseekAdapter,
  anysearch: anysearchAdapter,
};

export function getAdapter(id: ProviderId): ProviderAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}

/** provider 是否声明 key 可选（免 key 免费层）。未知 id 抛错，调用方需先经 isProviderId/isKnownProvider 收窄。 */
export function isProviderKeyless(id: ProviderId): boolean {
  return getAdapter(id).keyOptional === true;
}

/** 单点可用性谓词：有 key，或 provider 声明 keyOptional（免 key 免费层）。
 *  所有「provider 是否可用/已配置」的派生（configuredProviderIds、投影、回退、
 *  setActiveSource 门）必须经此判定，不得再散写 keys[id] 布尔。 */
export function isProviderUsable(id: ProviderId, keys: Record<string, string>): boolean {
  return !!keys[id] || isProviderKeyless(id);
}

/** 首选源回退的两级偏好：有 key 的 provider（注册序）优先于免 key provider（注册序）。
 *  老 key 用户删 key 后的回退不漂移；全新安装（无任何 key）才落到免 key provider
 *  （开箱即用）。显式选择不受此影响（isProviderUsable 校验存量值）。 */
export function preferredProviderFallback(keys: Record<string, string>): ProviderId | undefined {
  const keyed = allProviders().find((p) => keys[p.id]);
  if (keyed) return keyed.id;
  return allProviders().find((p) => isProviderKeyless(p.id))?.id;
}

export function allProviders(): ProviderAdapter[] {
  return [
    adapters.tavily,
    adapters.exa,
    adapters.brave,
    adapters.stepfun,
    adapters['stepfun-plan'],
    adapters.jina,
    adapters.doubao,
    adapters['doubao-global'],
    adapters.parallel,
    adapters.deepseek,
    adapters.anysearch,
  ];
}
