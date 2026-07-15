import { getEngine } from './engines/registry';
import type { EngineId } from './engines/types';
import type { EngineExtractionResult } from './engines/extractors';

export type EngineSearchRequest = { query: string; engineId: EngineId; maxResults?: number };
export type EngineExtractionReply = EngineExtractionResult & { requestId: string };

type TabsApi = {
  create(createProperties: { url: string; active: boolean }): Promise<{ id?: number; status?: string }>;
  get(tabId: number): Promise<{ id?: number; status?: string }>;
  remove(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: object): Promise<unknown>;
  onUpdated: {
    addListener(listener: (tabId: number, change: { status?: string }) => void): void;
    removeListener(listener: (tabId: number, change: { status?: string }) => void): void;
  };
};
export type EngineSearchDeps = { tabs: TabsApi; requestId?: () => string; readyRetries?: number; retryDelayMs?: number; completeTimeoutMs?: number };

const READY_RETRIES = 8;
const RETRY_DELAY_MS = 100;
const COMPLETE_TIMEOUT_MS = 10_000;

export async function runEngineSearch(request: EngineSearchRequest, signal: AbortSignal | undefined, deps: EngineSearchDeps): Promise<EngineExtractionResult> {
  const requestId = deps.requestId?.() ?? crypto.randomUUID();
  let tabId: number | undefined;
  try {
    const tab = await deps.tabs.create({ url: getEngine(request.engineId).buildSerpUrl(request.query), active: false });
    if (tab.id === undefined) return extractionError(request);
    tabId = tab.id;
    await waitForComplete(tab, deps.tabs, signal, deps.completeTimeoutMs ?? COMPLETE_TIMEOUT_MS);
    const reply = await sendWithRetry(tabId, { type: 'juso:extract-engine-results', requestId, ...request }, deps, signal);
    return isExtractionReply(reply, request, requestId) ? stripRequestId(reply) : extractionError(request);
  } catch {
    return extractionError(request);
  } finally {
    if (tabId !== undefined) void deps.tabs.remove(tabId).catch(() => undefined);
  }
}

function waitForComplete(tab: { id?: number; status?: string }, tabs: TabsApi, signal?: AbortSignal, timeoutMs = COMPLETE_TIMEOUT_MS): Promise<void> {
  if (tab.status === 'complete') return Promise.resolve();
  if (tab.id === undefined) return Promise.reject(new Error('tab id unavailable'));
  const tabId = tab.id;
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); tabs.onUpdated.removeListener(onUpdated); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const onTimeout = () => { cleanup(); reject(new Error('tab did not finish loading')); };
    const onUpdated = (updatedTabId: number, change: { status?: string }) => {
      if (updatedTabId === tabId && change.status === 'complete') { cleanup(); resolve(); }
    };
    tabs.onUpdated.addListener(onUpdated);
    const timeout = setTimeout(onTimeout, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    void tabs.get(tabId).then((currentTab) => {
      if (currentTab.status === 'complete') { cleanup(); resolve(); }
    }).catch(onTimeout);
  });
}

async function sendWithRetry(tabId: number, message: object, deps: EngineSearchDeps, signal?: AbortSignal): Promise<unknown> {
  const retries = deps.readyRetries ?? READY_RETRIES;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try { return await deps.tabs.sendMessage(tabId, message); } catch (error) {
      if (attempt === retries - 1) throw error;
      await delay(deps.retryDelayMs ?? RETRY_DELAY_MS, signal);
    }
  }
  throw new Error('content script unavailable');
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isExtractionReply(value: unknown, request: EngineSearchRequest, requestId: string): value is EngineExtractionReply {
  if (!isRecord(value) || value.requestId !== requestId || value.engine !== request.engineId || value.query !== request.query) return false;
  const keys = Object.keys(value);
  if ('results' in value) return keys.length === 4 && Array.isArray(value.results) && value.results.every(isResult);
  return keys.length === 4 && ['challenge', 'consent', 'unsupported-layout', 'no-results'].includes(value.error as string);
}

function isResult(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 3 && typeof value.title === 'string' && typeof value.url === 'string' && typeof value.snippet === 'string';
}

function stripRequestId(reply: EngineExtractionReply): EngineExtractionResult {
  if ('results' in reply) return { engine: reply.engine, query: reply.query, results: reply.results };
  return { engine: reply.engine, query: reply.query, error: reply.error };
}

function extractionError(request: EngineSearchRequest): EngineExtractionResult { return { engine: request.engineId, query: request.query, error: 'unsupported-layout' }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
