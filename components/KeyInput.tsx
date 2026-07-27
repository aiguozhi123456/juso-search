import type { ProviderAdapter, ProviderId } from '@/lib/providers/types';
import { useEffect, useRef, useState } from 'react';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import { TrashIcon } from './icons';

type Status = { kind: 'idle' | 'saving' | 'testing' | 'deleting' | 'ok' | 'fail'; message: string };
type MaxStatus = { kind: 'idle' | 'saving' | 'ok' | 'fail'; message: string };

export function KeyInput({
  provider,
  configured,
  onConfigured,
  onRemoved,
  maxResults,
  onMaxResultsChange,
}: {
  provider: ProviderAdapter;
  configured: boolean;
  onConfigured?: (id: ProviderId) => void;
  onRemoved?: (id: ProviderId) => void;
  maxResults?: number;
  onMaxResultsChange?: (id: ProviderId, maxResults: number | undefined) => void;
}) {
  const [val, setVal] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [maxVal, setMaxVal] = useState<string>(maxResults?.toString() ?? '');
  const [maxStatus, setMaxStatus] = useState<MaxStatus>({ kind: 'idle', message: '' });
  // 防止 blur + click 双触发 saveMaxResults：按钮 onMouseDown preventDefault 阻止 input 失焦，
  // 但仍保留 ref 兜底，确保同一值不会发起两次请求。
  const maxSavingRef = useRef(false);

  // 外部 prop 变化时同步本地输入（如配置导入 / worker 回写）。
  useEffect(() => {
    setMaxVal(maxResults?.toString() ?? '');
  }, [maxResults]);

  async function save() {
    setStatus({ kind: 'saving', message: '' });
    try {
      await sendMessage('saveProviderKey', { providerId: provider.id, key: val });
      onConfigured?.(provider.id);
      setVal(''); // 明文用完即清，缩短在页面中的留存
      setStatus({ kind: 'ok', message: t(MSG.status_saved) });
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.status_save_failed) });
    }
  }

  async function test() {
    setStatus({ kind: 'testing', message: '' });
    try {
      const reply = await sendMessage('testKey', provider.id);
      setStatus(
        reply.ok
          ? { kind: 'ok', message: t(MSG.status_validated) }
          : { kind: 'fail', message: reply.error.message },
      );
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.status_test_failed) });
    }
  }

  async function del() {
    if (!window.confirm(t(MSG.confirm_delete_key, t(provider.label)))) return;
    setStatus({ kind: 'deleting', message: '' });
    try {
      await sendMessage('deleteProviderKey', provider.id);
      onRemoved?.(provider.id);
      setVal('');
      setStatus({ kind: 'ok', message: t(MSG.status_deleted) });
    } catch {
      setStatus({ kind: 'fail', message: t(MSG.status_delete_failed) });
    }
  }

  async function saveMaxResults() {
    if (maxSavingRef.current) return; // 防止 blur + click 双触发
    const trimmed = maxVal.trim();
    // 留空 = 恢复默认：清除已存储的 maxResults，让适配器走默认值。
    if (trimmed === '') {
      if (maxResults === undefined) return; // 本就未设置，no-op
      maxSavingRef.current = true;
      setMaxStatus({ kind: 'saving', message: '' });
      try {
        await sendMessage('clearProviderMaxResults', provider.id);
        onMaxResultsChange?.(provider.id, undefined as never);
        setMaxStatus({ kind: 'ok', message: t(MSG.opts_max_results_saved) });
      } catch {
        setMaxStatus({ kind: 'fail', message: t(MSG.opts_max_results_save_failed) });
      } finally {
        maxSavingRef.current = false;
      }
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(n) || n < 1 || n > 20) return;
    maxSavingRef.current = true;
    setMaxStatus({ kind: 'saving', message: '' });
    try {
      await sendMessage('setProviderMaxResults', { providerId: provider.id, maxResults: n });
      onMaxResultsChange?.(provider.id, n);
      setMaxStatus({ kind: 'ok', message: t(MSG.opts_max_results_saved) });
    } catch {
      setMaxStatus({ kind: 'fail', message: t(MSG.opts_max_results_save_failed) });
    } finally {
      maxSavingRef.current = false;
    }
  }

  const busy = status.kind === 'saving' || status.kind === 'testing' || status.kind === 'deleting';
  // 有未保存的输入时不允许"测试"（测试只校验已存储的 key）
  const testDisabled = !configured || !!val || busy;
  const maxBusy = maxStatus.kind === 'saving';

  return (
    <div className="key-row">
      <label>
        {t(provider.label)}
        {configured && <span className="configured">{t(MSG.configured_badge)}</span>}
      </label>
      <input
        type="password"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={configured ? t(MSG.placeholder_new_key) : t(MSG.placeholder_paste_key)}
        autoComplete="new-password"
        spellCheck={false}
      />
      <button onClick={save} disabled={!val || busy}>
        {t(MSG.btn_save)}
      </button>
      <button onClick={test} disabled={testDisabled}>
        {t(MSG.btn_test)}
      </button>
      {configured && (
        <button onClick={del} disabled={busy}>
          <TrashIcon size={14} />
          <span>{t(MSG.btn_delete)}</span>
        </button>
      )}
      {busy && (
        <span className="status">
          {status.kind === 'saving'
            ? t(MSG.status_saving)
            : status.kind === 'testing'
              ? t(MSG.status_testing)
              : t(MSG.status_deleting)}
        </span>
      )}
      {!busy && status.message && <span className={`status ${status.kind}`}>{status.message}</span>}
      <div className="key-row__max-results">
        <label>{t(MSG.opts_max_results_label)}</label>
        <input
          type="number"
          min={1}
          max={20}
          step={1}
          value={maxVal}
          onChange={(e) => setMaxVal(e.target.value)}
          onBlur={saveMaxResults}
          disabled={maxBusy}
        />
        <button
          onClick={saveMaxResults}
          onMouseDown={(e) => e.preventDefault()}
          disabled={maxBusy}
        >
          {t(MSG.btn_save)}
        </button>
        {maxBusy && <span className="status">{t(MSG.status_saving)}</span>}
        {!maxBusy && maxStatus.message && (
          <span className={`status ${maxStatus.kind}`}>{maxStatus.message}</span>
        )}
        <p className="hint">{t(MSG.opts_max_results_hint)}</p>
      </div>
    </div>
  );
}
