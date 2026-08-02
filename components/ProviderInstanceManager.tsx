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

type EditorState =
  | { mode: 'create'; baseProviderId: ProviderId; name: string; exa: ExaDraft }
  | { mode: 'edit'; editId: ProviderInstanceId; baseProviderId: ProviderId; name: string; exa: ExaDraft };

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

/**
 * Provider 实例管理：自包含组件（无 props，自己加载数据）。
 * 列出实例 + 创建/编辑/删除；Phase 1 仅 Exa 有参数表单。
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
    // 默认选中首个支持实例 options 的已配置 provider（Phase 1 即 exa）。
    const baseProviderId = instanceableProviders[0]?.id ?? 'exa';
    setEditor({ mode: 'create', baseProviderId, name: '', exa: defaultExaDraft() });
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

  async function submit() {
    if (!editor || busy) return;
    const name = editor.name.trim();
    if (!name) return;
    setStatus({ kind: 'saving', message: '' });
    // Phase 1：仅 Exa 有 options schema；其它 provider 的 options 为空对象。
    const options = editor.baseProviderId === 'exa'
      ? exaSettingsFromDraft(editor.exa) as unknown as Record<string, unknown>
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
            >
              {instanceableProviders.map((p) => (
                <option key={p.id} value={p.id}>{t(p.label)}</option>
              ))}
            </select>
          </div>

          {editor.baseProviderId === 'exa' && (
            <ExaOptionsForm draft={editor.exa} onChange={patchExa} />
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
