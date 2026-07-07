import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocale } from '@/lib/useLocale';
import * as storage from '@/lib/storage';
import { getCurrentLocale } from '@/lib/i18n';

vi.mock('@/lib/storage', () => ({
  getLocalePref: vi.fn(),
  setLocalePref: vi.fn(),
}));

// 捕获 runtime.onMessage 监听器（与 theme.test.tsx 同模式）
function mockRuntimeMessages() {
  const listeners = new Set<(changes: unknown) => void>();
  vi.stubGlobal('browser', {
    runtime: {
      onMessage: {
        addListener: (l: (c: unknown) => void) => listeners.add(l),
        removeListener: (l: (c: unknown) => void) => listeners.delete(l),
      },
    },
  });
  return listeners;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getLocalePref).mockResolvedValue('auto');
  vi.mocked(storage.setLocalePref).mockResolvedValue(undefined);
  document.documentElement.removeAttribute('lang');
});

async function renderUseLocale() {
  const rendered = renderHook(() => useLocale());
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

describe('useLocale', () => {
  it('initializes from stored pref', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.getLocalePref).mockResolvedValue('en');
    const { result } = await renderUseLocale();
    await vi.waitFor(() => expect(result.current.pref).toBe('en'));
    expect(getCurrentLocale()).toBe('en');
  });

  it('setPref optimistically switches and persists', async () => {
    mockRuntimeMessages();
    const { result } = await renderUseLocale();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('en'));
    expect(result.current.pref).toBe('en');
    expect(storage.setLocalePref).toHaveBeenCalledWith('en');
  });

  it('rolls back pref when persist rejects', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.setLocalePref).mockRejectedValueOnce(new Error('quota'));
    const { result } = await renderUseLocale();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    await act(async () => {
      result.current.setPref('en');
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
  });

  it('onChanged cross-tab: a valid remote localePref syncs pref', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseLocale();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'localePref', value: 'en' });
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('en'));
  });

  it('onChanged ignores unknown newValue', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseLocale();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'localePref', value: 'fr' });
    });
    expect(result.current.pref).toBe('auto');
  });
});
