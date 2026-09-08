import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  SiteConstruction,
  SiteInstanceDefinition,
  SiteInstanceEngineId,
  SiteInstanceId,
  SiteInstanceOptions,
  ZhanneiFilters,
} from '@/lib/site-instances';
import {
  constructionFor,
  findDuplicateSiteInstanceScopes,
  formDefaultConstruction,
  normalizeSiteTarget,
  siteScopeForDefinition,
  siteScopeForTarget,
  zhanneiFingerprintFor,
} from '@/lib/site-instances';
import { sendMessage } from '@/lib/messaging';
import { t, MSG, type MessageName } from '@/lib/i18n';
import { getEngine } from '@/lib/engines/registry';

const BACKING_ENGINES: readonly SiteInstanceEngineId[] = ['google', 'bing', 'baidu'];

/** UI-side affordances matching backend limits. Defined once to avoid scattering magic numbers. */
const NAME_MAX = 40;
const TARGET_MAX = 2048;
const MAX_SITE_INSTANCES = 50;

const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: '' | NonNullable<ZhanneiFilters['timeRange']>; key: MessageName }> = [
  { value: '', key: MSG.opts_site_instances_filters_time_any },
  { value: 60, key: MSG.opts_site_instances_filters_time_1h },
  { value: 1440, key: MSG.opts_site_instances_filters_time_1d },
  { value: 10080, key: MSG.opts_site_instances_filters_time_1w },
  { value: 43200, key: MSG.opts_site_instances_filters_time_1m },
];

type EditorFields = {
  name: string;
  target: string;
  engineId: SiteInstanceEngineId;
  /** 有效构造模式：编辑初值 = constructionFor(definition)（读侧默认），新建 = formDefaultConstruction（建侧默认）。 */
  construction: SiteConstruction;
  /** zhannei 筛选（'' = 不限时间）。 */
  timeRange: '' | NonNullable<ZhanneiFilters['timeRange']>;
  sortByTime: boolean;
  titleOnly: boolean;
};
type EditorState =
  | ({ mode: 'create'; editId?: never } & EditorFields)
  | ({ mode: 'edit'; editId: SiteInstanceId } & EditorFields);

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'fail'; message: string };

interface Preview {
  scope: string;
  degraded: 'none' | 'bing' | 'baidu';
}

interface Validation {
  ok: boolean;
  nameError: string;
  targetError: string;
  duplicateError: string;
  preview: Preview | null;
}

function emptyEditor(): EditorState {
  return {
    mode: 'create',
    name: '',
    target: '',
    engineId: 'google',
    construction: 'query',
    timeRange: '',
    sortByTime: false,
    titleOnly: false,
  };
}

/** 表单当前输入 → 提交 payload 的 options（KTD4：建侧总是携带显式 mode）。 */
function editorOptions(editor: EditorFields): SiteInstanceOptions | undefined {
  if (editor.engineId === 'google') return undefined;
  const options: SiteInstanceOptions = { mode: editor.construction };
  if (editor.engineId === 'baidu' && editor.construction === 'zhannei') {
    const filters: ZhanneiFilters = {};
    if (editor.timeRange !== '') filters.timeRange = editor.timeRange;
    if (editor.sortByTime) filters.sortByTime = true;
    if (editor.titleOnly) filters.titleOnly = true;
    if (Object.keys(filters).length > 0) options.zhannei = filters;
  }
  return options;
}

/** 切换底层引擎时重置构造模式与筛选（新引擎的建侧默认 + 清空 zhannei 筛选）。 */
function patchEditorForEngine<T extends EditorFields>(fields: T, engineId: SiteInstanceEngineId): T {
  return {
    ...fields,
    engineId,
    construction: formDefaultConstruction(engineId),
    timeRange: '',
    sortByTime: false,
    titleOnly: false,
  };
}

/** 实时校验 + 预览：name/target/engineId/构造模式任一变化都重算。重复检测排除正在编辑的项。 */
function validate(siteInstances: readonly SiteInstanceDefinition[], editor: EditorState): Validation {
  const result: Validation = {
    ok: false,
    nameError: '',
    targetError: '',
    duplicateError: '',
    preview: null,
  };
  const trimmedName = editor.name.trim();
  if (!trimmedName) result.nameError = t(MSG.opts_site_instances_invalid_name);

  const normalized = normalizeSiteTarget(editor.target);
  if (!normalized) {
    result.targetError = t(MSG.opts_site_instances_invalid_target);
    return result;
  }

  const scope = siteScopeForTarget(editor.engineId, normalized);
  const segments = normalized.pathname.split('/').filter(Boolean);
  const degraded: Preview['degraded'] =
    editor.engineId === 'bing' && segments.length > 2
      ? 'bing'
      : editor.engineId === 'baidu' && segments.length > 0
        ? 'baidu'
        : 'none';
  result.preview = { scope, degraded };

  // 重复检测：candidate 占位 id 仅用于分组对比，不持久化。去重键 =
  // (engine, 有效构造模式, scope, zhannei 筛选指纹)（KTD6）。
  const options = editorOptions(editor);
  const candidate: SiteInstanceDefinition = {
    id: editor.editId ?? 'site:preview',
    name: trimmedName || '(pending)',
    target: normalized.canonicalUrl,
    engineId: editor.engineId,
    ...(options ? { options } : {}),
  };
  const construction = constructionFor(candidate);
  const zhannei = zhanneiFingerprintFor(candidate);
  const others = siteInstances.filter((s) => s.id !== editor.editId);
  const duplicates = findDuplicateSiteInstanceScopes([...others, candidate]);
  const ours = duplicates.find((g) => g.engineId === editor.engineId && g.mode === construction && g.scope === scope && g.zhannei === zhannei);
  if (ours) {
    const existing = others.find((s) => ours.siteIds.includes(s.id) && s.id !== candidate.id);
    result.duplicateError = existing
      ? t(MSG.opts_site_instances_duplicate_with_name, existing.name)
      : t(MSG.opts_site_instances_duplicate);
  }

  result.ok = !result.nameError && !result.targetError && !result.duplicateError;
  return result;
}

/** 构造模式单选的可选项（按引擎；google 无模式）。 */
function constructionChoices(engineId: SiteInstanceEngineId): ReadonlyArray<{ value: SiteConstruction; labelKey: MessageName }> {
  if (engineId === 'baidu') {
    return [
      { value: 'zhannei', labelKey: MSG.opts_site_instances_mode_zhannei },
      { value: 'query', labelKey: MSG.opts_site_instances_mode_query },
    ];
  }
  if (engineId === 'bing') {
    return [
      { value: 'q1', labelKey: MSG.opts_site_instances_mode_q1 },
      { value: 'query', labelKey: MSG.opts_site_instances_mode_query },
    ];
  }
  return [];
}

export function SiteInstanceManager({
  siteInstances,
  onChange,
}: {
  siteInstances: readonly SiteInstanceDefinition[];
  onChange: () => void;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<SiteInstanceId | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [touched, setTouched] = useState<{ name: boolean; target: boolean }>({ name: false, target: false });
  const [submitted, setSubmitted] = useState(false);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const engineRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pendingFocusEngine = useRef<SiteInstanceEngineId | null>(null);

  const validation = useMemo(() => (editor ? validate(siteInstances, editor) : null), [editor, siteInstances]);
  const busy = status.kind === 'busy';
  const atCapacity = siteInstances.length >= MAX_SITE_INSTANCES;
  const constructionChoicesForEditor = editor ? constructionChoices(editor.engineId) : [];
  const zhanneiFiltersVisible = editor?.engineId === 'baidu' && editor.construction === 'zhannei';

  // 表单打开时聚焦名称输入框；编辑模式切到不同记录时也重新聚焦。
  const focusKey = editor ? `${editor.mode}:${editor.editId ?? ''}` : null;
  useEffect(() => {
    if (focusKey) nameFieldRef.current?.focus();
  }, [focusKey]);

  useLayoutEffect(() => {
    const engineId = pendingFocusEngine.current;
    if (!engineId) return;
    pendingFocusEngine.current = null;
    engineRadioRefs.current[engineId]?.focus();
  }, [editor?.engineId]);

  function openCreate() {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    setTouched({ name: false, target: false });
    setSubmitted(false);
    setEditor(emptyEditor());
  }

  function openEdit(definition: SiteInstanceDefinition) {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    // 编辑模式打开时已有值，直接标记 touched 以便即时显示任何冲突（如期间新增了重复项）。
    setTouched({ name: true, target: true });
    setSubmitted(false);
    const construction = constructionFor(definition);
    const filters = construction === 'zhannei' ? definition.options?.zhannei : undefined;
    setEditor({
      mode: 'edit',
      editId: definition.id,
      name: definition.name,
      target: definition.target,
      engineId: definition.engineId,
      construction,
      timeRange: filters?.timeRange ?? '',
      sortByTime: filters?.sortByTime === true,
      titleOnly: filters?.titleOnly === true,
    });
  }

  function closeEditor() {
    setEditor(null);
  }

  function patchEditor(patch: Partial<EditorFields>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function selectEngine(engineId: SiteInstanceEngineId) {
    setEditor((prev) => (prev ? patchEditorForEngine(prev, engineId) : prev));
  }

  async function submit() {
    if (!editor || !validation || busy) return;
    if (!validation.ok) {
      setSubmitted(true);
      return;
    }
    setStatus({ kind: 'busy' });
    const name = editor.name.trim();
    const target = editor.target.trim();
    const options = editorOptions(editor);
    try {
      if (editor.mode === 'create') {
        await sendMessage('createSiteInstance', { name, target, engineId: editor.engineId, ...(options ? { options } : {}) });
        setStatus({ kind: 'ok', message: t(MSG.opts_site_instances_status_created) });
      } else {
        await sendMessage('updateSiteInstance', {
          id: editor.editId,
          name,
          target,
          engineId: editor.engineId,
          ...(options ? { options } : {}),
        });
        setStatus({ kind: 'ok', message: t(MSG.opts_site_instances_status_updated) });
      }
      setEditor(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_site_instances_status_failed) });
    }
  }

  async function doDelete(id: SiteInstanceId) {
    if (busy) return;
    setStatus({ kind: 'busy' });
    try {
      await sendMessage('deleteSiteInstance', id);
      setStatus({ kind: 'ok', message: t(MSG.opts_site_instances_status_deleted) });
      setConfirmDeleteId(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_site_instances_status_failed) });
    }
  }

  // 错误仅在字段被 touched 或表单被 submitted 后显示，避免空白创建表单一打开就报错。
  const showNameError = !!(validation?.nameError && (submitted || touched.name));
  const showTargetError = !!(validation?.targetError && (submitted || touched.target));
  const showDuplicateError = !!(validation?.duplicateError && (submitted || touched.target));

  const nameErrorId = 'site-instance-name-error';
  const targetErrorId = 'site-instance-target-error';
  const duplicateErrorId = 'site-instance-duplicate-error';
  const targetDescribedBy = [showTargetError ? targetErrorId : null, showDuplicateError ? duplicateErrorId : null]
    .filter(Boolean).join(' ') || undefined;

  return (
    <div className="site-instances">
      <p className="hint">{t(MSG.opts_site_instances_hint)}</p>

      {editor ? (
        <div className="site-instance-form" data-mode={editor.mode}>
          <div className="site-instance-form-row">
            <label htmlFor="site-instance-name">{t(MSG.opts_site_instances_field_name)}</label>
            <input
              id="site-instance-name"
              ref={nameFieldRef}
              type="text"
              value={editor.name}
              maxLength={NAME_MAX}
              onChange={(e) => {
                patchEditor({ name: e.target.value });
                setTouched((prev) => ({ ...prev, name: true }));
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showNameError}
              aria-describedby={showNameError ? nameErrorId : undefined}
            />
            <span className="site-instance-field-count" aria-hidden="true">{editor.name.length} / {NAME_MAX}</span>
          </div>
          {showNameError && (
            <p id={nameErrorId} className="site-instance-field-error" role="alert">{validation?.nameError}</p>
          )}

          <div className="site-instance-form-row">
            <label htmlFor="site-instance-target">{t(MSG.opts_site_instances_field_target)}</label>
            <input
              id="site-instance-target"
              type="url"
              value={editor.target}
              maxLength={TARGET_MAX}
              onChange={(e) => {
                patchEditor({ target: e.target.value });
                setTouched((prev) => ({ ...prev, target: true }));
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, target: true }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
              }}
              placeholder="docs.example.com/guide"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showTargetError || showDuplicateError}
              aria-describedby={targetDescribedBy}
            />
            <span className="site-instance-field-count" aria-hidden="true">{editor.target.length} / {TARGET_MAX}</span>
          </div>
          {showTargetError && (
            <p id={targetErrorId} className="site-instance-field-error" role="alert">{validation?.targetError}</p>
          )}

          <div className="site-instance-form-row">
            <span className="site-instance-form-label" id="site-instance-engine-label">
              {t(MSG.opts_site_instances_field_engine)}
            </span>
            <div
              className="engine-segmented"
              role="radiogroup"
              aria-labelledby="site-instance-engine-label"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const idx = BACKING_ENGINES.indexOf(editor.engineId);
                  const nextId = BACKING_ENGINES[(idx + 1) % BACKING_ENGINES.length];
                  pendingFocusEngine.current = nextId;
                  selectEngine(nextId);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const idx = BACKING_ENGINES.indexOf(editor.engineId);
                  const nextId = BACKING_ENGINES[(idx - 1 + BACKING_ENGINES.length) % BACKING_ENGINES.length];
                  pendingFocusEngine.current = nextId;
                  selectEngine(nextId);
                }
              }}
            >
              {BACKING_ENGINES.map((engineId) => {
                const active = editor.engineId === engineId;
                return (
                  <button
                    key={engineId}
                    ref={(el) => { engineRadioRefs.current[engineId] = el; }}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    className={active ? 'active' : ''}
                    onClick={() => selectEngine(engineId)}
                    data-engine={engineId}
                  >
                    {t(getEngine(engineId).label)}
                  </button>
                );
              })}
            </div>
          </div>

          {constructionChoicesForEditor.length > 0 && (
            <div className="site-instance-form-row">
              <span className="site-instance-form-label" id="site-instance-mode-label">
                {t(MSG.opts_site_instances_field_mode)}
              </span>
              <div
                className="engine-segmented"
                role="radiogroup"
                aria-labelledby="site-instance-mode-label"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const choices = constructionChoicesForEditor;
                    const idx = choices.findIndex((choice) => choice.value === editor.construction);
                    patchEditor({ construction: choices[(idx + 1) % choices.length].value });
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const choices = constructionChoicesForEditor;
                    const idx = choices.findIndex((choice) => choice.value === editor.construction);
                    patchEditor({ construction: choices[(idx - 1 + choices.length) % choices.length].value });
                  }
                }}
              >
                {constructionChoicesForEditor.map((choice) => {
                  const active = editor.construction === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      className={active ? 'active' : ''}
                      onClick={() => patchEditor({ construction: choice.value })}
                      data-construction={choice.value}
                    >
                      {t(choice.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {zhanneiFiltersVisible && (
            <div className="site-instance-form-row site-instance-form-row--filters">
              <span className="site-instance-form-label" id="site-instance-filters-label">
                {t(MSG.opts_site_instances_filters_heading)}
              </span>
              <div className="site-instance-filters" role="group" aria-labelledby="site-instance-filters-label">
                <label className="site-instance-filter-select">
                  <span>{t(MSG.opts_site_instances_filters_time)}</span>
                  <span className="select-wrap">
                    <select
                      value={editor.timeRange}
                      onChange={(e) => {
                        const value = e.target.value;
                        patchEditor({ timeRange: value === '' ? '' : (Number(value) as NonNullable<ZhanneiFilters['timeRange']>) });
                      }}
                    >
                      {TIME_RANGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{t(option.key)}</option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="site-instance-filter-check">
                  <input
                    type="checkbox"
                    checked={editor.sortByTime}
                    onChange={(e) => patchEditor({ sortByTime: e.target.checked })}
                  />
                  <span>{t(MSG.opts_site_instances_filters_sort_by_time)}</span>
                </label>
                <label className="site-instance-filter-check">
                  <input
                    type="checkbox"
                    checked={editor.titleOnly}
                    onChange={(e) => patchEditor({ titleOnly: e.target.checked })}
                  />
                  <span>{t(MSG.opts_site_instances_filters_title_only)}</span>
                </label>
              </div>
            </div>
          )}

          {validation?.preview && (
            <div className="site-instance-preview" aria-live="polite">
              <span className="preview-label">{t(MSG.opts_site_instances_preview_label)}</span>
              <code className="preview-prefix">site:{validation.preview.scope}</code>
              {validation.preview.degraded === 'bing' && (
                <span className="preview-note">{t(MSG.opts_site_instances_degradation_bing)}</span>
              )}
              {validation.preview.degraded === 'baidu' && (
                <span className="preview-note">{t(MSG.opts_site_instances_degradation_baidu)}</span>
              )}
            </div>
          )}

          {showDuplicateError && (
            <p id={duplicateErrorId} className="site-instance-field-error" role="alert">{validation?.duplicateError}</p>
          )}

          <div className="site-instance-form-actions">
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={!validation?.ok || busy}
            >
              {busy
                ? t(MSG.status_saving)
                : editor.mode === 'create'
                  ? t(MSG.opts_site_instances_submit_add)
                  : t(MSG.opts_site_instances_submit_edit)}
            </button>
            <button type="button" onClick={closeEditor} disabled={busy}>
              {t(MSG.opts_site_instances_cancel)}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="site-instance-add-btn"
            onClick={openCreate}
            disabled={atCapacity}
          >
            {t(MSG.opts_site_instances_add)}
          </button>
          {atCapacity && (
            <p className="hint" role="note">{t(MSG.opts_site_instances_limit_reached)}</p>
          )}
        </>
      )}

      <div className="site-instances-list">
        {siteInstances.length === 0 ? (
          <p className="site-instances-empty">{t(MSG.opts_site_instances_empty)}</p>
        ) : (
          siteInstances.map((definition) => {
            const scope = siteScopeForDefinition(definition) ?? definition.target;
            const isConfirming = confirmDeleteId === definition.id;
            return (
              <div
                key={definition.id}
                className={`site-instance-row${editor?.editId === definition.id ? ' site-instance-row--editing' : ''}`}
                data-site-id={definition.id}
              >
                <div className="site-instance-row-info">
                  <span className="site-instance-name">{definition.name}</span>
                  <span className="site-instance-scope">
                    {t(getEngine(definition.engineId).label)} · <code>site:{scope}</code>
                  </span>
                </div>
                <div className="site-instance-row-actions">
                  {isConfirming ? (
                    <>
                      <span className="site-instance-confirm-text" role="alert">
                        {t(MSG.opts_site_instances_confirm_delete, definition.name)}
                      </span>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => doDelete(definition.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_site_instances_confirm_delete_confirm)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busy}
                        autoFocus
                      >
                        {t(MSG.opts_site_instances_cancel)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(definition)}
                        disabled={busy}
                      >
                        {t(MSG.opts_site_instances_edit)}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmDeleteId(definition.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_site_instances_delete)}
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

      <p className="hint site-instances-quickbar-note">{t(MSG.opts_site_instances_managed_in_quickbar)}</p>
    </div>
  );
}
