import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBarPosition } from '@/lib/useBarPosition';
import * as storage from '@/lib/storage';

// useBarPosition 依赖：getBarPositionPref/setBarPositionPref（mock）+ browser.runtime.onMessage。
// 镜像 tests/style.test.tsx 的隔离模式。
vi.mock('@/lib/storage', () => ({
  getBarPositionPref: vi.fn(),
  setBarPositionPref: vi.fn(),
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
  vi.mocked(storage.getBarPositionPref).mockResolvedValue('auto');
  vi.mocked(storage.setBarPositionPref).mockResolvedValue(undefined);
});

async function renderUseBarPosition() {
  const rendered = renderHook(() => useBarPosition());
  await act(async () => {
    await Promise.resolve();
  });
  return rendered;
}

describe('useBarPosition', () => {
  it('defaults to auto when storage is empty', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.getBarPositionPref).mockResolvedValue('auto');
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
  });

  it('reads bottom from storage', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.getBarPositionPref).mockResolvedValue('bottom');
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('bottom'));
  });

  it('reads inline from storage', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.getBarPositionPref).mockResolvedValue('inline');
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('inline'));
  });

  it('setPref writes storage and updates pref optimistically', async () => {
    mockRuntimeMessages();
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('bottom'));
    expect(result.current.pref).toBe('bottom');
    expect(storage.setBarPositionPref).toHaveBeenCalledWith('bottom');
  });

  it('setPref writes storage and updates pref optimistically for inline', async () => {
    mockRuntimeMessages();
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => result.current.setPref('inline'));
    expect(result.current.pref).toBe('inline');
    expect(storage.setBarPositionPref).toHaveBeenCalledWith('inline');
  });

  it('rolls back pref when persist rejects', async () => {
    mockRuntimeMessages();
    vi.mocked(storage.setBarPositionPref).mockRejectedValueOnce(new Error('quota'));
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    await act(async () => {
      result.current.setPref('bottom');
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
  });

  it('onChanged cross-tab: a valid remote serpBarPosition syncs pref', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'serpBarPosition', value: 'bottom' });
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('bottom'));
  });

  it('onChanged cross-tab: a valid remote inline serpBarPosition syncs pref', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'serpBarPosition', value: 'inline' });
    });
    await vi.waitFor(() => expect(result.current.pref).toBe('inline'));
  });

  it('onChanged ignores unknown newValue (validation branch)', async () => {
    const listeners = mockRuntimeMessages();
    const { result } = await renderUseBarPosition();
    await vi.waitFor(() => expect(result.current.pref).toBe('auto'));
    act(() => {
      for (const l of listeners) l({ type: 'uiPrefChanged', key: 'serpBarPosition', value: 'side' });
    });
    expect(result.current.pref).toBe('auto');
  });
});
