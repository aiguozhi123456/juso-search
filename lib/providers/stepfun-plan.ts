import type { ProviderAdapter } from './types';

// U10 填实（Step Plan 订阅，MCP web_search tool-call）。
export const stepfunPlanAdapter: ProviderAdapter = {
  id: 'stepfun-plan',
  label: 'Stepfun Step Plan',
  supportsAnswer: false,
  async search() {
    throw new Error('stepfun-plan adapter not implemented (U10)');
  },
};
