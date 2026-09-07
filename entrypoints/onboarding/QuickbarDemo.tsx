import { useState } from 'react';
import { allSources, resolveIconUrl, sourceLabel, type SearchSource } from '@/lib/sources';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';

// 快切栏切换示意：结构与样式直接建在真实 SourceSwitcher 的类上（search/styles.css，
// main.tsx 引入）——.source-switcher > .switcher-track 胶囊轨道 + 真实 pill；成员
// 浮层用真实 .group-flyout（含 min-width: max-content，宽度随内容）。交互相位镜像
// 真实行为：hover 分组 trigger 高亮（.switcher-group.open 观感 = brand 字 +
// brand-soft 底，相位化）→ 成员浮层 pop 展开（favicon + 名称 pill 列）→ 光标移入
// 浮层点选 Google（hover 高亮 + 按压 + 涟漪）→ 浮层收起、trigger 复位 → 置顶激活
// 源 pill 原地换内容（Tavily → Google，favicon + 标签交叉淡换 + 小弹；激活底色走
// button.active 真实 fallback——真实页 .switcher-indicator 依赖 JS 测量，演示无测量）
// → 结果行闪骨架（真实 .skel-line shimmer）→ 换 Google 结果（「切源即换结果，
// 免重输」）。
// 10s 循环，动画纯 CSS；芯片错峰 pop 与 pill 内容换层为 one-shot/相位动画，
// 靠监听 qb-fade 的 animationiteration 换 key 重挂子树，每轮从零完整重播（同 kd/wb2）。
// 结果数据取自 Tavily 对「双面搜 Juso」的真实返回（同 WelcomeDemo，官方渠道），
// 按当前 locale 渲染时求值（语言切换即时生效；属数据型文案，不走 i18n key）。
const COPY = () =>
  getCurrentLocale() === 'zh_CN'
    ? {
        resultA: {
          title: 'GitHub - aiguozhi123456/juso-search',
          url: 'github.com › aiguozhi123456 › juso-search',
          snippet:
            'An open-source browser extension—a gateway with two-sided reach into search, with locally managed credentials—for humans and local AI agents.',
        },
        resultB: {
          title: '双面搜 - Chrome Web Store',
          url: 'chromewebstore.google.com',
          snippet: '把多种搜索引擎和 AI 搜索能力统一到同一个入口，让你在一个地方搜索、比较和快速切换，即装即用。',
        },
      }
    : {
        resultA: {
          title: 'GitHub - aiguozhi123456/juso-search',
          url: 'github.com › aiguozhi123456 › juso-search',
          snippet:
            'An open-source browser extension—a gateway with two-sided reach into search, with locally managed credentials—for humans and local AI agents.',
        },
        resultB: {
          title: 'Juso - Chrome Web Store',
          url: 'chromewebstore.google.com',
          snippet: 'Unify search engines and AI search into one entry — search, compare and switch in one place.',
        },
      };

// 引擎分组成员浮层展示项（真实成员从 registry 投影，顺序即展示顺序；Google 为点选项）
const MENU_IDS = ['google', 'bing', 'baidu'] as const;

const DEMO_SOURCES = new Map<string, SearchSource>(
  [
    ...allSources(['tavily'], [], [], [], [], []),
    ...allSources([], ['google', 'bing', 'baidu'], [], [], [], []),
  ].map((s) => [s.id, s] as const),
);
const tavily = DEMO_SOURCES.get('tavily');
const google = DEMO_SOURCES.get('google');
const menuItems = MENU_IDS
  .map((id) => DEMO_SOURCES.get(id))
  .filter((s): s is SearchSource => s != null);

export function QuickbarDemo() {
  // 每轮循环边界（qb-fade 迭代）重挂子树：one-shot 动画（芯片 pop / pill 内容换层）
  // 随之从头重播，与 infinite 动画天然同相（同一挂载起点 + 相同 10s 周期）。
  const [cycle, setCycle] = useState(0);
  const copy = COPY();

  return (
    <div
      className="onboarding-qb-demo"
      aria-hidden="true"
      inert
      onAnimationIteration={(e) => {
        if (e.animationName === 'qb-fade') setCycle((c) => c + 1);
      }}
    >
      {/* 静态描边框（同 .onboarding-wb-page / .onboarding-sel-page），跨循环常驻不淡出 */}
      <div className="onboarding-qb-page">
        <div className="onboarding-qb-cycle" key={cycle}>
          <div className="onboarding-qb-stage">
            {/* 快切栏：真实 .switcher-track 胶囊轨道。置顶激活源 pill 内两层同格
                叠放（Tavily / Google），点选后交叉淡换内容（favicon + 标签同步换） */}
            <div className="source-switcher">
              <div className="switcher-track">
                <button
                  type="button"
                  className="active"
                  data-active="true"
                  tabIndex={-1}
                >
                  <span className="qb-swap qb-swap--a">
                    {tavily?.favicon && (
                      <img
                        className="source-icon"
                        src={resolveIconUrl(tavily.favicon)}
                        alt=""
                        width={14}
                        height={14}
                      />
                    )}
                    {tavily ? sourceLabel(tavily, t) : null}
                  </span>
                  <span className="qb-swap qb-swap--b">
                    {google?.favicon && (
                      <img
                        className="source-icon"
                        src={resolveIconUrl(google.favicon)}
                        alt=""
                        width={14}
                        height={14}
                      />
                    )}
                    {google ? sourceLabel(google, t) : null}
                  </span>
                </button>
                {(
                  [
                    [MSG.group_engines, '0.29s'],
                    [MSG.group_sites, '0.36s'],
                    [MSG.group_ai_engines, '0.43s'],
                    [MSG.group_ai_search, '0.5s'],
                    [MSG.group_custom, '0.57s'],
                  ] as const
                ).map(([msg, delay], i) => (
                  <div key={msg} className="switcher-group" style={{ animationDelay: delay }}>
                    <button type="button" className="group-trigger" tabIndex={-1}>
                      <span className="group-label">{t(msg)}</span>
                    </button>
                    {/* 引擎分组成员浮层（真实 .group-flyout：hover 展开、点选成员；
                        常驻 DOM，开合由 qb-menu 相位控制） */}
                    {i === 0 && (
                      <div className="group-flyout">
                        {menuItems.map((s, j) => (
                          <button
                            key={s.id}
                            type="button"
                            tabIndex={-1}
                            className={j === 0 ? 'qb-pick' : undefined}
                          >
                            {s.favicon && (
                              <img
                                className="source-icon"
                                src={resolveIconUrl(s.favicon)}
                                alt=""
                                width={14}
                                height={14}
                              />
                            )}
                            <span className="source-label">{sourceLabel(s, t)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 迷你结果区（三层叠放同格）：Tavily 结果 → 骨架闪换 → Google 结果
                （真实 .result-card / .skel-line 类；三层叠放与截断为演示取舍，
                见 styles.css）。卡片高度撑起演示框，让成员浮层展开后完全收在框内
                （不压下方栏目）；被浮层盖住的瞬间即真实下拉行为。 */}
            <div className="onboarding-qb-result">
              <article className="result-card qb-row--a">
                <div className="result-head">
                  {tavily?.favicon && (
                    <img
                      src={resolveIconUrl(tavily.favicon)}
                      alt=""
                      width={16}
                      height={16}
                    />
                  )}
                  <a className="result-title">{copy.resultA.title}</a>
                </div>
                <div className="result-url">{copy.resultA.url}</div>
                <p className="result-snippet">{copy.resultA.snippet}</p>
              </article>
              <div className="qb-skel">
                <span className="skel-line qb-skel-dot" />
                <span className="skel-line w-60" />
                <span className="skel-line w-40" />
                <span className="skel-line w-90" />
                <span className="skel-line w-75" />
              </div>
              <article className="result-card qb-row--b">
                <div className="result-head">
                  {google?.favicon && (
                    <img
                      src={resolveIconUrl(google.favicon)}
                      alt=""
                      width={16}
                      height={16}
                    />
                  )}
                  <a className="result-title">{copy.resultB.title}</a>
                </div>
                <div className="result-url">{copy.resultB.url}</div>
                <p className="result-snippet">{copy.resultB.snippet}</p>
              </article>
            </div>

            <span className="onboarding-qb-cursor">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M5.5 2.5 L18.8 12.2 L12.6 13.3 L16.2 20.2 L13.4 21.6 L10 14.6 L5.5 18.2 Z"
                  fill="#fff"
                  stroke="#333"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="onboarding-qb-ripple" />
              <span className="onboarding-qb-ripple onboarding-qb-ripple--lag" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
