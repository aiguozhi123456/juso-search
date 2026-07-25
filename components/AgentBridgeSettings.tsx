import { useEffect, useState } from 'react';
import {
  getAgentBridgeEnabled,
  getEngineSearchEnabled,
  setAgentBridgeEnabled,
  setEngineSearchEnabled,
} from '@/lib/storage';
import { t, MSG } from '@/lib/i18n';

// Agent Bridge 门控设置（默认关闭，上架合规）。
//   - 总开关：控制整个 Agent Bridge（search / list-providers / engine-search 三 action）。
//   - 子开关：仅控制 engine-search action；UI 上仅当总开关 on 时可点。
// 偏好直写 chrome.storage.local（worker 读），不经过 messaging；初始挂载时读一次。
export function AgentBridgeSettings() {
  const [bridgeEnabled, setBridgeEnabledState] = useState<boolean>(false);
  const [engineEnabled, setEngineEnabledState] = useState<boolean>(false);

  useEffect(() => {
    void (async () => {
      setBridgeEnabledState(await getAgentBridgeEnabled());
      setEngineEnabledState(await getEngineSearchEnabled());
    })();
  }, []);

  async function onToggleBridge(next: boolean) {
    setBridgeEnabledState(next);
    await setAgentBridgeEnabled(next);
  }

  async function onToggleEngine(next: boolean) {
    setEngineEnabledState(next);
    await setEngineSearchEnabled(next);
  }

  return (
    <div className="agent-bridge-settings">
      <label className="agent-bridge-row">
        <input
          type="checkbox"
          checked={bridgeEnabled}
          onChange={(e) => void onToggleBridge(e.target.checked)}
        />
        <span>{t(MSG.opts_agent_bridge_enable)}</span>
      </label>
      <label className={`agent-bridge-row${bridgeEnabled ? '' : ' agent-bridge-row--disabled'}`}>
        <input
          type="checkbox"
          checked={engineEnabled}
          disabled={!bridgeEnabled}
          onChange={(e) => void onToggleEngine(e.target.checked)}
        />
        <span>
          {t(MSG.opts_agent_bridge_engine_search)}
          {!bridgeEnabled && <span className="agent-bridge-disabled-note"> · {t(MSG.opts_agent_bridge_enable)}</span>}
        </span>
      </label>
      <p className="hint">{t(MSG.opts_agent_bridge_engine_search_hint)}</p>
    </div>
  );
}
