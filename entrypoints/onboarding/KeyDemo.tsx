import { useState } from 'react';
import { t, MSG } from '@/lib/i18n';
import { DemoCursor } from './CursorRipple';

// 配置密钥示意：结构与样式直接建在设置页真实 .key-row 上（options/styles.css，
// main.tsx 引入；DOM 镜像 KeyInput.tsx 的行结构）——provider 标签 + 已配置徽章
// （label + .configured）、password 输入框、「保存 / 测试」按钮、行下状态文字
// （.status 两态）。视觉（grid、label 字重、input 聚焦环、按钮描边、status 颜色）
// 全部来自 options 表；演示层只补：输入打字覆盖层（input 是 void 元素，逐字掩码
// 点由覆盖层承载）、聚焦/按压/解禁/状态的相位动画（见 styles.css 逐条注释）。
// 10s 循环：光标点输入框 → 粘掩码 key（打字点入）→ 点「保存」→
// 状态走 保存中… → 已保存（success 绿），输入清空、「已配置」徽章 pop、「测试」解禁。
// 动画纯 CSS；打字点为 one-shot，靠 kd-fade 的 animationiteration 换 key 重挂子树，
// 每轮从零完整重播（同 WelcomeDemo 机制，无漂移、无缝衔接）。
const KEY_DOT_COUNT = 12;

export function KeyDemo() {
  // 每轮循环边界（kd-fade 迭代）重挂子树：one-shot 打字点随之重播。
  const [cycle, setCycle] = useState(0);

  return (
    <div
      className="onboarding-kd-demo"
      aria-hidden="true"
      inert
      onAnimationIteration={(e) => {
        if (e.animationName === 'kd-fade') setCycle((c) => c + 1);
      }}
    >
      {/* 静态框：分组标题 + BYOK 提示常驻（同真实 key 分组排版），跨循环不淡出 */}
      <div className="onboarding-kd-page">
        <h3 className="onboarding-kd-heading">{t(MSG.opts_apikey_heading)}</h3>
        <p className="onboarding-kd-hint">{t(MSG.opts_apikey_hint)}</p>
        <div className="onboarding-kd-cycle" key={cycle}>
          <div className="onboarding-kd-stage">
            {/* 真实 .key-row：label(90px) | input(1fr) | 保存 | 测试 + 两态 .status
                （列宽收窄等覆盖见 styles.css；真实结构无删除钮列与 max-results 子行） */}
            <div className="key-row">
              <label>
                {t(MSG.provider_tavily)}
                <span className="configured">{t(MSG.configured_badge)}</span>
              </label>
              {/* input 为 void 元素：真实 <input> 撑样式，placeholder → 掩码点 →
                  插入符的打字分层由同位覆盖层承载（字号/内距同值，见 styles.css） */}
              <span className="onboarding-kd-inputwrap">
                <input type="password" tabIndex={-1} readOnly autoComplete="off" spellCheck={false} />
                <span className="onboarding-kd-type">
                  <span className="onboarding-kd-placeholder">{t(MSG.placeholder_paste_key)}</span>
                  <span className="onboarding-kd-dots">
                    {Array.from({ length: KEY_DOT_COUNT }, (_, i) => (
                      <span key={i} className="onboarding-kd-dot" style={{ animationDelay: `${0.9 + i * 0.11}s` }}>
                        •
                      </span>
                    ))}
                  </span>
                  <span className="onboarding-kd-caretwin">
                    <span className="onboarding-kd-caret" />
                  </span>
                </span>
              </span>
              <button type="button" tabIndex={-1} className="onboarding-kd-save">{t(MSG.btn_save)}</button>
              <button type="button" tabIndex={-1} className="onboarding-kd-test">{t(MSG.btn_test)}</button>
              <span className="status onboarding-kd-status__saving">{t(MSG.status_saving)}</span>
              <span className="status ok onboarding-kd-status__ok">{t(MSG.status_saved)}</span>
            </div>

            <DemoCursor cursorClass="onboarding-kd-cursor" rippleClass="onboarding-kd-ripple" />
          </div>
        </div>
      </div>
    </div>
  );
}
