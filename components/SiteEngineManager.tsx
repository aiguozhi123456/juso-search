import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SiteEngineDefinition, SiteEngineEngineId, SiteEngineId } from '@/lib/site-engines';
import {
  findDuplicateSiteEngineScopes,
  normalizeSiteTarget,
  siteScopeForDefinition,
  siteScopeForTarget,
} from '@/lib/site-engines';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import { getEngine } from '@/lib/engines/registry';

const BACKING_ENGINES: readonly SiteEngineEngineId[] = ['google', 'bing', 'baidu'];

/** UI-side affordances matching backend limits. Defined once to avoid scattering magic numbers. */
const NAME_MAX = 40;
const TARGET_MAX = 2048;
const MAX_SITE_ENGINES = 50;

type EditorFields = {
  name: string;
  target: string;
  engineId: SiteEngineEngineId;
};
type EditorState =
  | ({ mode: 'create'; editId?: never } & EditorFields)
  | ({ mode: 'edit'; editId: SiteEngineId } & EditorFields);

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
  return { mode: 'create', name: '', target: '', engineId: 'google' };
}

/** 实时校验 + 预览：name/target/engineId 任一变化都重算。重复检测排除正在编辑的项。 */
function validate(siteEngines: readonly SiteEngineDefinition[], editor: EditorState): Validation {
  const result: Validation = {
    ok: false,
    nameError: '',
    targetError: '',
    duplicateError: '',
    preview: null,
  };
  const trimmedName = editor.name.trim();
  if (!trimmedName) result.nameError = t(MSG.opts_site_engines_invalid_name);

  const normalized = normalizeSiteTarget(editor.target);
  if (!normalized) {
    result.targetError = t(MSG.opts_site_engines_invalid_target);
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

  // 重复检测：candidate 占位 id 仅用于分组对比，不持久化。
  const candidate: SiteEngineDefinition = {
    id: editor.editId ?? 'site:preview',
    name: trimmedName || '(pending)',
    target: normalized.canonicalUrl,
    engineId: editor.engineId,
  };
  const others = siteEngines.filter((s) => s.id !== editor.editId);
  const duplicates = findDuplicateSiteEngineScopes([...others, candidate]);
  const ours = duplicates.find((g) => g.engineId === editor.engineId && g.scope === scope);
  if (ours) {
    const existing = others.find((s) => ours.siteIds.includes(s.id) && s.id !== candidate.id);
    result.duplicateError = existing
      ? t(MSG.opts_site_engines_duplicate_with_name, existing.name)
      : t(MSG.opts_site_engines_duplicate);
  }

  result.ok = !result.nameError && !result.targetError && !result.duplicateError;
  return result;
}

export function SiteEngineManager({
  siteEngines,
  onChange,
}: {
  siteEngines: readonly SiteEngineDefinition[];
  onChange: () => void;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<SiteEngineId | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [touched, setTouched] = useState<{ name: boolean; target: boolean }>({ name: false, target: false });
  const [submitted, setSubmitted] = useState(false);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const engineRadioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pendingFocusEngine = useRef<SiteEngineEngineId | null>(null);

  const validation = useMemo(() => (editor ? validate(siteEngines, editor) : null), [editor, siteEngines]);
  const busy = status.kind === 'busy';
  const atCapacity = siteEngines.length >= MAX_SITE_ENGINES;

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

  function openEdit(definition: SiteEngineDefinition) {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    // 编辑模式打开时已有值，直接标记 touched 以便即时显示任何冲突（如期间新增了重复项）。
    setTouched({ name: true, target: true });
    setSubmitted(false);
    setEditor({
      mode: 'edit',
      editId: definition.id,
      name: definition.name,
      target: definition.target,
      engineId: definition.engineId,
    });
  }

  function closeEditor() {
    setEditor(null);
  }

  function patchEditor(patch: Partial<EditorFields>) {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
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
    try {
      if (editor.mode === 'create') {
        await sendMessage('createSiteEngine', { name, target, engineId: editor.engineId });
        setStatus({ kind: 'ok', message: t(MSG.opts_site_engines_status_created) });
      } else {
        await sendMessage('updateSiteEngine', {
          id: editor.editId,
          name,
          target,
          engineId: editor.engineId,
        });
        setStatus({ kind: 'ok', message: t(MSG.opts_site_engines_status_updated) });
      }
      setEditor(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_site_engines_status_failed) });
    }
  }

  async function doDelete(id: SiteEngineId) {
    if (busy) return;
    setStatus({ kind: 'busy' });
    try {
      await sendMessage('deleteSiteEngine', id);
      setStatus({ kind: 'ok', message: t(MSG.opts_site_engines_status_deleted) });
      setConfirmDeleteId(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_site_engines_status_failed) });
    }
  }

  // 错误仅在字段被 touched 或表单被 submitted 后显示，避免空白创建表单一打开就报错。
  const showNameError = !!(validation?.nameError && (submitted || touched.name));
  const showTargetError = !!(validation?.targetError && (submitted || touched.target));
  const showDuplicateError = !!(validation?.duplicateError && (submitted || touched.target));

  const nameErrorId = 'site-engine-name-error';
  const targetErrorId = 'site-engine-target-error';
  const duplicateErrorId = 'site-engine-duplicate-error';
  const targetDescribedBy = [showTargetError ? targetErrorId : null, showDuplicateError ? duplicateErrorId : null]
    .filter(Boolean).join(' ') || undefined;

  return (
    <div className="site-engines">
      <p className="hint">{t(MSG.opts_site_engines_hint)}</p>

      {editor ? (
        <div className="site-engine-form" data-mode={editor.mode}>
          <div className="site-engine-form-row">
            <label htmlFor="site-engine-name">{t(MSG.opts_site_engines_field_name)}</label>
            <input
              id="site-engine-name"
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
            <span className="site-engine-field-count" aria-hidden="true">{editor.name.length} / {NAME_MAX}</span>
          </div>
          {showNameError && (
            <p id={nameErrorId} className="site-engine-field-error" role="alert">{validation?.nameError}</p>
          )}

          <div className="site-engine-form-row">
            <label htmlFor="site-engine-target">{t(MSG.opts_site_engines_field_target)}</label>
            <input
              id="site-engine-target"
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
            <span className="site-engine-field-count" aria-hidden="true">{editor.target.length} / {TARGET_MAX}</span>
          </div>
          {showTargetError && (
            <p id={targetErrorId} className="site-engine-field-error" role="alert">{validation?.targetError}</p>
          )}

          <div className="site-engine-form-row">
            <span className="site-engine-form-label" id="site-engine-engine-label">
              {t(MSG.opts_site_engines_field_engine)}
            </span>
            <div
              className="engine-segmented"
              role="radiogroup"
              aria-labelledby="site-engine-engine-label"
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const idx = BACKING_ENGINES.indexOf(editor.engineId);
                  const nextId = BACKING_ENGINES[(idx + 1) % BACKING_ENGINES.length];
                  pendingFocusEngine.current = nextId;
                  patchEditor({ engineId: nextId });
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const idx = BACKING_ENGINES.indexOf(editor.engineId);
                  const nextId = BACKING_ENGINES[(idx - 1 + BACKING_ENGINES.length) % BACKING_ENGINES.length];
                  pendingFocusEngine.current = nextId;
                  patchEditor({ engineId: nextId });
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
                    onClick={() => patchEditor({ engineId })}
                    data-engine={engineId}
                  >
                    {t(getEngine(engineId).label)}
                  </button>
                );
              })}
            </div>
          </div>

          {validation?.preview && (
            <div className="site-engine-preview" aria-live="polite">
              <span className="preview-label">{t(MSG.opts_site_engines_preview_label)}</span>
              <code className="preview-prefix">site:{validation.preview.scope}</code>
              {validation.preview.degraded === 'bing' && (
                <span className="preview-note">{t(MSG.opts_site_engines_degradation_bing)}</span>
              )}
              {validation.preview.degraded === 'baidu' && (
                <span className="preview-note">{t(MSG.opts_site_engines_degradation_baidu)}</span>
              )}
            </div>
          )}

          {showDuplicateError && (
            <p id={duplicateErrorId} className="site-engine-field-error" role="alert">{validation?.duplicateError}</p>
          )}

          <div className="site-engine-form-actions">
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={!validation?.ok || busy}
            >
              {busy
                ? t(MSG.status_saving)
                : editor.mode === 'create'
                  ? t(MSG.opts_site_engines_submit_add)
                  : t(MSG.opts_site_engines_submit_edit)}
            </button>
            <button type="button" onClick={closeEditor} disabled={busy}>
              {t(MSG.opts_site_engines_cancel)}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="site-engine-add-btn"
            onClick={openCreate}
            disabled={atCapacity}
          >
            {t(MSG.opts_site_engines_add)}
          </button>
          {atCapacity && (
            <p className="hint" role="note">{t(MSG.opts_site_engines_limit_reached)}</p>
          )}
        </>
      )}

      <div className="site-engines-list">
        {siteEngines.length === 0 ? (
          <p className="site-engines-empty">{t(MSG.opts_site_engines_empty)}</p>
        ) : (
          siteEngines.map((definition) => {
            const scope = siteScopeForDefinition(definition) ?? definition.target;
            const isConfirming = confirmDeleteId === definition.id;
            return (
              <div
                key={definition.id}
                className={`site-engine-row${editor?.editId === definition.id ? ' site-engine-row--editing' : ''}`}
                data-site-id={definition.id}
              >
                <div className="site-engine-row-info">
                  <span className="site-engine-name">{definition.name}</span>
                  <span className="site-engine-scope">
                    {t(getEngine(definition.engineId).label)} · <code>site:{scope}</code>
                  </span>
                </div>
                <div className="site-engine-row-actions">
                  {isConfirming ? (
                    <>
                      <span className="site-engine-confirm-text" role="alert">
                        {t(MSG.opts_site_engines_confirm_delete, definition.name)}
                      </span>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => doDelete(definition.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_site_engines_confirm_delete_confirm)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busy}
                        autoFocus
                      >
                        {t(MSG.opts_site_engines_cancel)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(definition)}
                        disabled={busy}
                      >
                        {t(MSG.opts_site_engines_edit)}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmDeleteId(definition.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_site_engines_delete)}
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

      <p className="hint site-engines-quickbar-note">{t(MSG.opts_site_engines_managed_in_quickbar)}</p>
    </div>
  );
}
