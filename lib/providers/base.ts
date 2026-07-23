// Provider 适配器工厂：把「传输（transport）+ 归一化（normalize）」组装成统一的 ProviderAdapter。
//
// 标准化收益：新增 provider 只需声明 transport（REST/MCP）+ normalize，无需重复手写
// postJson/mapStatus/throw 样板，也忘不掉错误映射。query/provider 由工厂注入，
// normalize 只关心 provider 私有的响应到 {answer?, results} 的映射。
import type {
  NormalizedAnswer,
  NormalizedResult,
  ProviderAdapter,
  ProviderId,
  ProviderTransport,
} from './types';

/** normalize 的返回：不含 query/provider（由 defineProvider 注入）。 */
export type NormalizedBody = { answer?: NormalizedAnswer; results: NormalizedResult[] };

export interface ProviderDefinition<TRaw> {
  readonly id: ProviderId;
  /** 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  readonly label: string;
  readonly supportsAnswer: boolean;
  /** provider 品牌图标：扩展内相对路径（与 engine favicon 同语义），渲染处用 resolveIconUrl 解析。 */
  readonly favicon: string;
  readonly transport: ProviderTransport<TRaw>;
  /** 把原始响应归一化为 {answer?, results}；query/provider 由工厂注入。
   *  允许抛 ProviderError（如 JSON 解析失败映射为 parse）。 */
  normalize(query: string, data: TRaw): NormalizedBody;
}

/** 把一份 ProviderDefinition 组装成符合统一契约的 ProviderAdapter。 */
export function defineProvider<TRaw>(def: ProviderDefinition<TRaw>): ProviderAdapter {
  return {
    id: def.id,
    label: def.label,
    supportsAnswer: def.supportsAnswer,
    favicon: def.favicon,
    async search(query, opts, apiKey) {
      const raw = await def.transport.send(query, opts, apiKey);
      const body = def.normalize(query, raw);
      return { query, provider: def.id, ...body };
    },
  };
}
