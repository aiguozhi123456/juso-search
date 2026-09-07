import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { allSources, resolveIconUrl, sourceLabel, type SearchSource } from '@/lib/sources';
import { t, MSG } from '@/lib/i18n';
import { useTheme } from '@/lib/useTheme';
import { selectionSearchStyles } from '@/entrypoints/shared/selection-search-styles';

// 划词搜索示意：模拟网页文本被选中（高亮扫过）→ 真实划词弹窗出现 → 展开来源
// 列表并悬停一项。纯 CSS 8s 循环，无 JS 状态机。
// 叙事文案走正规 i18n（messages.json 双语），随头部语言开关联动切换。
//
// 弹窗直接复用真实样式源：shared/selection-search-styles.ts 原样注入本演示自建的
// shadow root（与 content script 的 createShadowRootUi 同机制——该表本就为 shadow
// root 而写）。不走 light DOM <style> 全局注入：表内 `* { margin/padding: 0
// !important }` 的宿主页防御性重置在 light DOM 会击穿整个引导页，而 shadow 隔离
// 让它恰好只约束弹窗子树；:host 规则（零尺寸 host + 亮/暗令牌自包含）也只有在
// shadow root 内才成立。host 按生产约定携带 data-theme（selection-search.content.ts
// 的 shadowHost.dataset.theme），亮/暗令牌来自表内 :host[data-theme] 规则。
// 演示动画补充（按压/浮层开合/悬停高亮）作为第二段样式注入同一 shadow root，
// 与页面侧 sel-pop / sel-sweep 同 8s 相位；keyframes 隔离在 shadow 内，不与页面重名。
const FLYOUT_IDS = ['google', 'bing', 'exa'];

const DEMO_SOURCES = new Map<string, SearchSource>(
  allSources(['exa'], [], [], [], [], []).map((s) => [s.id, s] as const),
);

function demoMembers(ids: readonly string[]) {
  return ids
    .map((id) => DEMO_SOURCES.get(id))
    .filter((s): s is NonNullable<ReturnType<typeof DEMO_SOURCES.get>> => s != null);
}

// shadow root 内的演示动画补充。注意：真实表大量使用 !important（shadow 隔离下的
// 宿主页防御），而 !important 声明的优先级高于 CSS 动画——悬停高亮因此不能动画
// background（会被 .juso-sel-source-item 的 background: transparent !important 压住），
// 改动画 inset box-shadow（真实表未声明该属性，动画可生效）来表达高亮底色。
// --ease-out / --bg-soft 由真实表在 :host 上定义，shadow 内可用。
const DEMO_ANIM_STYLES = `
.juso-sel-primary {
  animation: sel-press 8s linear infinite;
}
@keyframes sel-press {
  0%, 70% { transform: none; }
  74% { transform: scale(0.88); }
  79%, 100% { transform: none; }
}
.juso-sel-flyout {
  transform-origin: top left;
  animation: sel-flyout 8s var(--ease-out) infinite;
}
@keyframes sel-flyout {
  0%, 46% { opacity: 0; transform: scale(0.96); }
  58%, 78% { opacity: 1; transform: none; }
  86%, 100% { opacity: 0; }
}
.juso-sel-source-item.demo-hover {
  animation: sel-item-hover 8s var(--ease-out) infinite;
}
@keyframes sel-item-hover {
  0%, 60% { box-shadow: inset 0 0 0 999px transparent; }
  66%, 76% { box-shadow: inset 0 0 0 999px var(--bg-soft); }
  82%, 100% { box-shadow: inset 0 0 0 999px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .juso-sel-primary,
  .juso-sel-flyout,
  .juso-sel-source-item.demo-hover {
    animation: none;
  }
}
`;

export function SelectionDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);
  const { resolved } = useTheme();

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // StrictMode 双效应下复用同一 root（attachShadow 对同一 host 只能调用一次）
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    if (root.firstChild == null) {
      const style = document.createElement('style');
      style.textContent = `${selectionSearchStyles}\n${DEMO_ANIM_STYLES}`;
      root.appendChild(style);
    }
    setShadowRoot(root);
  }, []);

  return (
    <div className="onboarding-sel-demo" aria-hidden="true">
      <div className="onboarding-sel-cycle">
        <div className="onboarding-sel-page">
          <p className="onboarding-sel-line">
            {t(MSG.onboarding_sel_demo_pre)}
            <mark className="onboarding-sel-hl">{t(MSG.onboarding_sel_demo_hl)}</mark>
            {t(MSG.onboarding_sel_demo_post)}
          </p>
          <p className="onboarding-sel-line onboarding-sel-line--dim">{t(MSG.onboarding_sel_demo_dim)}</p>
        </div>
        {/* 定位/浮现走页面侧（.onboarding-sel-popupwrap 的 sel-pop 相位），
            shadow host 零尺寸、弹窗经 host 溢出可见，随本层整体动 */}
        <div className="onboarding-sel-popupwrap">
          <div ref={hostRef} data-theme={resolved === 'dark' ? 'dark' : 'light'}>
            {shadowRoot &&
              createPortal(
                // 真实 SelectionSearchPopup 的展开态结构（.juso-sel-* 类名照搬；
                //   演示不可交互，button 位置用同构 span 表达）
                <div className="juso-sel-popup">
                  <div className="juso-sel-bar">
                    <span className="juso-sel-primary">
                      <svg className="juso-sel-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="7" cy="7" r="5" />
                        <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
                      </svg>
                    </span>
                    <span className="juso-sel-expand-area">
                      <span className="juso-sel-expand">
                        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 4 L6 8 L10 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="juso-sel-flyout">
                        {demoMembers(FLYOUT_IDS).map((s, i) => (
                          <span
                            key={s.id}
                            className={`juso-sel-source-item${i === 1 ? ' demo-hover' : ''}`}
                          >
                            {s.favicon && (
                              <img className="juso-sel-favicon" src={resolveIconUrl(s.favicon)} alt="" />
                            )}
                            <span>{sourceLabel(s, t)}</span>
                          </span>
                        ))}
                      </span>
                    </span>
                  </div>
                </div>,
                shadowRoot,
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
