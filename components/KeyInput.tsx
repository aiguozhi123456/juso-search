import type { ProviderAdapter, ProviderId } from '@/lib/providers/types';
import { useEffect, useRef, useState } from 'react';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';
import { MinusIcon, PlusIcon, TrashIcon } from './icons';

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

  async function saveMaxResults(overrideValue?: string) {
    if (maxSavingRef.current) return; // 防止 blur + click 双触发
    const trimmed = (overrideValue ?? maxVal).trim();
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

  /** 步进按钮 ±1，clamp 到 1–20 后立即保存。onMouseDown preventDefault 已阻止
   *  input 失焦，故此处直接用新值调用 saveMaxResults，避免读到陈旧 state。 */
  function stepBy(delta: number) {
    const trimmed = maxVal.trim();
    const parsed = trimmed === '' ? NaN : Number.parseInt(trimmed, 10);
    const base = Number.isInteger(parsed) ? parsed : 0;
    const next = Math.min(20, Math.max(1, base + delta));
    const nextStr = next.toString();
    setMaxVal(nextStr);
    saveMaxResults(nextStr);
  }

  const busy = status.kind === 'saving' || status.kind === 'testing' || status.kind === 'deleting';
  // 有未保存的输入时不允许"测试"（测试只校验已存储的 key）
  const testDisabled = !configured || !!val || busy;
  const maxBusy = maxStatus.kind === 'saving';
  // 步进边界：留空或 ≤1 时禁用「−」，≥20 时禁用「+」
  const maxNum = maxVal.trim() === '' ? NaN : Number.parseInt(maxVal.trim(), 10);
  const hasMaxNum = Number.isInteger(maxNum);
  const atMin = !hasMaxNum || maxNum <= 1;
  const atMax = hasMaxNum && maxNum >= 20;

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
        <label htmlFor={`max-results-${provider.id}`}>{t(MSG.opts_max_results_label)}</label>
        <div className="stepper">
          <button
            type="button"
            className="stepper__btn"
            aria-label={t(MSG.opts_max_results_decrease)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => stepBy(-1)}
            disabled={maxBusy || atMin}
          >
            <MinusIcon size={14} />
          </button>
          <input
            id={`max-results-${provider.id}`}
            type="number"
            min={1}
            max={20}
            step={1}
            value={maxVal}
            onChange={(e) => setMaxVal(e.target.value)}
            onBlur={() => saveMaxResults()}
            disabled={maxBusy}
            className="stepper__input"
          />
          <button
            type="button"
            className="stepper__btn"
            aria-label={t(MSG.opts_max_results_increase)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => stepBy(1)}
            disabled={maxBusy || atMax}
          >
            <PlusIcon size={14} />
          </button>
        </div>
        <button
          onClick={() => saveMaxResults()}
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
