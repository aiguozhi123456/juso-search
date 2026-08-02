import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomEngineDefinition, CustomEngineId } from '@/lib/custom-engines';
import {
  buildCustomEngineUrl,
  findDuplicateCustomEngineUrls,
  normalizeCustomEngineUrlTemplate,
  MAX_CUSTOM_ENGINES,
  MAX_CUSTOM_ENGINE_NAME_LENGTH,
  MAX_CUSTOM_ENGINE_URL_LENGTH,
} from '@/lib/custom-engines';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';

type EditorFields = {
  name: string;
  urlTemplate: string;
};
type EditorState =
  | ({ mode: 'create'; editId?: never } & EditorFields)
  | ({ mode: 'edit'; editId: CustomEngineId } & EditorFields);

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'fail'; message: string };

interface Validation {
  ok: boolean;
  nameError: string;
  urlError: string;
  duplicateError: string;
  previewUrl: string | null;
}

function emptyEditor(): EditorState {
  return { mode: 'create', name: '', urlTemplate: '' };
}

/** 实时校验 + 预览：name/urlTemplate 任一变化都重算。重复检测排除正在编辑的项。 */
function validate(customEngines: readonly CustomEngineDefinition[], editor: EditorState): Validation {
  const result: Validation = {
    ok: false,
    nameError: '',
    urlError: '',
    duplicateError: '',
    previewUrl: null,
  };
  const trimmedName = editor.name.trim();
  if (!trimmedName) result.nameError = t(MSG.opts_custom_engines_invalid_name);

  const normalized = normalizeCustomEngineUrlTemplate(editor.urlTemplate);
  if (!normalized) {
    result.urlError = t(MSG.opts_custom_engines_invalid_url);
    return result;
  }

  result.previewUrl = buildCustomEngineUrl(normalized, 'example');

  // 重复检测：candidate 占位 id 仅用于分组对比，不持久化。
  const candidate: CustomEngineDefinition = {
    id: editor.editId ?? 'custom:preview',
    name: trimmedName || '(pending)',
    urlTemplate: normalized,
  };
  const others = customEngines.filter((c) => c.id !== editor.editId);
  const duplicates = findDuplicateCustomEngineUrls([...others, candidate]);
  const ours = duplicates.find((g) => g.urlTemplate === normalized);
  if (ours) {
    const existing = others.find((c) => ours.ids.includes(c.id) && c.id !== candidate.id);
    result.duplicateError = existing
      ? t(MSG.opts_custom_engines_duplicate_with_name, existing.name)
      : t(MSG.opts_custom_engines_duplicate);
  }

  result.ok = !result.nameError && !result.urlError && !result.duplicateError;
  return result;
}

export function CustomEngineManager({
  customEngines,
  onChange,
}: {
  customEngines: readonly CustomEngineDefinition[];
  onChange: () => void;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<CustomEngineId | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [touched, setTouched] = useState<{ name: boolean; url: boolean }>({ name: false, url: false });
  const [submitted, setSubmitted] = useState(false);
  const nameFieldRef = useRef<HTMLInputElement>(null);

  const validation = useMemo(() => (editor ? validate(customEngines, editor) : null), [editor, customEngines]);
  const busy = status.kind === 'busy';
  const atCapacity = customEngines.length >= MAX_CUSTOM_ENGINES;

  // 表单打开时聚焦名称输入框；编辑模式切到不同记录时也重新聚焦。
  const focusKey = editor ? `${editor.mode}:${editor.editId ?? ''}` : null;
  useEffect(() => {
    if (focusKey) nameFieldRef.current?.focus();
  }, [focusKey]);

  function openCreate() {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    setTouched({ name: false, url: false });
    setSubmitted(false);
    setEditor(emptyEditor());
  }

  function openEdit(definition: CustomEngineDefinition) {
    setConfirmDeleteId(null);
    setStatus({ kind: 'idle' });
    // 编辑模式打开时已有值，直接标记 touched 以便即时显示任何冲突（如期间新增了重复项）。
    setTouched({ name: true, url: true });
    setSubmitted(false);
    setEditor({
      mode: 'edit',
      editId: definition.id,
      name: definition.name,
      urlTemplate: definition.urlTemplate,
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
    const urlTemplate = editor.urlTemplate.trim();
    try {
      if (editor.mode === 'create') {
        await sendMessage('createCustomEngine', { name, urlTemplate });
        setStatus({ kind: 'ok', message: t(MSG.opts_custom_engines_status_created) });
      } else {
        await sendMessage('updateCustomEngine', {
          id: editor.editId,
          name,
          urlTemplate,
        });
        setStatus({ kind: 'ok', message: t(MSG.opts_custom_engines_status_updated) });
      }
      setEditor(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_custom_engines_status_failed) });
    }
  }

  async function doDelete(id: CustomEngineId) {
    if (busy) return;
    setStatus({ kind: 'busy' });
    try {
      await sendMessage('deleteCustomEngine', id);
      setStatus({ kind: 'ok', message: t(MSG.opts_custom_engines_status_deleted) });
      setConfirmDeleteId(null);
      onChange();
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.opts_custom_engines_status_failed) });
    }
  }

  // 错误仅在字段被 touched 或表单被 submitted 后显示，避免空白创建表单一打开就报错。
  const showNameError = !!(validation?.nameError && (submitted || touched.name));
  const showUrlError = !!(validation?.urlError && (submitted || touched.url));
  const showDuplicateError = !!(validation?.duplicateError && (submitted || touched.url));

  const nameErrorId = 'custom-engine-name-error';
  const urlErrorId = 'custom-engine-url-error';
  const duplicateErrorId = 'custom-engine-duplicate-error';
  const urlDescribedBy = [showUrlError ? urlErrorId : null, showDuplicateError ? duplicateErrorId : null]
    .filter(Boolean).join(' ') || undefined;

  return (
    <div className="custom-engines">
      <p className="hint">{t(MSG.opts_custom_engines_hint)}</p>

      {editor ? (
        <div className="custom-engine-form" data-mode={editor.mode}>
          <div className="custom-engine-form-row">
            <label htmlFor="custom-engine-name">{t(MSG.opts_custom_engines_field_name)}</label>
            <input
              id="custom-engine-name"
              ref={nameFieldRef}
              type="text"
              value={editor.name}
              maxLength={MAX_CUSTOM_ENGINE_NAME_LENGTH}
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
            <span className="custom-engine-field-count" aria-hidden="true">{editor.name.length} / {MAX_CUSTOM_ENGINE_NAME_LENGTH}</span>
          </div>
          {showNameError && (
            <p id={nameErrorId} className="custom-engine-field-error" role="alert">{validation?.nameError}</p>
          )}

          <div className="custom-engine-form-row">
            <label htmlFor="custom-engine-url">{t(MSG.opts_custom_engines_field_url)}</label>
            <input
              id="custom-engine-url"
              type="url"
              value={editor.urlTemplate}
              maxLength={MAX_CUSTOM_ENGINE_URL_LENGTH}
              onChange={(e) => {
                patchEditor({ urlTemplate: e.target.value });
                setTouched((prev) => ({ ...prev, url: true }));
              }}
              onBlur={() => setTouched((prev) => ({ ...prev, url: true }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
              }}
              placeholder="https://example.com/search?q=%s"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={showUrlError || showDuplicateError}
              aria-describedby={urlDescribedBy}
            />
            <span className="custom-engine-field-count" aria-hidden="true">{editor.urlTemplate.length} / {MAX_CUSTOM_ENGINE_URL_LENGTH}</span>
          </div>
          {showUrlError && (
            <p id={urlErrorId} className="custom-engine-field-error" role="alert">{validation?.urlError}</p>
          )}

          {validation?.previewUrl && (
            <div className="custom-engine-preview" aria-live="polite">
              <span className="preview-label">{t(MSG.opts_custom_engines_preview_label)}</span>
              <code className="preview-url">{validation.previewUrl}</code>
            </div>
          )}

          {showDuplicateError && (
            <p id={duplicateErrorId} className="custom-engine-field-error" role="alert">{validation?.duplicateError}</p>
          )}

          <div className="custom-engine-form-actions">
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={!validation?.ok || busy}
            >
              {busy
                ? t(MSG.status_saving)
                : editor.mode === 'create'
                  ? t(MSG.opts_custom_engines_submit_add)
                  : t(MSG.opts_custom_engines_submit_edit)}
            </button>
            <button type="button" onClick={closeEditor} disabled={busy}>
              {t(MSG.opts_custom_engines_cancel)}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="custom-engine-add-btn"
            onClick={openCreate}
            disabled={atCapacity}
          >
            {t(MSG.opts_custom_engines_add)}
          </button>
          {atCapacity && (
            <p className="hint" role="note">{t(MSG.opts_custom_engines_limit_reached)}</p>
          )}
        </>
      )}

      <div className="custom-engines-list">
        {customEngines.length === 0 ? (
          <p className="custom-engines-empty">{t(MSG.opts_custom_engines_empty)}</p>
        ) : (
          customEngines.map((definition) => {
            const isConfirming = confirmDeleteId === definition.id;
            return (
              <div
                key={definition.id}
                className={`custom-engine-row${editor?.editId === definition.id ? ' custom-engine-row--editing' : ''}`}
                data-custom-id={definition.id}
              >
                <div className="custom-engine-row-info">
                  <span className="custom-engine-name">{definition.name}</span>
                  <span className="custom-engine-url-display">
                    <code>{definition.urlTemplate}</code>
                  </span>
                </div>
                <div className="custom-engine-row-actions">
                  {isConfirming ? (
                    <>
                      <span className="custom-engine-confirm-text" role="alert">
                        {t(MSG.opts_custom_engines_confirm_delete, definition.name)}
                      </span>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => doDelete(definition.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_custom_engines_confirm_delete_confirm)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={busy}
                        autoFocus
                      >
                        {t(MSG.opts_custom_engines_cancel)}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(definition)}
                        disabled={busy}
                      >
                        {t(MSG.opts_custom_engines_edit)}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirmDeleteId(definition.id)}
                        disabled={busy}
                      >
                        {t(MSG.opts_custom_engines_delete)}
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

      <p className="hint custom-engines-quickbar-note">{t(MSG.opts_custom_engines_managed_in_quickbar)}</p>
    </div>
  );
}
