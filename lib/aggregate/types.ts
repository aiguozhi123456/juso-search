// 聚合搜索响应模型（aggregate-search-rerank plan KTD2）。
//
// 与 NormalizedSearchResponse 平行的第二种响应形态：一次聚合搜索 = 多成员扇出 →
// 去重合并 → 外部 rerank 重排。字段逐项对应 plan KTD2，消费方（缓存 slim、历史回放、
// 聚合视图渲染）以此为准。
//
// ⚠️ rerank 文档构造恒为 title + '\n' + snippet(截 512)——不用 content：
// 缓存 slim 白名单不含 content，用 content 会让排序随缓存命中状态漂移
// （构造函数 buildRerankDocument 在 lib/aggregate/merge.ts）。

import type { EngineId } from '../engines/types';
import type { NormalizedAnswer, NormalizedResult, ProviderId } from '../providers/types';
import type { AggregateInstance } from '../aggregate-instances';
import type { ProviderInstanceId } from '../provider-instances';

/** 聚合实例 id：`agg:<token>`（token 规则与 inst:/site: 同族，guard 见 lib/aggregate-instances.ts）。
 *  只进 SourceId 语义域，绝不进 ProviderId（聚合成员可引用 provider 实例，agg id 本身永不到达 getAdapter/getKey）。 */
export type AggregateInstanceId = `agg:${string}`;

/** 聚合成员：已配置 provider（裸 id）、provider 实例、或带 extractor 的传统 engine。 */
export type AggregateMemberId = ProviderId | ProviderInstanceId | EngineId;

/** 单条合并结果的 provenance：该 URL 归一后由哪些成员命中（多源多徽标，R5）。 */
export type AggregateMergedResult = NormalizedResult & { sources: AggregateMemberId[] };

/** 聚合答案条目：全部成功成员的综合答案按成员序罗列（R4：不做取舍）。 */
export interface AggregateAnswerEntry {
  sourceId: AggregateMemberId;
  answer: NormalizedAnswer;
}

/** per-member 执行状态（R6：透明；engine 成员恒为实时抽取，cached 恒缺省）。 */
export interface AggregateMemberStatus {
  sourceId: AggregateMemberId;
  ok: boolean;
  cached?: boolean;
  resultCount?: number;
  errorKind?: string;
  errorMessage?: string;
}

/** rerank 元信息（R13 meta 条 + 历史回放保真）。 */
export interface AggregateRerankMeta {
  model?: string;
  rerankedAt: number;
}

/** 聚合搜索统一响应（KTD2）。instanceId 入响应供历史回放 gate 与 label 解析。 */
export interface AggregateSearchResponse {
  instanceId: AggregateInstanceId;
  query: string;
  kind: 'aggregate';
  answers: AggregateAnswerEntry[];
  results: AggregateMergedResult[];
  members: AggregateMemberStatus[];
  /** URL 归一去重并入首现条目的条数（R13 meta 条「去重 D 条」）：merge 输出（mergeAggregateMembers）
   *  的 dedupedCount 直传，slim 白名单携带，历史回放 meta 条保真（Lane D 定义的字段位置）。 */
  dedupedCount: number;
  rerank: AggregateRerankMeta;
}

/** rerank 协议判别：`'cohere'` = Cohere/Jina 风格 `/v1/rerank`（缺省，兼容旧数据）；`'jev'` = TypeSafe
 *  SystemOne 决策模型协议（listwise state+questions → answers.noul）。缺省即 cohere，旧存储/旧导出零迁移。 */
export type RerankProtocol = 'cohere' | 'jev';

/** 全局唯一的 rerank 服务配置（KTD10/R3）：endpoint 白名单校验（KTD12，Lane B 接线）。
 *  apiKey 明文随导出文件（与 providerKeys 同设计），仅 worker 读；任何返回值/纯函数输出不得携带。 */
export interface RerankConfig {
  endpoint: string;
  model?: string;
  apiKey?: string;
  protocol?: RerankProtocol;
}

/** 快照侧脱敏聚合配置（KTD5）：`ProviderConfigReply.aggregate` 的形状。
 *  ⚠️ **永不携带 apiKey**——rerank 只暴露 configured/endpoint/model 三个脱敏字段，
 *  页面代码凭此投影聚合 pill 与渲染配置面，绝不直读 rerankConfig 存储键。 */
export interface AggregateConfigSnapshot {
  /** 全部已定义实例（与 eligibility 无关的完整定义集）。 */
  instances: AggregateInstance[];
  /** per-instance eligibility（KTD5，快照单点计算；validMembers 收敛为数量）。 */
  eligibility: Record<AggregateInstanceId, { eligible: boolean; validMembers: number }>;
  /** rerank 配置状态（脱敏）：configured = endpoint 已配置；hasApiKey = 已存 apiKey（脱敏
   *  布尔标志，**永不回显值**——provider-instance-multi-config-model.md 快照脱敏先例的
   *  hasApiKey 类字段）。AggregateSearchManager 的「已配置」态由本字段驱动（跨会话准确：
   *  保存/清除后经 syncConfig 快照回流，页面不再维护会话内本地投影）。 */
  rerank: { configured: boolean; hasApiKey: boolean; endpoint?: string; model?: string; protocol?: RerankProtocol };
}
