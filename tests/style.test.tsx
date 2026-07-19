import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStyle } from '@/lib/useStyle';
import * as storage from '@/lib/storage';

// useStyle 依赖：getStylePref/setStylePref（mock）+ browser.runtime.onMessage。
// 镜像 tests/theme.test.tsx 的隔离模式。
vi.mock('@/lib/storage', () => ({
  getStylePref: vi.fn(),
  setStylePref: vi.fn(),
}));

function mockRuntimeMessages() {
  const listeners = new Set<(changes: unknown) => void>();
  vi.stubGlobal('browser', {
    runtime: {
      onMessage: {
        addListener: (l: (changes: unknown) => void) => listeners.add(l),
        removeListener: (l: (changes: unknown) => void) => listeners.delete(l),
      },
    },
  });
  return listeners;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getStylePref).mockResolvedValue('classic');
  vi.mocked(storage.setStylePref).mockResolvedValue(undefined);
  document.documentElement.removeAttribute('data-style');
});

async function renderUseStyle() {
  const rendered = renderHook(() => useStyle());
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

describe('useStyle', () => {
  it('defaults to classic when storage is empty', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.getStylePref).mockResolvedValue('classic');
    const { result } = await renderUseStyle();
    await vi.waitFor(() => expect(result.current.pref).toBe('classic'));
    expect(document.documentElement.dataset.style).toBe('classic');
  });

  it('reads colorful from storage and writes data-style=colorful', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.getStylePref).mockResolvedValue('colorful');
    const { result } = await renderUseStyle();
    await vi.waitFor(() => expect(result.current.pref).toBe('colorful'));
    expect(document.documentElement.dataset.style).toBe('colorful');
  });

  it('setPref writes storage and updates data-style optimistically', async () => {
    mockRuntimeMessages();
    const { result } = await renderUseStyle();
    await vi.waitFor(() => expect(result.current.pref).toBe('classic'));
    act(() => result.current.setPref('colorful'));
    expect(result.current.pref).toBe('colorful');
    expect(document.documentElement.dataset.style).toBe('colorful');
    expect(storage.setStylePref).toHaveBeenCalledWith('colorful');
  });

  it('rolls back pref when persist rejects', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.setStylePref).mockRejectedValueOnce(new Error('quota'));
    const { result } = await renderUseStyle();
    await vi.waitFor(() => expect(result.current.pref).toBe('classic'));
    await act(async () => {
      result.current.setPref('colorful');
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('classic'));
    expect(document.documentElement.dataset.style).toBe('classic');
  });

  it('onChanged cross-tab: a valid remote stylePref syncs pref + data-style', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseStyle();
    await vi.waitFor(() => expect(result.current.pref).toBe('classic'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'stylePref', value: 'colorful' });
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('colorful'));
    expect(document.documentElement.dataset.style).toBe('colorful');
  });

  it('onChanged ignores unknown newValue (validation branch)', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseStyle();
    await vi.waitFor(() => expect(result.current.pref).toBe('classic'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'stylePref', value: 'neon' });
    });
    expect(result.current.pref).toBe('classic');
    expect(document.documentElement.dataset.style).toBe('classic');
  });
});
