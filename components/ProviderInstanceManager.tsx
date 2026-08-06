import { useEffect, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders, getAdapter } from '@/lib/providers/registry';
import type { ProviderInstance, ProviderInstanceId } from '@/lib/provider-instances';
import { MAX_INSTANCE_NAME_LENGTH, MAX_PROVIDER_INSTANCES, PROVIDERS_WITH_INSTANCE_OPTIONS } from '@/lib/provider-instances';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import {
  DEFAULT_EXA_SETTINGS,
  EXA_SEARCH_TYPES,
  EXA_CATEGORIES,
  normalizeExaSettings,
  type ExaSettings,
  type ExaSearchType,
  type ExaCategory,
} from '@/lib/providers/exa';
import {
  DOUBAO_TIME_RANGES,
  DOUBAO_INDUSTRIES,
  normalizeDoubaoSettings,
  type DoubaoSettings,
  type DoubaoIndustry,
} from '@/lib/providers/doubao';

type Status = { kind: 'idle' | 'saving' | 'ok' | 'fail'; message: string };

/**
 * Exa 参数草稿：把「中间字符串态」（域名的 textarea、可选数值的留空=null）
 * 与普通字段（searchType/category）统一放在编辑器 state 里，
 * 由受控表单直接读写 —— 与 SiteEngineManager 的编辑器 state 同构。
 */
type ExaDraft = {
  searchType: ExaSearchType;
  category: ExaCategory;
  includeText: string;
  excludeText: string;
  textMaxStr: string;
  highlightsMaxStr: string;
};

/**
 * Doubao 参数草稿：发文时间在「枚举值 | custom」间切换，选 custom 时由两个
 * date 输入（timeStart/timeEnd）组成 'YYYY-MM-DD..YYYY-MM-DD' 区间；站点/屏蔽
 * 域名用 textarea（每行一个）的中间字符串态，与 ExaDraft 同构。
 */
type DoubaoDraft = {
  timeRange: string; // '' | OneDay/OneWeek/OneMonth/OneYear | 'custom'
  timeStart: string;
  timeEnd: string;
  needContent: boolean;
  needUrl: boolean;
  onlyAuthoritative: boolean;
  queryRewrite: boolean;
  sites: string;
  blockHosts: string;
  contentFormat: 'text' | 'markdown';
  industry: '' | DoubaoIndustry;
};

type EditorState =
  | { mode: 'create'; baseProviderId: ProviderId; name: string; exa: ExaDraft; doubao: DoubaoDraft }
  | { mode: 'edit'; editId: ProviderInstanceId; baseProviderId: ProviderId; name: string; exa: ExaDraft; doubao: DoubaoDraft };

function defaultExaDraft(): ExaDraft {
  return {
    searchType: DEFAULT_EXA_SETTINGS.searchType,
    category: DEFAULT_EXA_SETTINGS.category,
    includeText: '',
    excludeText: '',
    textMaxStr: '',
    highlightsMaxStr: '',
  };
}

/** 编辑既有实例时用 normalizeExaSettings 把存储的 options 投影成表单草稿。 */
function exaDraftFromInstance(instance: ProviderInstance): ExaDraft {
  const settings = normalizeExaSettings(instance.options);
  return {
    searchType: settings.searchType,
    category: settings.category,
    includeText: settings.includeDomains.join('\n'),
    excludeText: settings.excludeDomains.join('\n'),
    textMaxStr: settings.textMaxCharacters != null ? String(settings.textMaxCharacters) : '',
    highlightsMaxStr: settings.highlightsMaxCharacters != null ? String(settings.highlightsMaxCharacters) : '',
  };
}

/** 保存时把草稿组装成 ExaSettings（textarea 按行拆分、空数值 → null）。 */
function exaSettingsFromDraft(draft: ExaDraft): ExaSettings {
  return {
    searchType: draft.searchType,
    category: draft.category,
    includeDomains: draft.includeText.split('\n').map((d) => d.trim()).filter(Boolean),
    excludeDomains: draft.excludeText.split('\n').map((d) => d.trim()).filter(Boolean),
    textMaxCharacters: draft.textMaxStr.trim() ? Number(draft.textMaxStr) : null,
    highlightsMaxCharacters: draft.highlightsMaxStr.trim() ? Number(draft.highlightsMaxStr) : null,
  };
}

function defaultDoubaoDraft(): DoubaoDraft {
  return {
    timeRange: '',
    timeStart: '',
    timeEnd: '',
    needContent: false,
    needUrl: true,
    onlyAuthoritative: false,
    queryRewrite: false,
    sites: '',
    blockHosts: '',
    contentFormat: 'text',
    industry: '',
  };
}

/** 编辑既有实例时用 normalizeDoubaoSettings 把存储的 options 投影成表单草稿。 */
function doubaoDraftFromInstance(instance: ProviderInstance): DoubaoDraft {
  const settings = normalizeDoubaoSettings(instance.options);
  const range = /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.exec(settings.timeRange);
  return {
    timeRange: range ? 'custom' : settings.timeRange,
    timeStart: range ? range[0].split('..')[0] : '',
    timeEnd: range ? range[0].split('..')[1] : '',
    needContent: settings.needContent,
    needUrl: settings.needUrl,
    onlyAuthoritative: settings.onlyAuthoritative,
    queryRewrite: settings.queryRewrite,
    sites: settings.sites.join('\n'),
    blockHosts: settings.blockHosts.join('\n'),
    contentFormat: settings.contentFormat,
    industry: settings.industry,
  };
}

/** 保存时把草稿组装成 DoubaoSettings（textarea 按行拆分、自定义区间两端齐全才落值）。 */
function doubaoSettingsFromDraft(draft: DoubaoDraft): DoubaoSettings {
  return {
    // 枚举值（OneDay/OneWeek/OneMonth/OneYear）原样透传；仅 custom 需要拼区间。
    // 区间必须两端齐全（API 无半区间，缺端落 '' = 不限）且 start <= end
    // （ISO 串字典序可比；date input 的 min 只是引导，手输/后改 start 仍可倒置）。
    timeRange: draft.timeRange === 'custom'
      ? (draft.timeStart && draft.timeEnd && draft.timeStart <= draft.timeEnd
          ? `${draft.timeStart}..${draft.timeEnd}`
          : '')
      : draft.timeRange,
    needContent: draft.needContent,
    needUrl: draft.needUrl,
    sites: draft.sites.split('\n').map((d) => d.trim()).filter(Boolean).slice(0, 20),
    blockHosts: draft.blockHosts.split('\n').map((d) => d.trim()).filter(Boolean).slice(0, 5),
    onlyAuthoritative: draft.onlyAuthoritative,
    queryRewrite: draft.queryRewrite,
    contentFormat: draft.contentFormat,
    industry: draft.industry,
  };
}

/** Exa 参数表单：从 feat/exa-settings 的 ExaSettings.tsx 移植，改为受控草稿。 */
function ExaOptionsForm({ draft, onChange }: { draft: ExaDraft; onChange: (patch: Partial<ExaDraft>) => void }) {
  return (
    <div className="exa-settings">
      <div className="exa-settings-grid">
        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_exa_search_type)}</span>
          <select
            value={draft.searchType}
            onChange={(e) => onChange({ searchType: e.target.value as ExaSearchType })}
          >
            {EXA_SEARCH_TYPES.map((st) => (
              <option key={st} value={st}>{t(MSG[`opts_exa_type_${st.replace(/-/g, '_')}` as keyof typeof MSG])}</option>
            ))}
          </select>
        </label>

        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_exa_category)}</span>
          <select
            value={draft.category}
            onChange={(e) => onChange({ category: e.target.value as ExaCategory })}
          >
            {EXA_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c === '' ? t(MSG.opts_exa_category_none) : t(MSG[`opts_exa_cat_${c.replace(/\s+/g, '_')}` as keyof typeof MSG])}</option>
            ))}
          </select>
        </label>

        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_exa_text_max_chars)}</span>
          <input
            type="number"
            min={1}
            max={10000}
            placeholder={t(MSG.opts_exa_optional)}
            value={draft.textMaxStr}
            onChange={(e) => onChange({ textMaxStr: e.target.value })}
          />
        </label>

        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_exa_highlights_max_chars)}</span>
          <input
            type="number"
            min={1}
            max={10000}
            placeholder={t(MSG.opts_exa_optional)}
            value={draft.highlightsMaxStr}
            onChange={(e) => onChange({ highlightsMaxStr: e.target.value })}
          />
        </label>
      </div>

      <label className="exa-field exa-field--wide">
        <span className="exa-field-label">{t(MSG.opts_exa_include_domains)}</span>
        <textarea
          rows={3}
          placeholder={t(MSG.opts_exa_domains_placeholder)}
          value={draft.includeText}
          onChange={(e) => onChange({ includeText: e.target.value })}
        />
      </label>

      <label className="exa-field exa-field--wide">
        <span className="exa-field-label">{t(MSG.opts_exa_exclude_domains)}</span>
        <textarea
          rows={3}
          placeholder={t(MSG.opts_exa_domains_placeholder)}
          value={draft.excludeText}
          onChange={(e) => onChange({ excludeText: e.target.value })}
        />
      </label>
    </div>
  );
}

/** Doubao 参数表单：复用 .exa-settings 系列的样式类（与 ExaOptionsForm 同构的受控草稿）。 */
function DoubaoOptionsForm({ draft, onChange }: { draft: DoubaoDraft; onChange: (patch: Partial<DoubaoDraft>) => void }) {
  return (
    <div className="exa-settings">
      <div className="exa-settings-grid">
        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_doubao_time_range)}</span>
          <select
            value={draft.timeRange}
            onChange={(e) => onChange({ timeRange: e.target.value })}
          >
            <option value="">{t(MSG.opts_doubao_time_unlimited)}</option>
            {DOUBAO_TIME_RANGES.map((r) => (
              <option key={r} value={r}>{t(MSG[`opts_doubao_time_${r.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}` as keyof typeof MSG])}</option>
            ))}
            <option value="custom">{t(MSG.opts_doubao_time_custom)}</option>
          </select>
        </label>

        {draft.timeRange === 'custom' && (
          <>
            <label className="exa-field">
              <span className="exa-field-label">{t(MSG.opts_doubao_time_start)}</span>
              <input
                type="date"
                value={draft.timeStart}
                onChange={(e) => onChange({ timeStart: e.target.value })}
              />
            </label>
            <label className="exa-field">
              <span className="exa-field-label">{t(MSG.opts_doubao_time_end)}</span>
              <input
                type="date"
                min={draft.timeStart || undefined}
                value={draft.timeEnd}
                onChange={(e) => onChange({ timeEnd: e.target.value })}
              />
            </label>
          </>
        )}

        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_doubao_content_format)}</span>
          <select
            value={draft.contentFormat}
            onChange={(e) => onChange({ contentFormat: e.target.value as 'text' | 'markdown' })}
          >
            <option value="text">{t(MSG.opts_doubao_format_text)}</option>
            <option value="markdown">{t(MSG.opts_doubao_format_markdown)}</option>
          </select>
        </label>

        <label className="exa-field">
          <span className="exa-field-label">{t(MSG.opts_doubao_industry)}</span>
          <select
            value={draft.industry}
            onChange={(e) => onChange({ industry: e.target.value as '' | DoubaoIndustry })}
          >
            <option value="">{t(MSG.opts_doubao_industry_none)}</option>
            {DOUBAO_INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{t(MSG[`opts_doubao_industry_${ind}` as keyof typeof MSG])}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="exa-settings-grid">
        <label className="exa-field">
          <input
            type="checkbox"
            checked={draft.needContent}
            onChange={(e) => onChange({ needContent: e.target.checked })}
          />
          <span className="exa-field-label">{t(MSG.opts_doubao_need_content)}</span>
        </label>
        <label className="exa-field">
          <input
            type="checkbox"
            checked={draft.needUrl}
            onChange={(e) => onChange({ needUrl: e.target.checked })}
          />
          <span className="exa-field-label">{t(MSG.opts_doubao_need_url)}</span>
        </label>
        <label className="exa-field">
          <input
            type="checkbox"
            checked={draft.onlyAuthoritative}
            onChange={(e) => onChange({ onlyAuthoritative: e.target.checked })}
          />
          <span className="exa-field-label">{t(MSG.opts_doubao_only_authoritative)}</span>
        </label>
        <label className="exa-field">
          <input
            type="checkbox"
            checked={draft.queryRewrite}
            onChange={(e) => onChange({ queryRewrite: e.target.checked })}
          />
          <span className="exa-field-label">{t(MSG.opts_doubao_query_rewrite)}</span>
        </label>
      </div>

      <label className="exa-field exa-field--wide">
        <span className="exa-field-label">{t(MSG.opts_doubao_sites)}</span>
        <textarea
          rows={3}
          placeholder={t(MSG.opts_doubao_domains_placeholder)}
          value={draft.sites}
          onChange={(e) => onChange({ sites: e.target.value })}
        />
      </label>
      <p className="hint">{t(MSG.opts_doubao_sites_hint)}</p>

      <label className="exa-field exa-field--wide">
        <span className="exa-field-label">{t(MSG.opts_doubao_block_hosts)}</span>
        <textarea
          rows={3}
          placeholder={t(MSG.opts_doubao_domains_placeholder)}
          value={draft.blockHosts}
          onChange={(e) => onChange({ blockHosts: e.target.value })}
        />
      </label>
      <p className="hint">{t(MSG.opts_doubao_block_hosts_hint)}</p>
    </div>
  );
}

/**
 * Provider 实例管理：自包含组件（无 props，自己加载数据）。
 * 列出实例 + 创建/编辑/删除；Phase 1 仅 Exa 有参数表单，Phase 2 加入 Doubao。
 * 实例 id 属 SourceId 边界，这里只发 CRUD 消息，绝不把实例 id 当 ProviderId 使用。
 */
export function ProviderInstanceManager() {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [configuredProviderIds, setConfiguredProviderIds] = useState<ProviderId[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<ProviderInstanceId | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  async function refresh() {
    try {
      const config = await sendMessage('getProviderConfig', undefined);
      setInstances(config.providerInstances ?? []);
      setConfiguredProviderIds(config.configuredProviderIds);
    } catch {
      // 加载失败保持现有列表；下次写操作后再同步。
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const providers = allProviders();
  const configuredProviders = providers.filter((p) => configuredProviderIds.includes(p.id));
  // 只有带 per-instance options 表单的 provider 才允许建实例；其余建出来等同裸 provider pill，无意义。
  const instanceableProviders = configuredProviders.filter((p) => PROVIDERS_WITH_INSTANCE_OPTIONS.has(p.id));
  const noInstanceableProvider = instanceableProviders.length === 0;
  const busy = status.kind === 'saving';
  const atCapacity = instances.length >= MAX_PROVIDER_INSTANCES;

  // 默认实例 = 每个 base provider 在存储顺序里的第一个实例（KTD5，与 gateway 的路由一致）。
  const defaultInstanceIds = new Set<ProviderInstanceId>();
  {
    const seenBaseProviders = new Set<ProviderId>();
    for (const instance of instances) {
      if (!seenBaseProviders.has(instance.baseProviderId)) {
        seenBaseProviders.add(instance.baseProviderId);
        defaultInstanceIds.add(instance.id);
      }
    }
  }

  // 独苗实例 = base provider 下唯一实例（统一实例模型：不可删，只能隐藏）。
  // 与 defaultInstanceIds 的交集恒为真（独苗必为默认实例），但按「base 下数量=1」计算更直接。
  const soleInstanceIds = new Set<ProviderInstanceId>();
  {
    const counts = new Map<ProviderId, number>();
    for (const instance of instances) {
      counts.set(instance.baseProviderId, (counts.get(instance.baseProviderId) ?? 0) + 1);
    }
    for (const instance of instances) {
      if ((counts.get(instance.baseProviderId) ?? 0) <= 1) soleInstanceIds.add(instance.id);
    }
  }

  function openCreate() {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle', message: '' });
    // 默认选中首个支持实例 options 的已配置 provider（exa 或 doubao）。
    const baseProviderId = instanceableProviders[0]?.id ?? 'exa';
    setEditor({ mode: 'create', baseProviderId, name: '', exa: defaultExaDraft(), doubao: defaultDoubaoDraft() });
  }

  function openEdit(instance: ProviderInstance) {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle', message: '' });
    setEditor({
      mode: 'edit',
      editId: instance.id,
      baseProviderId: instance.baseProviderId,
      name: instance.name,
      exa: exaDraftFromInstance(instance),
      doubao: doubaoDraftFromInstance(instance),
    });
  }

  function closeEditor() {
    setEditor(null);
  }

  function patchEditor(patch: Partial<Pick<EditorState, 'baseProviderId' | 'name'>>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function patchExa(patch: Partial<ExaDraft>) {
    setEditor((prev) => (prev ? { ...prev, exa: { ...prev.exa, ...patch } } : prev));
  }

  function patchDoubao(patch: Partial<DoubaoDraft>) {
    setEditor((prev) => (prev ? { ...prev, doubao: { ...prev.doubao, ...patch } } : prev));
  }

  /** 恢复默认设置：仅把 options 草稿重置为 provider 默认值（镜像 submit 的 per-provider 分支），
   *  名称字段不动（名称是实例身份，create 模式同样不动）；只 patch 草稿，仍需点保存才生效。 */
  function resetOptionsDraft() {
    setEditor((prev) => {
      if (!prev) return prev;
      const exa = prev.baseProviderId === 'exa' ? defaultExaDraft() : prev.exa;
      const doubao = prev.baseProviderId === 'doubao' ? defaultDoubaoDraft() : prev.doubao;
      return { ...prev, exa, doubao };
    });
  }

  async function submit() {
    if (!editor || busy) return;
    const name = editor.name.trim();
    if (!name) return;
    setStatus({ kind: 'saving', message: '' });
    // 仅带 per-instance options schema 的 provider 组装 options；其它 provider 的 options 为空对象。
    const options = editor.baseProviderId === 'exa'
      ? exaSettingsFromDraft(editor.exa) as unknown as Record<string, unknown>
      : editor.baseProviderId === 'doubao'
        ? doubaoSettingsFromDraft(editor.doubao) as unknown as Record<string, unknown>
        : {};
    try {
      if (editor.mode === 'create') {
        await sendMessage('createProviderInstance', { baseProviderId: editor.baseProviderId, name, options });
        setStatus({ kind: 'ok', message: t(MSG.opts_instance_status_created) });
      } else {
        await sendMessage('updateProviderInstance', { id: editor.editId, patch: { name, options } });
        setStatus({ kind: 'ok', message: t(MSG.opts_instance_status_updated) });
      }
      setEditor(null);
      await refresh();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_instance_status_failed) });
    }
  }

  async function doDelete(id: ProviderInstanceId) {
    if (busy) return;
    setStatus({ kind: 'saving', message: '' });
    try {
      await sendMessage('deleteProviderInstance', id);
      setStatus({ kind: 'ok', message: t(MSG.opts_instance_status_deleted) });
      setConfirmDeleteId(null);
      await refresh();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_instance_status_failed) });
    }
  }

  return (
    <div className="provider-instance-manager">
      <p className="hint">{t(MSG.opts_instances_hint)}</p>

      {editor ? (
        <div className="provider-instance-form" data-mode={editor.mode}>
          <div className="provider-instance-form-row">
            <label htmlFor="provider-instance-name">{t(MSG.opts_instance_name)}</label>
            <input
              id="provider-instance-name"
              type="text"
              value={editor.name}
              maxLength={MAX_INSTANCE_NAME_LENGTH}
              onChange={(e) => patchEditor({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
              }}
              placeholder={t(MSG.opts_instance_name_placeholder)}
              autoComplete="off"
              spellCheck={false}
            />
            <span className="provider-instance-field-count" aria-hidden="true">{editor.name.length} / {MAX_INSTANCE_NAME_LENGTH}</span>
          </div>

          <div className="provider-instance-form-row">
            <label htmlFor="provider-instance-base">{t(MSG.opts_instance_base_provider)}</label>
            <select
              id="provider-instance-base"
              value={editor.baseProviderId}
              onChange={(e) => patchEditor({ baseProviderId: e.target.value as ProviderId })}
              // base provider 由实例 id 编码、存储层不可变更（storage.ts updateProviderInstance）；
              // 编辑模式禁用下拉，防止切 base 后 submit 按新 base 组装 options，静默清空原设置。
              disabled={editor.mode === 'edit'}
            >
              {instanceableProviders.map((p) => (
                <option key={p.id} value={p.id}>{t(p.label)}</option>
              ))}
            </select>
          </div>

          {editor.baseProviderId === 'exa' && (
            <ExaOptionsForm draft={editor.exa} onChange={patchExa} />
          )}
          {editor.baseProviderId === 'doubao' && (
            <DoubaoOptionsForm draft={editor.doubao} onChange={patchDoubao} />
          )}

          {(editor.baseProviderId === 'exa' || editor.baseProviderId === 'doubao') && (
            <div className="provider-instance-form-reset">
              <button type="button" onClick={resetOptionsDraft} disabled={busy}>
                {t(MSG.opts_instance_reset)}
              </button>
            </div>
          )}

          <div className="provider-instance-form-actions">
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={busy || !editor.name.trim()}
            >
              {busy ? t(MSG.status_saving) : t(MSG.opts_instance_save)}
            </button>
            <button type="button" onClick={closeEditor} disabled={busy}>
              {t(MSG.opts_instance_cancel)}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="provider-instance-add-btn"
            onClick={openCreate}
            disabled={atCapacity || noInstanceableProvider}
          >
            {t(MSG.opts_instance_add)}
          </button>
          {atCapacity && (
            <p className="hint" role="note">{t(MSG.opts_instance_limit_reached)}</p>
          )}
          {noInstanceableProvider && (
            <p className="hint" role="note">
              {configuredProviderIds.length === 0
                ? t(MSG.opts_instances_hint_need_key)
                : t(MSG.opts_instances_hint_no_options)}
            </p>
          )}
        </>
      )}

      <div className="provider-instances-list">
        {instances.length === 0 ? (
          <p className="provider-instances-empty">{t(MSG.opts_instance_empty)}</p>
        ) : (
          instances.map((instance) => {
            const isConfirming = confirmDeleteId === instance.id;
            const isDefault = defaultInstanceIds.has(instance.id);
            const isSole = soleInstanceIds.has(instance.id);
            const deleteDisabled = busy || isSole;
            const deleteTooltip = isSole ? t(MSG.opts_instance_cannot_delete_default) : undefined;
            return (
              <div
                key={instance.id}
                className="provider-instance-row"
                data-instance-id={instance.id}
              >
                <div className="provider-instance-row-info">
                  <div className="provider-instance-row-title">
                    <span className="provider-instance-name">{instance.name}</span>
                    {isDefault && (
                      <span className="provider-instance-default-badge">{t(MSG.opts_instance_default)}</span>
                    )}
                  </div>
                  <span className="provider-instance-provider">{t(getAdapter(instance.baseProviderId).label)}</span>
                </div>
                <div className="provider-instance-row-actions">
                  {isConfirming ? (
                    <>
                      <span className="provider-instance-confirm-text" role="alert">
                        {t(MSG.opts_instance_delete_confirm, instance.name)}
                      </span>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => doDelete(instance.id)}
                        disabled={deleteDisabled}
                        title={deleteTooltip}
                      >
                        {t(MSG.opts_instance_delete)}
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
                      <button
                        type="button"
                        onClick={() => openEdit(instance)}
                        disabled={busy}
                      >
                        {t(MSG.opts_instance_edit)}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmDeleteId(instance.id)}
                        disabled={deleteDisabled}
                        title={deleteTooltip}
                      >
                        {t(MSG.opts_instance_delete)}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {status.kind === 'ok' && <p className="status ok" role="status">{status.message}</p>}
      {status.kind === 'fail' && <p className="status fail" role="alert">{status.message}</p>}
    </div>
  );
}
