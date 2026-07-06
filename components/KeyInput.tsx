import type { ProviderAdapter, ProviderId } from '@/lib/providers/types';
import { useState } from 'react';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';

type Status = { kind: 'idle' | 'saving' | 'testing' | 'ok' | 'fail'; message: string };

export function KeyInput({
  provider,
  configured,
  onConfigured,
}: {
  provider: ProviderAdapter;
  configured: boolean;
  onConfigured?: (id: ProviderId) => void;
}) {
  const [val, setVal] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

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

  const busy = status.kind === 'saving' || status.kind === 'testing';
  // 有未保存的输入时不允许"测试"（测试只校验已存储的 key）
  const testDisabled = !configured || !!val || busy;

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
      {busy && <span className="status">{status.kind === 'saving' ? t(MSG.status_saving) : t(MSG.status_testing)}</span>}
      {!busy && status.message && <span className={`status ${status.kind}`}>{status.message}</span>}
    </div>
  );
}
