import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '@/lib/useTheme';
import * as storage from '@/lib/storage';

// useTheme 依赖：getThemePref/setThemePref（mock）、browser.storage.onChanged、window.matchMedia
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getThemePref).mockResolvedValue('auto');
  vi.mocked(storage.setThemePref).mockResolvedValue(undefined);
  vi.stubGlobal('browser', {
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
  document.documentElement.removeAttribute('data-theme');
});

describe('useTheme', () => {
  it('resolves auto → light when system is light', async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves auto → dark when system is dark', async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.resolved).toBe('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('explicit dark overrides system light', async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('dark'));
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(storage.setThemePref).toHaveBeenCalledWith('dark');
  });

  it('explicit light wins over system dark', async () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('light'));
    expect(result.current.resolved).toBe('light');
  });
});
