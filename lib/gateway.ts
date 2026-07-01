import type { ProviderId } from './providers/types';
import { ProviderError } from './providers/types';
import type { SearchReply, TestKeyReply } from './messaging';
import { getAdapter } from './providers/registry';
import { getActiveProviderId, getKey } from './storage';

type SearchErrorReply = Extract<SearchReply, { ok: false }>;

/** 搜索：worker 读 key（仅此处）→ 调激活 provider 的适配器 → 返回归一化结果或类型化错误。 */
export async function handleSearch(query: string): Promise<SearchReply> {
  const providerId = await getActiveProviderId();
  if (!providerId) {
    return { ok: false, error: { kind: 'keyMissing', message: '尚未配置任何 provider 的 API key' } };
  }
  const adapter = getAdapter(providerId);
  const key = await getKey(providerId);
  if (!key) {
    return { ok: false, error: { kind: 'keyMissing', message: `${adapter.label}：尚未配置 API key` } };
  }
  try {
    const response = await adapter.search(query, {}, key);
    return { ok: true, response };
  } catch (e) {
    return toSearchError(e);
  }
}

/** 设置页"测试 key"：最小查询验证连通性与鉴权。 */
export async function handleTestKey(providerId: ProviderId): Promise<TestKeyReply> {
  const adapter = getAdapter(providerId);
  const key = await getKey(providerId);
  if (!key) {
    return { ok: false, error: { kind: 'keyMissing', message: `${adapter.label}：尚未配置 API key` } };
  }
  try {
    await adapter.search('test', { maxResults: 1 }, key);
    return { ok: true };
  } catch (e) {
    const reply = toSearchError(e);
    return {
      ok: false,
      error: {
        kind: reply.error.kind === 'keyMissing' ? 'keyMissing' : 'providerError',
        message: reply.error.message,
      },
    };
  }
}

function toSearchError(e: unknown): SearchErrorReply {
  if (e instanceof ProviderError) {
    return {
      ok: false,
      error: { kind: 'providerError', message: e.message, providerErrorKind: e.kind },
    };
  }
  return { ok: false, error: { kind: 'unknown', message: (e as Error)?.message ?? '未知错误' } };
}
