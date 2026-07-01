import { defineExtensionMessaging } from '@webext-core/messaging';
import type { NormalizedSearchResponse, ProviderId } from './providers/types';

// 跨消息用 ok/error 判别联合返回，不抛异常（错误对象跨 message 序列化会丢类信息）。
export type SearchReply =
  | { ok: true; response: NormalizedSearchResponse }
  | {
      ok: false;
      error: {
        kind: 'keyMissing' | 'providerError' | 'unknown';
        message: string;
        providerErrorKind?: string;
      };
    };

export type TestKeyReply =
  | { ok: true }
  | { ok: false; error: { kind: 'keyMissing' | 'providerError'; message: string } };

export type ProtocolMap = {
  search(query: string): Promise<SearchReply>;
  testKey(providerId: ProviderId): Promise<TestKeyReply>;
};

const messaging = defineExtensionMessaging<ProtocolMap>();
export const { sendMessage, onMessage } = messaging;
