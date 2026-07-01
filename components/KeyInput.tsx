import { useEffect, useState } from 'react';
import type { ProviderAdapter } from '@/lib/providers/types';
import { hasKey, setKey } from '@/lib/storage';
import { sendMessage } from '@/lib/messaging';

type Status = { kind: 'idle' | 'saving' | 'testing' | 'ok' | 'fail'; message: string };

export function KeyInput({ provider }: { provider: ProviderAdapter }) {
  const [val, setVal] = useState('');
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  useEffect(() => {
    void hasKey(provider.id).then(setConfigured);
  }, [provider.id]);

  async function save() {
    setStatus({ kind: 'saving', message: '' });
    try {
      await setKey(provider.id, val);
      setConfigured(true);
      setVal(''); // 明文用完即清，缩短在页面中的留存
      setStatus({ kind: 'ok', message: '已保存' });
    } catch {
      setStatus({ kind: 'fail', message: '保存失败' });
    }
  }

  async function test() {
    setStatus({ kind: 'testing', message: '' });
    try {
      const reply = await sendMessage('testKey', provider.id);
      setStatus(
        reply.ok
          ? { kind: 'ok', message: '验证通过' }
          : { kind: 'fail', message: reply.error.message },
      );
    } catch {
      setStatus({ kind: 'fail', message: '测试失败，请稍后重试' });
    }
  }

  const busy = status.kind === 'saving' || status.kind === 'testing';
  // 有未保存的输入时不允许"测试"（测试只校验已存储的 key）
  const testDisabled = !configured || !!val || busy;

  return (
    <div className="key-row">
      <label>
        {provider.label}
        {configured && <span className="configured"> · 已配置</span>}
      </label>
      <input
        type="password"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={configured ? '输入新 key 覆盖' : '粘贴 API key'}
        autoComplete="new-password"
        spellCheck={false}
      />
      <button onClick={save} disabled={!val || busy}>
        保存
      </button>
      <button onClick={test} disabled={testDisabled}>
        测试
      </button>
      {busy && <span className="status">{status.kind === 'saving' ? '保存中…' : '测试中…'}</span>}
      {!busy && status.message && <span className={`status ${status.kind}`}>{status.message}</span>}
    </div>
  );
}
