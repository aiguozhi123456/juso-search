import { useEffect, useState } from 'react';
import type { ProviderId } from '@/lib/providers/types';
import { allProviders } from '@/lib/providers/registry';
import { getActiveProviderId, setActiveProviderId } from '@/lib/storage';
import { KeyInput } from '@/components/KeyInput';

export default function App() {
  const providers = allProviders();
  const [active, setActive] = useState<ProviderId | null>(null);

  useEffect(() => {
    void getActiveProviderId().then(setActive);
  }, []);

  async function choose(id: ProviderId) {
    await setActiveProviderId(id);
    setActive(id);
  }

  return (
    <div className="options">
      <h1>AI Search · 设置</h1>

      <section>
        <h2>激活的搜索引擎</h2>
        <select value={active ?? ''} onChange={(e) => choose(e.target.value as ProviderId)}>
          <option value="" disabled>
            选择…
          </option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.supportsAnswer ? '' : '（无 AI 答案）'}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h2>API Key（BYOK，仅存本地）</h2>
        <p className="hint">key 只保存在本机 chrome.storage.local，仅由后台脚本发往所选 provider，不会上传第三方。</p>
        {providers.map((p) => (
          <KeyInput key={p.id} provider={p} />
        ))}
      </section>
    </div>
  );
}
