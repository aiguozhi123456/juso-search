import { getEngine } from './engines/registry';
import type { EngineId } from './engines/types';
import type { EngineExtractionErrorKind, EngineExtractionResult } from './engines/extractors';

export type EngineSearchRequest = { query: string; engineId: EngineId; maxResults?: number };
export type EngineExtractionReply = EngineExtractionResult & { requestId: string };

type TabsApi = {
  create(createProperties: { url: string; active: boolean }): Promise<{ id?: number; status?: string; url?: string }>;
  get(tabId: number): Promise<{ id?: number; status?: string; url?: string }>;
  update?(tabId: number, updateProperties: { active?: boolean }): Promise<unknown>;
  remove(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: object): Promise<unknown>;
  onUpdated: {
    addListener(listener: (tabId: number, change: { status?: string; url?: string }) => void): void;
    removeListener(listener: (tabId: number, change: { status?: string; url?: string }) => void): void;
  };
  onRemoved?: {
    addListener(listener: (tabId: number) => void): void;
    removeListener(listener: (tabId: number) => void): void;
  };
};
export type EngineSearchDeps = {
  tabs: TabsApi;
  requestId?: () => string;
  retryDelayMs?: number;
  /** Total budget covering tab load wait plus extractor handshake retries. */
  completeTimeoutMs?: number;
};

const RETRY_DELAY_MS = 150;
const COMPLETE_TIMEOUT_MS = 30_000;

const PAGE_STATE_ERRORS = new Set<string>(['challenge', 'consent', 'unsupported-layout', 'no-results']);
const ORCHESTRATION_ERRORS = new Set<string>(['tab-closed', 'timeout', 'aborted', 'extract-failed']);

export async function runEngineSearch(request: EngineSearchRequest, signal: AbortSignal | undefined, deps: EngineSearchDeps): Promise<EngineExtractionResult> {
  const requestId = deps.requestId?.() ?? crypto.randomUUID();
  let tabId: number | undefined;
  let closedByUser = false;
  const onRemoved = (removedTabId: number) => {
    if (removedTabId === tabId) closedByUser = true;
  };
  try {
    const tab = await deps.tabs.create({ url: getEngine(request.engineId).buildSerpUrl(request.query), active: false });
    if (tab.id === undefined) return extractionError(request, 'extract-failed');
    tabId = tab.id;
    // Some Chromium builds still focus a newly created background tab; force inactive.
    void deps.tabs.update?.(tabId, { active: false }).catch(() => undefined);
    deps.tabs.onRemoved?.addListener(onRemoved);
    const deadline = Date.now() + (deps.completeTimeoutMs ?? COMPLETE_TIMEOUT_MS);
    await waitForComplete(tab, deps.tabs, signal, deadline);
    if (closedByUser) return extractionError(request, 'tab-closed');
    const reply = await sendWithRetry(tabId, { type: 'juso:extract-engine-results', requestId, ...request }, deps, signal, deadline);
    return isExtractionReply(reply, request, requestId) ? stripRequestId(reply) : extractionError(request, 'extract-failed');
  } catch (error) {
    if (closedByUser) return extractionError(request, 'tab-closed');
    if (isAbortError(error) || signal?.aborted) return extractionError(request, 'aborted');
    if (isTimeoutError(error)) return extractionError(request, 'timeout');
    return extractionError(request, 'extract-failed');
  } finally {
    if (tabId !== undefined) deps.tabs.onRemoved?.removeListener(onRemoved);
    if (tabId !== undefined && !closedByUser) void deps.tabs.remove(tabId).catch(() => undefined);
  }
}

// Without the "tabs" permission (or a matching host permission), Chromium-family browsers
// strip the url field from tabs.get()/tabs.onUpdated results. When the url is unobservable,
// status alone is the only readiness signal; the about:blank race it cannot detect is then
// absorbed by sendWithRetry, which keeps retrying until the extractor answers or the deadline.
function isTabReady(tab: { status?: string; url?: string }): boolean {
  if (tab.status !== 'complete') return false;
  if (!tab.url) return true;
  return !tab.url.startsWith('about:');
}

function waitForComplete(tab: { id?: number; status?: string; url?: string }, tabs: TabsApi, signal: AbortSignal | undefined, deadline: number): Promise<void> {
  // Firefox: tabs.create() resolves before navigation commits — tab is still on about:blank.
  // about:blank has status "complete" with a visible url, so isTabReady still rejects it;
  // when the url is permission-hidden, readiness falls through to the sendWithRetry deadline.
  if (isTabReady(tab)) return Promise.resolve();
  if (tab.id === undefined) return Promise.reject(new Error('tab id unavailable'));
  const tabId = tab.id;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      tabs.onUpdated.removeListener(onUpdated);
      tabs.onRemoved?.removeListener(onTabRemoved);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error('tab did not finish loading'));
    };
    const onTabRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error('tab closed'));
    };
    const onUpdated = (updatedTabId: number, change: { status?: string; url?: string }) => {
      if (updatedTabId !== tabId || change.status !== 'complete') return;
      // Re-read the tab rather than trusting the event payload (url may be filtered).
      void tabs.get(tabId).then((currentTab) => {
        if (isTabReady(currentTab)) {
          cleanup();
          resolve();
        }
      }).catch(() => undefined);
    };
    tabs.onUpdated.addListener(onUpdated);
    tabs.onRemoved?.addListener(onTabRemoved);
    const timeout = setTimeout(onTimeout, Math.max(0, deadline - Date.now()));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    void tabs.get(tabId).then((currentTab) => {
      if (isTabReady(currentTab)) {
        cleanup();
        resolve();
      }
    }).catch(() => {
      cleanup();
      reject(new Error('tab closed'));
    });
  });
}

// Retries the extraction handshake until the content script answers or the shared deadline
// passes. Covers both a slow-injecting content script and the permission-hidden about:blank
// race (no receiver exists on about:blank, so retries continue until the SERP commits).
async function sendWithRetry(tabId: number, message: object, deps: EngineSearchDeps, signal: AbortSignal | undefined, deadline: number): Promise<unknown> {
  const retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await deps.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (Date.now() >= deadline) throw new Error('extractor handshake timeout', { cause: error });
      await delay(retryDelayMs, signal);
    }
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isExtractionReply(value: unknown, request: EngineSearchRequest, requestId: string): value is EngineExtractionReply {
  if (!isRecord(value) || value.requestId !== requestId || value.engine !== request.engineId || value.query !== request.query) return false;
  const keys = Object.keys(value);
  if ('results' in value) return keys.length === 4 && Array.isArray(value.results) && value.results.every(isResult);
  return keys.length === 4 && typeof value.error === 'string' && (PAGE_STATE_ERRORS.has(value.error) || ORCHESTRATION_ERRORS.has(value.error));
}

function isResult(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 3 && typeof value.title === 'string' && typeof value.url === 'string' && typeof value.snippet === 'string';
}

function stripRequestId(reply: EngineExtractionReply): EngineExtractionResult {
  if ('results' in reply) return { engine: reply.engine, query: reply.query, results: reply.results };
  return { engine: reply.engine, query: reply.query, error: reply.error };
}

function extractionError(request: EngineSearchRequest, error: EngineExtractionErrorKind): EngineExtractionResult {
  return { engine: request.engineId, query: request.query, error };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /did not finish loading|timeout/i.test(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
