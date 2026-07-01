import type { ProviderAdapter } from './types';

// U5 填实。
export const exaAdapter: ProviderAdapter = {
  id: 'exa',
  label: 'Exa',
  supportsAnswer: true,
  async search() {
    throw new Error('exa adapter not implemented (U5)');
  },
};
