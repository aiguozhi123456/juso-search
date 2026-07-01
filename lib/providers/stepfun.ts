import type { ProviderAdapter } from './types';

// U6 填实（按量 REST POST /v1/search）。
export const stepfunAdapter: ProviderAdapter = {
  id: 'stepfun',
  label: 'Stepfun 按量',
  supportsAnswer: false,
  async search() {
    throw new Error('stepfun adapter not implemented (U6)');
  },
};
