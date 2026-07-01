import type { ProviderAdapter } from './types';

// U4 填实。桩：保留 id/label/supportsAnswer 供注册表与 UI 使用。
export const tavilyAdapter: ProviderAdapter = {
  id: 'tavily',
  label: 'Tavily',
  supportsAnswer: true,
  async search() {
    throw new Error('tavily adapter not implemented (U4)');
  },
};
