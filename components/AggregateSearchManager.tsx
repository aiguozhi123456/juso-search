import { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import type { EngineId } from '@/lib/engines/types';
import { getEngine } from '@/lib/engines/registry';
import { extractorCapableEngineIds, resolveAggregateEligibility } from '@/lib/aggregate/eligibility';
import type { AggregateConfigSnapshot, AggregateInstanceId, AggregateMemberId, RerankProtocol } from '@/lib/aggregate/types';
import type { AggregateInstance } from '@/lib/aggregate-instances';
import {
  clampAggregateTopN,
  DEFAULT_AGGREGATE_TOP_N,
  MAX_AGGREGATE_INSTANCE_NAME_LENGTH,
  MAX_AGGREGATE_INSTANCES,
  MAX_AGGREGATE_TOP_N,
  MIN_AGGREGATE_TOP_N,
} from '@/lib/aggregate-instances';
import { isProviderInstanceId, type ProviderInstance } from '@/lib/provider-instances';
import { validateRerankEndpoint } from '@/lib/aggregate/rerank-client';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import { MinusIcon, PlusIcon } from './icons';

/**
 * 聚合搜索与重排配置面（aggregate-search-rerank plan R12 全量契约）。
 *
 * 骨架抄 SiteInstanceManager / ProviderInstanceManager 母本（onChange={syncConfig} 上抛、
 * 两步删除确认、容量提示先例）。数据源 = worker 快照 `config.aggregate`（KTD5 脱敏形状：
 * instances + eligibility + rerank{configured,endpoint,model,protocol}），**快照永不携带 apiKey**。
 *
 * 三卡：rerank 全局卡（协议下拉 cohere|jev + endpoint 白名单校验 + localhost/[::1] 改写提示 AE8 /
 * apiKey password 型不回显；jev 协议的 endpoint placeholder/hint/model placeholder 随下拉切换）/
 * 实例列表卡（成员摘要 + topN 徽标 + 有效性警示 + 两步删除，无独苗禁用 AE9）/
 * inline 编辑器（create/edit 共用：空白起步、两节平铺成员清单、topN 5–20、≥1 有效成员才可保存）。
 *
 * 编辑器契约（edit-mode-base-provider-switch / enum-timerange 两篇教训）：draft↔保存全字段
 * round-trip——edit 态 id 隐形不可改（无身份字段渲染）；topN 界内值原样透传（保存前才钳位）；
 * 成员清单保存时按「两节清单显示序」规范化排序（勾选顺序无关、重开再存稳定），清单外的
 * 漂移成员（registry/实例定义变化导致不再显示）按原序保留在前，绝不静默丢弃（Oracle F6：
 * 语义有效性只在 eligibility 判定，UI 不因漂移改写成员语义）。
 */

type InstanceStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'fail'; message: string };

type RerankStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'testing' }
  | { kind: 'ok'; message: string }
  | { kind: 'fail'; message: string };

type EditorState =
  | { mode: 'create'; editId?: never; name: string; members: AggregateMemberId[]; topNStr: string }
  | { mode: 'edit'; editId: AggregateInstanceId; name: string; members: AggregateMemberId[]; topNStr: string };

/** 两节清单中的一行可勾选成员。 */
interface MemberRow {
  id: AggregateMemberId;
  /** 已解析显示名（engine/provider → i18n label；provider 实例 → 「Provider · 实例名」）。 */
  label: string;
}

/** API 节的分组：provider（无实例 → 裸行一条；有实例 → 逐实例子行，不投影裸行——镜像 allSources 投影规则）。 */
interface ApiMemberGroup {
  providerId: ProviderId;
  label: string;
  rows: MemberRow[];
}

const MEMBER_SUMMARY_PREVIEW = 3;

function parseTopNStr(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return DEFAULT_AGGREGATE_TOP_N;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_AGGREGATE_TOP_N;
}

export function AggregateSearchManager({
  aggregate,
  configuredProviderIds,
  providerInstances,
  onChange,
}: {
  /** worker 快照的脱敏聚合字段（KTD5）；老 worker / 字段缺失时按「空快照」降级渲染。 */
  aggregate?: AggregateConfigSnapshot | null;
  configuredProviderIds: readonly ProviderId[];
  providerInstances: readonly ProviderInstance[];
  /** 与 SiteInstanceManager.onChange 同构：任何写操作成功后由父级 syncConfig() 重新拉快照。 */
  onChange: () => void;
}) {
  const instances = aggregate?.instances ?? [];
  const eligibility = aggregate?.eligibility ?? {};
  const rerankConfigured = aggregate?.rerank.configured ?? false;
  const snapshotEndpoint = aggregate?.rerank.endpoint ?? '';
  const snapshotModel = aggregate?.rerank.model ?? '';
  // 快照只在 'jev' 时携带 protocol（normalizeRerankConfig 剥掉缺省 cohere）；缺省即 cohere。
  const snapshotProtocol: RerankProtocol = aggregate?.rerank.protocol ?? 'cohere';

  // === rerank 全局卡 state ===
  const [endpointStr, setEndpointStr] = useState(snapshotEndpoint);
  const [modelStr, setModelStr] = useState(snapshotModel);
  const [protocolStr, setProtocolStr] = useState<RerankProtocol>(snapshotProtocol);
  const [apiKeyStr, setApiKeyStr] = useState('');
  // 快照永不携带 apiKey（KTD5）——「已配置」态由快照脱敏布尔 hasApiKey 驱动（快照脱敏先例：
  // provider-instance-multi-config-model.md 的 hasApiKey 类字段）。跨会话准确：保存/清除成功后
  // onChange → syncConfig 快照回流翻转本态；页面重载后同样直接从快照恢复，无会话内本地投影。
  const apiKeySet = aggregate?.rerank.hasApiKey ?? false;
  const [rerankStatus, setRerankStatus] = useState<RerankStatus>({ kind: 'idle' });
  const lastSnapshotRef = useRef({ endpoint: snapshotEndpoint, model: snapshotModel, protocol: snapshotProtocol });
  // 快照回流（保存后 syncConfig / 配置导入）时回填 endpoint/model/protocol 非敏感输入；仅当快照值
  // 真的变了才覆盖，避免无关 sync 打断用户正在编辑的内容。
  useEffect(() => {
    if (lastSnapshotRef.current.endpoint !== snapshotEndpoint) {
      lastSnapshotRef.current.endpoint = snapshotEndpoint;
      setEndpointStr(snapshotEndpoint);
    }
    if (lastSnapshotRef.current.model !== snapshotModel) {
      lastSnapshotRef.current.model = snapshotModel;
      setModelStr(snapshotModel);
    }
    if (lastSnapshotRef.current.protocol !== snapshotProtocol) {
      lastSnapshotRef.current.protocol = snapshotProtocol;
      setProtocolStr(snapshotProtocol);
    }
  }, [snapshotEndpoint, snapshotModel, snapshotProtocol]);

  // === 实例管理 state ===
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<AggregateInstanceId | null>(null);
  const [status, setStatus] = useState<InstanceStatus>({ kind: 'idle' });

  const rerankBusy = rerankStatus.kind === 'saving' || rerankStatus.kind === 'testing';
  const busy = status.kind === 'busy';
  const atCapacity = instances.length >= MAX_AGGREGATE_INSTANCES;

  // === 成员清单（两节平铺；全部从 registry/快照派生，不手写）===
  const instancesByProvider = new Map<ProviderId, ProviderInstance[]>();
  for (const instance of providerInstances) {
    const list = instancesByProvider.get(instance.baseProviderId);
    if (list) list.push(instance);
    else instancesByProvider.set(instance.baseProviderId, [instance]);
  }
  const providersById = new Map(allProviders().map((provider) => [provider.id, provider]));
  // 「API 搜索」节：已配置 providers（registry 序）；有实例的 provider 展开为「Provider · 实例名」子行。
  const apiGroups: ApiMemberGroup[] = configuredProviderIds
    .map((id) => providersById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((provider) => ({
      providerId: provider.id,
      label: t(provider.label),
      rows: (instancesByProvider.get(provider.id) ?? []).map((instance) => ({
        id: instance.id,
        label: `${t(provider.label)} · ${instance.name}`,
      })),
    }));
  // 「传统引擎」节：仅带 extractor 的 engine，从 extractor registry 派生（R9/KTD15③，engine-capability 分层教训）。
  const engineRows: MemberRow[] = extractorCapableEngineIds().map((id) => ({ id, label: t(getEngine(id).label) }));
  const engineIdSet = new Set<string>(engineRows.map((row) => row.id));
  const instancesById = new Map(providerInstances.map((instance) => [instance.id, instance]));

  /**
   * 草稿成员的有效性计数：直接复用 worker 侧共享纯函数 resolveAggregateEligibility
   * （同 engine-set / instance-map / configured-provider 判定），UI 计数与实际 eligibility 永不漂移。
   * isRerankConfigured 只查 endpoint 非空，脱敏快照的 endpoint 足以构成 RerankConfig 形状；
   * validMembers 不依赖 rerank，快照未配置（endpoint=''）时同样可计数。
   */
  function draftEligibilityOf(members: readonly AggregateMemberId[]) {
    return resolveAggregateEligibility(
      { members: [...members] },
      {
        configuredProviderIds,
        providerInstances,
        rerankConfig: snapshotEndpoint ? { endpoint: snapshotEndpoint } : null,
      },
    );
  }

  /** 成员显示名（实例列表卡摘要用）：provider 实例 → 「Provider · 实例名」；provider → label；engine → label；未知 → 原 id。 */
  function memberLabel(member: AggregateMemberId): string {
    if (isProviderInstanceId(member)) {
      const providerInstance = instancesById.get(member);
      if (providerInstance) {
        const provider = providersById.get(providerInstance.baseProviderId);
        return `${provider ? t(provider.label) : providerInstance.baseProviderId} · ${providerInstance.name}`;
      }
      return member;
    }
    const provider = providersById.get(member as ProviderId);
    if (provider) return t(provider.label);
    if (engineIdSet.has(member)) return t(getEngine(member as EngineId).label);
    return member;
  }

  /**
   * 保存时的成员清单规范化排序（成员顺序无关 / 重开再存稳定）：
   * 清单外漂移成员按原序保留在前，其余按「两节清单显示序」（API 节在引擎节之前）排列。
   */
  function canonicalMembers(members: readonly AggregateMemberId[]): AggregateMemberId[] {
    const checklistOrder = [
      ...apiGroups.flatMap((group) => group.rows.map((row) => row.id)),
      ...engineRows.map((row) => row.id),
    ];
    const orderIndex = new Map(checklistOrder.map((id, index) => [id, index]));
    const stale = members.filter((member) => !orderIndex.has(member));
    const listed = members
      .filter((member) => orderIndex.has(member))
      .sort((a, b) => (orderIndex.get(a) as number) - (orderIndex.get(b) as number));
    return [...stale, ...listed];
  }

  // === rerank 全局卡动作 ===

  /** 保存（AE8/KTD12）：先本地 validateRerankEndpoint（与 worker 同校验）拒绝非法输入；
   *  合法则原样交 worker（worker 规范化 + 改写），凭 reply.rewritten 提示已改写并回填规范化值。
   *  apiKey 输入留空 = 不携带（保留已存值）；非空才携带（保存后即清输入，绝不回显）。 */
  async function saveRerank() {
    if (rerankBusy) return;
    const rawEndpoint = endpointStr.trim();
    const validation = validateRerankEndpoint(rawEndpoint);
    if (!validation.ok) {
      setRerankStatus({ kind: 'fail', message: t(MSG.error_rerank_endpoint_invalid) });
      return;
    }
    setRerankStatus({ kind: 'saving' });
    try {
      const trimmedModel = modelStr.trim();
      const reply = await sendMessage('setRerankConfig', {
        endpoint: rawEndpoint,
        ...(trimmedModel ? { model: trimmedModel } : {}),
        ...(apiKeyStr ? { apiKey: apiKeyStr } : {}),
        // protocol 全写语义同 model（normalizeRerankConfig 只认 'jev'）：不携带 = 回到 cohere 缺省。
        ...(protocolStr === 'jev' ? { protocol: 'jev' as const } : {}),
      });
      if (reply.ok) {
        setEndpointStr(reply.endpoint);
        setApiKeyStr('');
        setRerankStatus({
          kind: 'ok',
          message: reply.rewritten ? t(MSG.opts_rerank_endpoint_rewritten) : t(MSG.status_saved),
        });
        onChange();
      } else {
        setRerankStatus({ kind: 'fail', message: reply.error.message });
      }
    } catch {
      setRerankStatus({ kind: 'fail', message: t(MSG.status_save_failed) });
    }
  }

  /** 清除已存 apiKey（Oracle #5）：带 apiKey:'' 重发**快照已存** endpoint/model——仅清 key，
   *  绝不顺带持久化输入框里未保存的脏草稿（测试按钮有脏值守卫，清除对齐同款语义；
   *  normalizeRerankConfig 丢弃空串）。 */
  async function clearApiKey() {
    if (rerankBusy) return;
    const validation = validateRerankEndpoint(snapshotEndpoint);
    if (!validation.ok) {
      setRerankStatus({ kind: 'fail', message: t(MSG.error_rerank_endpoint_invalid) });
      return;
    }
    setRerankStatus({ kind: 'saving' });
    try {
      const reply = await sendMessage('setRerankConfig', {
        endpoint: validation.endpoint,
        ...(snapshotModel ? { model: snapshotModel } : {}),
        // protocol 与 model 同为全写语义：清除 key 的重发必须带上快照 protocol，否则会被剥成 cohere。
        ...(snapshotProtocol === 'jev' ? { protocol: 'jev' as const } : {}),
        apiKey: '',
      });
      if (reply.ok) {
        setRerankStatus({ kind: 'ok', message: t(MSG.opts_aggregate_rerank_api_key_cleared) });
        onChange();
      } else {
        // setRerankConfig 是 ok/error 判别联合（worker 侧返回而非抛出）：失败必须按
        // 失败渲染，不能落到「已清除」的假成功。
        setRerankStatus({ kind: 'fail', message: reply.error.message });
      }
    } catch {
      setRerankStatus({ kind: 'fail', message: t(MSG.status_save_failed) });
    }
  }

  /** 测试连接（KTD6 分型显示）：worker 对**已存储**配置发真实 mini 请求（镜像 provider key：
   *  输入框与已存 endpoint 不一致时禁用，先保存再测试）。 */
  async function testRerankConnection() {
    if (rerankBusy) return;
    setRerankStatus({ kind: 'testing' });
    try {
      const reply = await sendMessage('testRerank', undefined);
      if (reply.ok) {
        setRerankStatus({ kind: 'ok', message: t(MSG.opts_aggregate_rerank_test_ok) });
      } else if (reply.error.kind === 'keyMissing') {
        setRerankStatus({ kind: 'fail', message: t(MSG.error_rerank_not_configured) });
      } else {
        setRerankStatus({ kind: 'fail', message: t(MSG.opts_aggregate_rerank_test_fail, reply.error.message) });
      }
    } catch {
      setRerankStatus({ kind: 'fail', message: t(MSG.status_test_failed) });
    }
  }

  // 测试按钮守卫：worker handleTestRerank 测的是**已存储**的配置——endpoint/model/protocol 任一
  // 输入与快照不一致、或 apiKey 输入了未保存的新 key 时都视为脏并禁用，提示先保存，
  // 避免「Test 可用但测的是旧配置」的误导性结果。
  const rerankDirty =
    endpointStr.trim() !== snapshotEndpoint
    || modelStr.trim() !== snapshotModel
    || protocolStr !== snapshotProtocol
    || apiKeyStr.trim() !== '';
  const testDisabled = !rerankConfigured || rerankBusy || rerankDirty;

  // === 实例编辑器动作 ===

  function openCreate() {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    // 空白起步（R2，⚠️ 推翻 v1「预勾选全部已配置 provider」——避免意外计费面）：无预勾选。
    setEditor({ mode: 'create', name: '', members: [], topNStr: String(DEFAULT_AGGREGATE_TOP_N) });
  }

  function openEdit(instance: AggregateInstance) {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    // draft↔保存全字段 round-trip（enum-timerange 教训）：name/members/topN 原样进 draft；
    // edit 态 id 隐形不可改（KTD18：id 由 create 固化，patch 不可变更）。
    setEditor({
      mode: 'edit',
      editId: instance.id,
      name: instance.name,
      members: [...instance.members],
      topNStr: String(instance.topN),
    });
  }

  function closeEditor() {
    // 取消不落盘：仅丢弃 draft。
    setEditor(null);
  }

  function patchEditor(patch: Partial<Pick<EditorState, 'name' | 'topNStr'>>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function toggleMember(member: AggregateMemberId) {
    setEditor((prev) => {
      if (!prev) return prev;
      const members = prev.members.includes(member)
        ? prev.members.filter((item) => item !== member)
        : [...prev.members, member];
      return { ...prev, members };
    });
  }

  function stepTopN(delta: number) {
    setEditor((prev) => {
      if (!prev) return prev;
      const next = Math.min(MAX_AGGREGATE_TOP_N, Math.max(MIN_AGGREGATE_TOP_N, parseTopNStr(prev.topNStr) + delta));
      return { ...prev, topNStr: String(next) };
    });
  }

  async function submit() {
    if (!editor || busy) return;
    const name = editor.name.trim();
    const validCount = draftEligibilityOf(editor.members).validMembers.length;
    if (!name || validCount < 1) return;
    setStatus({ kind: 'busy' });
    const topN = clampAggregateTopN(parseTopNStr(editor.topNStr));
    const members = canonicalMembers(editor.members);
    try {
      if (editor.mode === 'create') {
        await sendMessage('createAggregateInstance', { name, members, topN });
        setStatus({ kind: 'ok', message: t(MSG.opts_aggregate_status_created) });
      } else {
        await sendMessage('updateAggregateInstance', { id: editor.editId, patch: { name, members, topN } });
        setStatus({ kind: 'ok', message: t(MSG.opts_aggregate_status_updated) });
      }
      setEditor(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_aggregate_status_failed) });
    }
  }

  async function doDelete(id: AggregateInstanceId) {
    if (busy) return;
    setStatus({ kind: 'busy' });
    try {
      // 无独苗保护、允许删光（AE9 清零合法，KTD18 显式分歧）。
      await sendMessage('deleteAggregateInstance', id);
      setStatus({ kind: 'ok', message: t(MSG.opts_aggregate_status_deleted) });
      setConfirmDeleteId(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_aggregate_status_failed) });
    }
  }

  const draftValidCount = editor ? draftEligibilityOf(editor.members).validMembers.length : 0;
  const draftTopN = editor ? parseTopNStr(editor.topNStr) : DEFAULT_AGGREGATE_TOP_N;
  const atTopNMin = editor ? draftTopN <= MIN_AGGREGATE_TOP_N : false;
  const atTopNMax = editor ? draftTopN >= MAX_AGGREGATE_TOP_N : false;

  return (
    <div className="aggregate-search-manager">
      {/* R12：endpoint 为空 → section 顶部常驻警示条；**不锁定**下方实例管理（列表/编辑/删除照常可用）。
          AE3：endpoint 清空 → 全部聚合实例隐式轴失效，但配置面仍可管理定义。 */}
      {!rerankConfigured && (
        <p className="aggregate-rerank-warning" role="note">
          <span aria-hidden="true">⚠ </span>
          {t(MSG.opts_aggregate_rerank_warning)}
        </p>
      )}

      {/* 卡 1：rerank 全局卡 */}
      <div className="aggregate-rerank-card" data-card="rerank">
        <h3 className="aggregate-card-title">{t(MSG.opts_aggregate_rerank_card_title)}</h3>
        <div className="aggregate-rerank-fields">
          {/* 协议置顶（决定下方字段提示语境）：切换只换 placeholder/hint 草稿提示，不动已输入值。 */}
          <label className="aggregate-rerank-field" htmlFor="aggregate-rerank-protocol">
            <span className="aggregate-rerank-field-label">{t(MSG.opts_aggregate_rerank_protocol_label)}</span>
            <select
              id="aggregate-rerank-protocol"
              value={protocolStr}
              onChange={(e) => setProtocolStr(e.target.value === 'jev' ? 'jev' : 'cohere')}
              disabled={rerankBusy}
            >
              <option value="cohere">{t(MSG.opts_aggregate_rerank_protocol_cohere)}</option>
              <option value="jev">{t(MSG.opts_aggregate_rerank_protocol_jev)}</option>
            </select>
          </label>
          <label className="aggregate-rerank-field" htmlFor="aggregate-rerank-endpoint">
            <span className="aggregate-rerank-field-label">{t(MSG.opts_aggregate_rerank_endpoint_label)}</span>
            <input
              id="aggregate-rerank-endpoint"
              type="text"
              value={endpointStr}
              onChange={(e) => setEndpointStr(e.target.value)}
              placeholder={protocolStr === 'jev'
                ? t(MSG.opts_aggregate_rerank_endpoint_placeholder_jev)
                : t(MSG.opts_aggregate_rerank_endpoint_placeholder)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {/* 完整 URL 提示（用户反馈）：POST 直接打 endpoint 全 URL，不自动补全协议路径；文案随协议切换。
              作为 .aggregate-rerank-fields（flex 列）的直接子元素复用既有 .hint 样式，无需新 CSS——
              放进 .aggregate-rerank-field（96px+1fr 网格）会被压进标签列。 */}
          <p className="hint aggregate-rerank-endpoint-hint">
            {protocolStr === 'jev'
              ? t(MSG.opts_aggregate_rerank_endpoint_hint_jev)
              : t(MSG.opts_aggregate_rerank_endpoint_hint)}
          </p>
          <label className="aggregate-rerank-field" htmlFor="aggregate-rerank-model">
            <span className="aggregate-rerank-field-label">{t(MSG.opts_aggregate_rerank_model_label)}</span>
            <input
              id="aggregate-rerank-model"
              type="text"
              value={modelStr}
              onChange={(e) => setModelStr(e.target.value)}
              placeholder={protocolStr === 'jev' ? t(MSG.opts_aggregate_rerank_model_placeholder_jev) : undefined}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="aggregate-rerank-field" htmlFor="aggregate-rerank-api-key">
            <span className="aggregate-rerank-field-label">
              {t(MSG.opts_aggregate_rerank_api_key_label)}
              {apiKeySet && <span className="aggregate-rerank-apikey-badge">{t(MSG.opts_aggregate_rerank_api_key_configured)}</span>}
            </span>
            <span className="aggregate-rerank-apikey-controls">
              <input
                id="aggregate-rerank-api-key"
                type="password"
                value={apiKeyStr}
                onChange={(e) => setApiKeyStr(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
              {apiKeySet && (
                <button type="button" onClick={clearApiKey} disabled={rerankBusy}>
                  {t(MSG.opts_aggregate_rerank_api_key_clear)}
                </button>
              )}
            </span>
          </label>
        </div>
        <div className="aggregate-rerank-actions">
          <button type="button" className="primary" onClick={saveRerank} disabled={rerankBusy}>
            {rerankStatus.kind === 'saving' ? t(MSG.status_saving) : t(MSG.opts_instance_save)}
          </button>
          <button
            type="button"
            onClick={testRerankConnection}
            disabled={testDisabled}
            title={rerankDirty ? t(MSG.opts_aggregate_rerank_test_save_first) : undefined}
          >
            {rerankStatus.kind === 'testing' ? t(MSG.status_testing) : t(MSG.opts_aggregate_rerank_test)}
          </button>
        </div>
        {rerankStatus.kind === 'ok' && <p className="status ok" role="status">{rerankStatus.message}</p>}
        {rerankStatus.kind === 'fail' && <p className="status fail" role="alert">{rerankStatus.message}</p>}
      </div>

      {/* 卡 2 + 卡 3：实例列表 + inline 编辑器 */}
      <div className="aggregate-instances-card" data-card="instances">
        <h3 className="aggregate-card-title">{t(MSG.opts_aggregate_instances_card_title)}</h3>
        <p className="hint">{t(MSG.opts_aggregate_instances_hint)}</p>

        {editor ? (
          <div className="aggregate-instance-form" data-mode={editor.mode}>
            <div className="aggregate-instance-form-row">
              <label htmlFor="aggregate-instance-name">{t(MSG.opts_aggregate_field_name)}</label>
              <input
                id="aggregate-instance-name"
                type="text"
                value={editor.name}
                maxLength={MAX_AGGREGATE_INSTANCE_NAME_LENGTH}
                onChange={(e) => patchEditor({ name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submit(); }
                }}
                placeholder={t(MSG.opts_aggregate_name_placeholder)}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="aggregate-instance-field-count" aria-hidden="true">
                {editor.name.length} / {MAX_AGGREGATE_INSTANCE_NAME_LENGTH}
              </span>
            </div>

            <div className="aggregate-instance-form-row">
              <label htmlFor="aggregate-instance-topn">{t(MSG.opts_aggregate_top_n_label)}</label>
              <span className="aggregate-topn-stepper">
                <button
                  type="button"
                  aria-label={t(MSG.opts_aggregate_top_n_decrease)}
                  onClick={() => stepTopN(-1)}
                  disabled={busy || atTopNMin}
                >
                  <MinusIcon size={14} />
                </button>
                <input
                  id="aggregate-instance-topn"
                  type="number"
                  min={MIN_AGGREGATE_TOP_N}
                  max={MAX_AGGREGATE_TOP_N}
                  step={1}
                  value={editor.topNStr}
                  onChange={(e) => patchEditor({ topNStr: e.target.value })}
                  // 拦截非整数键（e/E/./+/-/空格等单字符非数字键）：type=number 允许这些键进入
                  // 中间态（如 "1e5"、"--"），后续 clamp 会兜底但期间计数徽标/stepper 会闪错值。
                  // 控制键（Backspace/方向键/Tab 等，key.length>1）与 Ctrl/Meta 组合（复制粘贴）
                  // 放行；粘贴进来的垃圾仍由 onBlur 钳位兜底。
                  onKeyDown={(e) => {
                    if (e.key.length === 1 && !/[0-9]/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
                      e.preventDefault();
                    }
                  }}
                  onBlur={() => patchEditor({ topNStr: String(clampAggregateTopN(parseTopNStr(editor.topNStr))) })}
                  disabled={busy}
                />
                <button
                  type="button"
                  aria-label={t(MSG.opts_aggregate_top_n_increase)}
                  onClick={() => stepTopN(1)}
                  disabled={busy || atTopNMax}
                >
                  <PlusIcon size={14} />
                </button>
              </span>
            </div>
            <p className="hint">{t(MSG.opts_aggregate_top_n_hint)}</p>

            {/* 有效成员实时计数徽标（≥1 才可保存） */}
            <p className="aggregate-valid-members" aria-live="polite" data-count={draftValidCount}>
              {t(MSG.opts_aggregate_valid_members, String(draftValidCount))}
            </p>

            {/* 节 1：API 搜索（已配置 providers；有实例的展开为「Provider · 实例名」子行，数据源快照） */}
            <div className="aggregate-member-section" data-section="api">
              <h4 className="aggregate-section-title">{t(MSG.opts_aggregate_section_api)}</h4>
              {apiGroups.length === 0 ? (
                <p className="hint">{t(MSG.opts_aggregate_api_none_hint)}</p>
              ) : (
                apiGroups.map((group) =>
                  group.rows.length === 0 ? (
                    <label className="aggregate-member-row" key={group.providerId}>
                      <input
                        type="checkbox"
                        checked={editor.members.includes(group.providerId)}
                        onChange={() => toggleMember(group.providerId)}
                        disabled={busy}
                      />
                      <span>{group.label}</span>
                    </label>
                  ) : (
                    <div className="aggregate-member-group" key={group.providerId}>
                      <span className="aggregate-member-group-label">{group.label}</span>
                      {group.rows.map((row) => (
                        <label className="aggregate-member-row aggregate-member-row--sub" key={row.id}>
                          <input
                            type="checkbox"
                            checked={editor.members.includes(row.id)}
                            onChange={() => toggleMember(row.id)}
                            disabled={busy}
                          />
                          <span>{row.label}</span>
                        </label>
                      ))}
                    </div>
                  ),
                )
              )}
            </div>

            {/* 节 2：传统引擎（仅 extractor 引擎，registry 派生；节头固定警示文案 R9/KTD15③） */}
            <div className="aggregate-member-section" data-section="engines">
              <h4 className="aggregate-section-title">{t(MSG.opts_aggregate_section_engines)}</h4>
              <p className="hint aggregate-engine-warning">{t(MSG.opts_aggregate_engine_warning)}</p>
              {engineRows.map((row) => (
                <label className="aggregate-member-row" key={row.id}>
                  <input
                    type="checkbox"
                    checked={editor.members.includes(row.id)}
                    onChange={() => toggleMember(row.id)}
                    disabled={busy}
                  />
                  <span>{row.label}</span>
                </label>
              ))}
            </div>

            <div className="aggregate-instance-form-actions">
              <button
                type="button"
                className="primary"
                onClick={submit}
                disabled={busy || !editor.name.trim() || draftValidCount < 1}
              >
                {busy ? t(MSG.status_saving) : t(MSG.opts_instance_save)}
              </button>
              <button type="button" onClick={closeEditor} disabled={busy}>
                {t(MSG.opts_instance_cancel)}
              </button>
            </div>
          </div>
        ) : instances.length === 0 ? (
          <div className="aggregate-instances-empty">
            <p className="aggregate-instances-empty-text">{t(MSG.opts_aggregate_instance_empty)}</p>
            <button
              type="button"
              className="primary aggregate-add-btn"
              onClick={openCreate}
              disabled={atCapacity}
            >
              {t(MSG.opts_aggregate_instance_add)}
            </button>
          </div>
        ) : (
          <button type="button" className="aggregate-add-btn" onClick={openCreate} disabled={atCapacity}>
            {t(MSG.opts_aggregate_instance_add)}
          </button>
        )}
        {atCapacity && <p className="hint" role="note">{t(MSG.opts_aggregate_instance_limit_reached)}</p>}

        <div className="aggregate-instances-list">
          {instances.map((instance) => {
            const isConfirming = confirmDeleteId === instance.id;
            const instanceEligibility = eligibility[instance.id];
            const eligible = instanceEligibility?.eligible ?? false;
            // 失效 = 0 有效成员或 rerank 未配置（R12）：警示图标 + 分型原因（rerank 原因优先）。
            const invalidReason = !rerankConfigured
              ? t(MSG.opts_aggregate_instance_invalid_no_rerank)
              : (instanceEligibility?.validMembers ?? 0) < 1
                ? t(MSG.opts_aggregate_instance_invalid_no_members)
                : undefined;
            const memberLabels = instance.members.map((member) => memberLabel(member));
            const summary = `${memberLabels.slice(0, MEMBER_SUMMARY_PREVIEW).join('、')} · ${t(MSG.opts_aggregate_member_count, String(memberLabels.length))}`;
            return (
              <div
                key={instance.id}
                className={`aggregate-instance-row${editor?.editId === instance.id ? ' aggregate-instance-row--editing' : ''}`}
                data-instance-id={instance.id}
              >
                <div className="aggregate-instance-row-info">
                  <div className="aggregate-instance-row-title">
                    <span className="aggregate-instance-name">{instance.name}</span>
                    <span className="aggregate-instance-topn">{t(MSG.opts_aggregate_top_n_badge, String(instance.topN))}</span>
                    {!eligible && invalidReason && (
                      <span className="aggregate-instance-invalid" role="img" aria-label={invalidReason} title={invalidReason}>
                        ⚠
                      </span>
                    )}
                  </div>
                  <span className="aggregate-instance-members">{summary}</span>
                </div>
                <div className="aggregate-instance-row-actions">
                  {isConfirming ? (
                    <>
                      <span className="aggregate-instance-confirm-text" role="alert">
                        {t(MSG.opts_aggregate_instance_confirm_delete, instance.name)}
                      </span>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => doDelete(instance.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_aggregate_instance_confirm_delete_confirm)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busy}
                        autoFocus
                      >
                        {t(MSG.opts_instance_cancel)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => openEdit(instance)} disabled={busy}>
                        {t(MSG.opts_instance_edit)}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmDeleteId(instance.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_instance_delete)}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {status.kind === 'ok' && <p className="status ok" role="status">{status.message}</p>}
      {status.kind === 'fail' && <p className="status fail" role="alert">{status.message}</p>}
    </div>
  );
}
