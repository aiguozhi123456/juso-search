import type { ProviderId } from './providers/types';
import { ProviderError } from './providers/types';
import type { SearchReply, TestKeyReply } from './messaging';
import { getAdapter } from './providers/registry';
import { getActiveProviderId, getKey } from './storage';
import { t, MSG } from './i18n';

type SearchErrorReply = Extract<SearchReply, { ok: false }>;

/** 搜索：worker 读 key（仅此处）→ 调激活 provider 的适配器 → 返回归一化结果或类型化错误。 */
export async function handleSearch(query: string): Promise<SearchReply> {
  try {
    const providerId = await getActiveProviderId();
    if (!providerId) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_no_provider_key) } };
    }
    const adapter = getAdapter(providerId);
    const key = await getKey(providerId);
    if (!key) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, t(adapter.label)) } };
    }
    const response = await adapter.search(query, {}, key);
    return { ok: true, response };
  } catch (e) {
    return toSearchError(e);
  }
}

/** 设置页"测试 key"：最小查询验证连通性与鉴权。 */
export async function handleTestKey(providerId: ProviderId): Promise<TestKeyReply> {
  try {
    const adapter = getAdapter(providerId);
    const key = await getKey(providerId);
    if (!key) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, t(adapter.label)) } };
    }
    await adapter.search('test', { maxResults: 1 }, key);
    return { ok: true };
  } catch (e) {
    const reply = toSearchError(e);
    return {
      ok: false,
      error: {
        kind: 'providerError',
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
  // 不把原始异常信息透传到页面（避免未来 provider 错误体回显敏感数据）。
  return { ok: false, error: { kind: 'unknown', message: t(MSG.error_service_unavailable) } };
}
