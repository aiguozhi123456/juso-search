import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '@/lib/useTheme';
import * as storage from '@/lib/storage';

// useTheme 依赖：getThemePref/setThemePref（mock）、browser.runtime.onMessage、window.matchMedia
vi.mock('@/lib/storage', () => ({
  getThemePref: vi.fn(),
  setThemePref: vi.fn(),
}));

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: unknown) => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      addEventListener: (_: string, l: (e: unknown) => void) => listeners.add(l),
      removeEventListener: (_: string, l: (e: unknown) => void) => listeners.delete(l),
    }),
  );
  return listeners;
}

// 捕获 runtime.onMessage 监听器，让跨标签同步路径可被测试且不接触 providerKeys。
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
  vi.mocked(storage.getThemePref).mockResolvedValue('auto');
  vi.mocked(storage.setThemePref).mockResolvedValue(undefined);
  document.documentElement.removeAttribute('data-theme');
});

async function renderUseTheme() {
  const rendered = renderHook(() => useTheme());
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

describe('useTheme', () => {
  it('resolves auto -> light when system is light', async () => {
    mockMatchMedia(false);
    mockRuntimeMessages();
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves auto -> dark when system is dark', async () => {
    mockMatchMedia(true);
    mockRuntimeMessages();
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.resolved).toBe('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('explicit dark overrides system light', async () => {
    mockMatchMedia(false);
    mockRuntimeMessages();
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('dark'));
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storage.setThemePref).toHaveBeenCalledWith('dark');
  });

  it('explicit light wins over system dark', async () => {
    mockMatchMedia(true);
    mockRuntimeMessages();
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('light'));
    expect(result.current.resolved).toBe('light');
  });

  it('rolls back pref when persist rejects (state/storage divergence guard)', async () => {
    mockMatchMedia(false);
    mockRuntimeMessages();
    vi.mocked(storage.setThemePref).mockRejectedValueOnce(new Error('quota'));
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    await act(async () => {
      result.current.setPref('dark');
      await Promise.resolve();
    });
    // persist 失败 -> 回滚到 auto，resolved 跟随回到 light
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    expect(result.current.resolved).toBe('light');
  });

  it('onChanged cross-tab: a valid remote themePref syncs pref + resolved + data-theme', async () => {
    mockMatchMedia(false); // 系统亮
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    expect(result.current.resolved).toBe('light');

    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'themePref', value: 'dark' });
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('dark'));
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('onChanged ignores unknown newValue (validation branch)', async () => {
    mockMatchMedia(false);
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseTheme();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'themePref', value: 'neon' });
    });
    expect(result.current.pref).toBe('auto');
    expect(result.current.resolved).toBe('light');
  });
});
