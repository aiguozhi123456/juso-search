import { useEffect, useState } from 'react';
import { sendMessage } from '@/lib/messaging';
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
// 配套 Agent Skill 下载：点击 → sendMessage('packageAgentSkill') → worker 打包并触发
// 下载，页面据返回更新状态文案。交互模式镜像 ConfigExportImport 的 handleExport。
type SkillStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'done' }
  | { kind: 'failed'; error: string };

export function AgentBridgeSettings() {
  const [bridgeEnabled, setBridgeEnabledState] = useState<boolean>(false);
  const [engineEnabled, setEngineEnabledState] = useState<boolean>(false);
  const [skillStatus, setSkillStatus] = useState<SkillStatus>({ kind: 'idle' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [bridge, engine] = await Promise.all([
          getAgentBridgeEnabled(),
          getEngineSearchEnabled(),
        ]);
        if (!alive) return;
        setBridgeEnabledState(bridge);
        setEngineEnabledState(engine);
      } catch {
        // 读失败（扩展上下文失效 / storage 不可用）保留默认值 false，不写 state，
        // 也不让 rejection 悬空成为 unhandled promise rejection。
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function onToggleBridge(next: boolean) {
    const previous = bridgeEnabled;
    // 乐观更新 + 写入失败回滚（镜像 useTheme/useStyle/useLocale 惯例）：安全门控开关
    // 最坏的方向是「UI 显示已关、worker 仍读旧值开」，失败必须弹回真实状态。
    setBridgeEnabledState(next);
    void setAgentBridgeEnabled(next).catch(() => setBridgeEnabledState(previous));
  }

  function onToggleEngine(next: boolean) {
    const previous = engineEnabled;
    setEngineEnabledState(next);
    void setEngineSearchEnabled(next).catch(() => setEngineEnabledState(previous));
  }

  async function handleDownload() {
    setSkillStatus({ kind: 'pending' });
    try {
      const reply = await sendMessage('packageAgentSkill', undefined);
      if (reply.ok) {
        setSkillStatus({ kind: 'done' });
      } else {
        setSkillStatus({ kind: 'failed', error: reply.error });
      }
    } catch (e) {
      setSkillStatus({ kind: 'failed', error: e instanceof Error ? e.message : '' });
    }
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
      <div className="agent-skill-download">
        <h3>{t(MSG.opts_agent_skill_heading)}</h3>
        <p className="hint">{t(MSG.opts_agent_skill_hint)}</p>
        <div className="config-io-actions">
          <button onClick={handleDownload} disabled={skillStatus.kind === 'pending'}>
            {t(MSG.opts_agent_skill_download)}
          </button>
        </div>
        {skillStatus.kind === 'pending' && <p className="status">{t(MSG.opts_agent_skill_pending)}</p>}
        {skillStatus.kind === 'done' && <p className="status ok">{t(MSG.opts_agent_skill_done)}</p>}
        {skillStatus.kind === 'failed' && (
          <p className="status fail">{t(MSG.opts_agent_skill_failed, skillStatus.error)}</p>
        )}
      </div>
    </div>
  );
}
