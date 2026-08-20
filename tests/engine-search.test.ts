import { describe, expect, it, vi } from 'vitest';
import { runEngineSearch } from '@/lib/engine-search';

function tabs(status: 'loading' | 'complete' = 'complete', url = 'https://www.google.com/search?q=hello') {
  const updated = new Set<(tabId: number, change: { status?: string; url?: string }) => void>();
  const removed = new Set<(tabId: number) => void>();
  const getMock = vi.fn().mockResolvedValue({ id: 7, status, url });
  return {
    create: vi.fn().mockResolvedValue({ id: 7, status, url }),
    get: getMock,
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    onUpdated: {
      addListener: vi.fn((listener: (tabId: number, change: { status?: string; url?: string }) => void) => updated.add(listener)),
      removeListener: vi.fn((listener: (tabId: number, change: { status?: string; url?: string }) => void) => updated.delete(listener)),
    },
    onRemoved: {
      addListener: vi.fn((listener: (tabId: number) => void) => removed.add(listener)),
      removeListener: vi.fn((listener: (tabId: number) => void) => removed.delete(listener)),
    },
    emitUpdated(tabId: number, change: { status?: string; url?: string }) {
      if (tabId === 7 && change.status) getMock.mockResolvedValue({ id: 7, status: change.status, url });
      updated.forEach((listener) => listener(tabId, change));
    },
    emitRemoved(tabId: number) {
      removed.forEach((listener) => listener(tabId));
    },
  };
}

describe('runEngineSearch', () => {
  it('creates an inactive engine URL tab and returns a validated reply', async () => {
    const api = tabs();
    api.sendMessage.mockResolvedValue({ requestId: 'id', engine: 'google', query: 'hello', results: [] });
    await expect(runEngineSearch({ engineId: 'google', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id' })).resolves.toEqual({ engine: 'google', query: 'hello', results: [] });
    expect(api.create).toHaveBeenCalledWith({ url: 'https://www.google.com/search?q=hello', active: false });
    expect(api.update).toHaveBeenCalledWith(7, { active: false });
    expect(api.remove).toHaveBeenCalledWith(7);
  });

  it('ignores other tab updates, retries unavailable receivers, and removes only its tab', async () => {
    const api = tabs('loading', 'https://www.bing.com/search?q=hello');
    api.sendMessage.mockRejectedValueOnce(new Error('receiving end does not exist')).mockResolvedValue({ requestId: 'id', engine: 'bing', query: 'hello', error: 'no-results' });
    const promise = runEngineSearch({ engineId: 'bing', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id', retryDelayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.emitUpdated(8, { status: 'complete' });
    expect(api.sendMessage).not.toHaveBeenCalled();
    api.emitUpdated(7, { status: 'complete' });
    await expect(promise).resolves.toEqual({ engine: 'bing', query: 'hello', error: 'no-results' });
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.remove).toHaveBeenCalledWith(7);
  });

  it('reports aborted and malformed replies distinctly from page-layout errors', async () => {
    const controller = new AbortController();
    const api = tabs('loading', 'https://www.baidu.com/s?wd=hello');
    const pending = runEngineSearch({ engineId: 'baidu', query: 'hello' }, controller.signal, { tabs: api, requestId: () => 'id' });
    controller.abort();
    await expect(pending).resolves.toEqual({ engine: 'baidu', query: 'hello', error: 'aborted' });
    const invalidApi = tabs('complete', 'https://www.baidu.com/s?wd=hello');
    invalidApi.sendMessage.mockResolvedValue({ requestId: 'wrong', engine: 'baidu', query: 'hello', error: 'no-results' });
    await expect(runEngineSearch({ engineId: 'baidu', query: 'hello' }, undefined, { tabs: invalidApi, requestId: () => 'id' })).resolves.toEqual({ engine: 'baidu', query: 'hello', error: 'extract-failed' });
  });

  it('reports tab-closed when the temporary SERP tab is removed early', async () => {
    const api = tabs('loading');
    const promise = runEngineSearch({ engineId: 'google', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.emitRemoved(7);
    await expect(promise).resolves.toEqual({ engine: 'google', query: 'hello', error: 'tab-closed' });
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('rechecks tab status after registering the completion listener', async () => {
    const api = tabs('loading');
    api.get.mockResolvedValue({ id: 7, status: 'complete', url: 'https://www.google.com/search?q=hello' });
    api.sendMessage.mockResolvedValue({ requestId: 'id', engine: 'google', query: 'hello', results: [] });
    await expect(runEngineSearch({ engineId: 'google', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id' })).resolves.toEqual({ engine: 'google', query: 'hello', results: [] });
    expect(api.remove).toHaveBeenCalledWith(7);
  });

  it('converts tab creation failures to extract-failed', async () => {
    const api = tabs();
    api.create.mockRejectedValue(new Error('blocked'));
    await expect(runEngineSearch({ engineId: 'google', query: 'hello' }, undefined, { tabs: api })).resolves.toEqual({ engine: 'google', query: 'hello', error: 'extract-failed' });
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('treats a permission-hidden url as ready once status completes and retries until the receiver appears', async () => {
    // Vivaldi/Chrome without "tabs" permission strip url from tabs.get()/onUpdated.
    const api = tabs('loading', undefined);
    api.sendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValue({ requestId: 'id', engine: 'bing', query: 'hello', results: [] });
    const promise = runEngineSearch({ engineId: 'bing', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id', retryDelayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.emitUpdated(7, { status: 'complete' });
    await expect(promise).resolves.toEqual({ engine: 'bing', query: 'hello', results: [] });
    expect(api.sendMessage).toHaveBeenCalledTimes(3);
    expect(api.remove).toHaveBeenCalledWith(7);
  });

  it('reports timeout when the receiver never appears within the remaining budget (about:blank race)', async () => {
    const api = tabs('complete', undefined);
    api.sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    await expect(runEngineSearch({ engineId: 'google', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id', retryDelayMs: 0, completeTimeoutMs: 40 })).resolves.toEqual({ engine: 'google', query: 'hello', error: 'timeout' });
    expect(api.remove).toHaveBeenCalledWith(7);
  });

  it('still rejects an about:blank tab whose url is visible (Firefox race guard)', async () => {
    const api = tabs('complete', 'about:blank');
    api.get.mockResolvedValue({ id: 7, status: 'complete', url: 'about:blank' });
    await expect(runEngineSearch({ engineId: 'google', query: 'hello' }, undefined, { tabs: api, requestId: () => 'id', completeTimeoutMs: 30 })).resolves.toEqual({ engine: 'google', query: 'hello', error: 'timeout' });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
