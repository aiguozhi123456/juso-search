import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocale } from '@/lib/useLocale';
import * as storage from '@/lib/storage';
import { getCurrentLocale } from '@/lib/i18n';

vi.mock('@/lib/storage', () => ({
  getLocalePref: vi.fn(),
  setLocalePref: vi.fn(),
}));

// 捕获 onChanged 监听器（与 theme.test.tsx 同模式）
function mockOnChanged() {
  const listeners = new Set<(changes: unknown) => void>();
  vi.stubGlobal('browser', {
    storage: {
      onChanged: {
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

describe('useLocale', () => {
  it('initializes from stored pref', async () => {
    mockOnChanged();
    vi.mocked(storage.getLocalePref).mockResolvedValue('en');
    const { result } = renderHook(() => useLocale());
    await vi.waitFor(() => expect(result.current.pref).toBe('en'));
    expect(getCurrentLocale()).toBe('en');
  });

  it('setPref optimistically switches and persists', async () => {
    mockOnChanged();
    const { result } = renderHook(() => useLocale());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('en'));
    expect(result.current.pref).toBe('en');
    expect(storage.setLocalePref).toHaveBeenCalledWith('en');
  });

  it('rolls back pref when persist rejects', async () => {
    mockOnChanged();
    vi.mocked(storage.setLocalePref).mockRejectedValueOnce(new Error('quota'));
    const { result } = renderHook(() => useLocale());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('en'));
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
  });

  it('onChanged cross-tab: a valid remote localePref syncs pref', async () => {
    const listeners = mockOnChanged();
    const { result } = renderHook(() => useLocale());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ localePref: { newValue: 'en' } });
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('en'));
  });

  it('onChanged ignores unknown newValue', async () => {
    const listeners = mockOnChanged();
    const { result } = renderHook(() => useLocale());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ localePref: { newValue: 'fr' } });
    });
    expect(result.current.pref).toBe('auto');
  });
});
