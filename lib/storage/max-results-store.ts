import type { ProviderId } from '../providers/types';
import { MAX_RESULTS_KEY } from './keys';
import { isKnownProvider } from './shared';
import { withSourceMutation } from './source-graph-store';

// providerMaxResults 的读改写串行队列：setProviderMaxResults/clearProviderMaxResults/mergeImport 共用，避免并发写丢失。
// 锁序（instance-crud-cross-queue-lock-order.md）：写方须先取 source 队列（mergeImport/clearKey 均持 source 队列整写本键），再取本队列。
let providerMaxResultsMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 providerMaxResults 的读改写（set / clear / mergeImport），防止并发写覆盖。 */
export function withProviderMaxResultsMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerMaxResultsMutationQueue.then(mutation, mutation);
  providerMaxResultsMutationQueue = run.catch(() => undefined);
  return run;
}

// === 搜索结果条数（per-provider maxResults）===
// 非敏感配置（与 key 不同），但仍走 worker 代理以保持单一配置入口。
// 缺省（未显式设置）由各适配器兜底（REST 适配器 ?? 8，jina ?? 5）。

/** 合法 maxResults 区间：1–20。超出则 clamp。 */
export const MAX_RESULTS_MIN = 1;
export const MAX_RESULTS_MAX = 20;

export function clampMaxResults(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < MAX_RESULTS_MIN) return MAX_RESULTS_MIN;
  if (i > MAX_RESULTS_MAX) return MAX_RESULTS_MAX;
  return i;
}

async function readMaxResultsMap(): Promise<Record<string, number>> {
  const got = await browser.storage.local.get(MAX_RESULTS_KEY);
  return (await readMaxResultsMapFrom(got[MAX_RESULTS_KEY])) as Record<string, number>;
}

/** 返回某 provider 的 maxResults；未配置则 null（由调用方走适配器默认）。 */
export async function getProviderMaxResults(id: ProviderId): Promise<number | null> {
  const map = await readMaxResultsMap();
  return map[id] ?? null;
}

/** 设置某 provider 的 maxResults（clamp 到 1–20）。 */
export async function setProviderMaxResults(id: ProviderId, maxResults: number): Promise<void> {
  const clamped = clampMaxResults(maxResults);
  if (clamped === null) throw new Error('invalid_max_results');
  // 先取 source 队列、再取本队列：mergeImport 持 source 队列整写 MAX_RESULTS_KEY，
  // 仅持本队列无法与导入互斥（与 clearKey 的 source → keys → maxResults 同锁序）。
  await withSourceMutation(() => withProviderMaxResultsMutation(async () => {
    const got = await browser.storage.local.get(MAX_RESULTS_KEY);
    // 写前走同一解析：未知 provider / 非数值不落盘，存储值与读取契约保持一致。
    const map = { ...(await readMaxResultsMapFrom(got[MAX_RESULTS_KEY])) } as Record<string, number>;
    map[id] = clamped;
    await browser.storage.local.set({ [MAX_RESULTS_KEY]: map });
  }));
}

/** 清除某 provider 的 maxResults（恢复适配器默认）。 */
export async function clearProviderMaxResults(id: ProviderId): Promise<void> {
  // 锁序同 setProviderMaxResults：source 队列 → maxResults 队列。
  await withSourceMutation(() => withProviderMaxResultsMutation(async () => {
    const got = await browser.storage.local.get(MAX_RESULTS_KEY);
    const map = { ...(await readMaxResultsMapFrom(got[MAX_RESULTS_KEY])) } as Record<string, number>;
    if (!(id in map)) return; // 本就未设置，no-op
    delete map[id];
    await browser.storage.local.set({ [MAX_RESULTS_KEY]: map });
  }));
}

/** 从已读的 storage 原始值解析 maxResults 映射（避免重复 IO，供 snapshot 复用同一份 get）。 */
export async function readMaxResultsMapFrom(raw: unknown): Promise<Partial<Record<ProviderId, number>>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: Partial<Record<ProviderId, number>> = {};
  for (const [id, n] of Object.entries(map)) {
    if (isKnownProvider(id)) {
      const clamped = clampMaxResults(n);
      if (clamped !== null) out[id as ProviderId] = clamped;
    }
  }
  return out;
}
