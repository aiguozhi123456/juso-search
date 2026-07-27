import type { ProviderAdapter, ProviderId } from './types';
import { tavilyAdapter } from './tavily';
import { exaAdapter } from './exa';
import { stepfunAdapter } from './stepfun';
import { stepfunPlanAdapter } from './stepfun-plan';
import { jinaAdapter } from './jina';

const adapters: Record<ProviderId, ProviderAdapter> = {
  tavily: tavilyAdapter,
  exa: exaAdapter,
  stepfun: stepfunAdapter,
  'stepfun-plan': stepfunPlanAdapter,
  jina: jinaAdapter,
};

export function getAdapter(id: ProviderId): ProviderAdapter {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}

export function allProviders(): ProviderAdapter[] {
  return [
    adapters.tavily,
    adapters.exa,
    adapters.stepfun,
    adapters['stepfun-plan'],
    adapters.jina,
  ];
}
