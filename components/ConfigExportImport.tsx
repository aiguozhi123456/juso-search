import { useRef, useState } from 'react';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import type { ConfigExport, ImportReport, ImportPreview } from '@/lib/config-io';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'exported' }
  | { kind: 'confirming'; payload: ConfigExport; preview: ImportPreview }
  | { kind: 'imported'; report: ImportReport }
  | { kind: 'error'; message: string };

const PREF_LABELS: Record<'activeProvider' | 'activeSource' | 'themePref' | 'localePref', string> = {
  activeProvider: 'activeProvider',
  activeSource: 'activeSource',
  themePref: 'themePref',
  localePref: 'localePref',
};

export function ConfigExportImport({ onImported }: { onImported?: () => void } = {}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = status.kind === 'busy' || status.kind === 'confirming';

  async function handleExport() {
    setStatus({ kind: 'busy' });
    try {
      const reply = await sendMessage('exportConfig', undefined);
      if (reply.ok) {
        setStatus({ kind: 'exported' });
      } else {
        setStatus({ kind: 'error', message: t(MSG.opts_config_export_failed) });
      }
    } catch {
      setStatus({ kind: 'error', message: t(MSG.opts_config_export_failed) });
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 容量护栏：真实导出 < 1KB，给 256KB 余量即可挡住恶意大文件 OOM。
    if (file.size > 256 * 1024) {
      setStatus({ kind: 'error', message: t(MSG.opts_config_import_invalid, 'file_too_large') });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setStatus({ kind: 'busy' });
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ConfigExport;
      // 先 dry-run 预览，拿到 diff 再决定是否需要确认
      const previewReply = await sendMessage('previewImport', parsed);
      if (!previewReply.ok) {
        setStatus({ kind: 'error', message: t(MSG.opts_config_import_invalid, previewReply.error.message) });
        return;
      }
      const hasPrefChanges = previewReply.preview.prefDiffs.length > 0;
      if (hasPrefChanges) {
        // 有 pref 变更：进入确认态，展示 diff，等用户决定
        setStatus({ kind: 'confirming', payload: parsed, preview: previewReply.preview });
      } else {
        // 无 pref 变更：直接导入（applyPrefs=false 也无副作用）
        await doImport(parsed, false);
      }
    } catch {
      setStatus({ kind: 'error', message: t(MSG.opts_config_import_invalid, 'invalid_format') });
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function doImport(payload: ConfigExport, applyPrefs: boolean) {
    setStatus({ kind: 'busy' });
    try {
      const reply = await sendMessage('importConfig', { payload, applyPrefs });
      if (reply.ok) {
        onImported?.();
        setStatus({ kind: 'imported', report: reply.report });
      } else {
        setStatus({ kind: 'error', message: t(MSG.opts_config_import_invalid, reply.error.message) });
      }
    } catch {
      setStatus({ kind: 'error', message: t(MSG.opts_config_import_invalid, 'invalid_format') });
    }
  }

  function cancelConfirm() {
    setStatus({ kind: 'idle' });
  }

  function prefLabel(key: 'activeProvider' | 'activeSource' | 'themePref' | 'localePref'): string {
    return t(`opts_pref_${PREF_LABELS[key]}`);
  }

  function importReportPrefs(report: ImportReport): string {
    const labels = [];
    if (report.activeProviderOverridden) labels.push(prefLabel('activeProvider'));
    if (report.activeSourceOverridden) labels.push(prefLabel('activeSource'));
    if (report.themePrefOverridden) labels.push(prefLabel('themePref'));
    if (report.localePrefOverridden) labels.push(prefLabel('localePref'));
    return labels.length > 0 ? t(MSG.opts_config_import_report_prefs, labels.join(' / ')) : '';
  }

  return (
    <div className="config-io">
      <p className="hint">{t(MSG.opts_config_io_hint)}</p>
      <p className="hint warning">{t(MSG.opts_config_key_warning)}</p>
      <div className="config-io-actions">
        <button onClick={handleExport} disabled={busy}>
          {status.kind === 'busy' ? t(MSG.status_saving) : t(MSG.opts_config_export)}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />
        <button onClick={() => fileRef.current?.click()} disabled={busy}>
          {t(MSG.opts_config_import)}
        </button>
      </div>
      {status.kind === 'exported' && (
        <p className="status ok">{t(MSG.opts_config_exported)}</p>
      )}
      {status.kind === 'confirming' && (
        <div className="config-confirm">
          <p className="status">
            {t(MSG.opts_config_import_preview_keys, [String(status.preview.written.length), String(status.preview.skipped.length)])}
          </p>
          {status.preview.prefDiffs.length > 0 && (
            <>
              <p className="status warning">{t(MSG.opts_config_import_pref_changes)}</p>
              <ul className="pref-diffs">
                {status.preview.prefDiffs.map((d) => (
                  <li key={d.key}>
                    {prefLabel(d.key)}: <code>{String(d.from ?? '—')}</code> → <code>{String(d.to ?? '—')}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="config-io-actions">
            <button onClick={() => doImport(status.payload, true)}>{t(MSG.opts_config_import_confirm)}</button>
            <button onClick={() => doImport(status.payload, false)}>{t(MSG.opts_config_import_keys_only)}</button>
            <button onClick={cancelConfirm}>{t(MSG.opts_config_import_cancel)}</button>
          </div>
        </div>
      )}
      {status.kind === 'imported' && (
        <p className="status ok">
          {t(MSG.opts_config_imported)}{' '}
          {t(MSG.opts_config_import_report_keys, [String(status.report.written.length), String(status.report.skipped.length)])}{' '}
          {importReportPrefs(status.report)}
        </p>
      )}
      {status.kind === 'error' && (
        <p className="status fail">{status.message}</p>
      )}
    </div>
  );
}
