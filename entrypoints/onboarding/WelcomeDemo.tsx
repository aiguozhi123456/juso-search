import { useState } from 'react';
import { allSources, resolveIconUrl } from '@/lib/sources';
import { DEFAULT_GROUPS, groupLabelText } from '@/lib/source-groups';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';
import { BrandMark, SearchIcon } from '@/components/icons';
import { DemoCursor } from './CursorRipple';

// 欢迎页示意：结构与样式直接建在搜索页真实类上（search/styles.css，main.tsx
// 引入）——.search-box 胶囊输入框 + 品牌色「搜索」按钮、.source-switcher >
// .switcher-track 胶囊轨道（bg-soft + 描边 + 全圆角）+ 真实 pill（激活源 =
// button.active 真实 fallback 实色；分组 = .switcher-group > .group-trigger 纯文本
// + ▾）、.loading-skeleton 同构骨架（brand shimmer 来自真实 juso-shimmer）、
// .answer-card（brand 左条 + 引用）与 .result-list/.result-card（brand 标题 +
// URL + 摘要）。激活指示器说明：真实页由 .switcher-indicator 承载实色（JS 测量
// 注入 CSS 变量），演示无 JS 测量，走 search 表自带的 no-indicator fallback。
// 打字层为演示补充：input 是 void 元素，逐字 span + 插入符由同位覆盖层承载
// （字号/内距取 .search-box input 同值）。
// 结果数据取自 Tavily 对「双面搜 Juso」的真实返回（Top 2 + answer，官方渠道），
// 按当前 locale 渲染时求值（语言切换即时生效；属数据型文案，不走 i18n key）。
// 12s 循环：动画本身纯 CSS；打字/芯片 pop 是 one-shot，靠监听 wb2-fade 的
// animationiteration 换 key 重挂子树，让每轮从零完整重播（无漂移、无缝衔接）。
const COPY = () =>
  getCurrentLocale() === 'zh_CN'
    ? {
        query: '双面搜 Juso',
        chipActive: 'Tavily',
        answer:
          'The Juso browser extension is an open-source tool that aggregates various search engines and AI search services into one interface. It is available on the Chrome Web Store and GitHub.',
        citations: ['双面搜 - Chrome Web Store', 'GitHub - aiguozhi123456/juso-search'],
        results: [
          {
            title: 'GitHub - aiguozhi123456/juso-search',
            url: 'github.com › aiguozhi123456 › juso-search',
            snippet:
              'An open-source browser extension—a gateway with two-sided reach into search, with locally managed credentials—for humans and local AI agents.',
          },
          {
            title: '双面搜 - Chrome Web Store',
            url: 'chromewebstore.google.com',
            snippet: '把多种搜索引擎和 AI 搜索能力统一到同一个入口，让你在一个地方搜索、比较和快速切换，即装即用。',
          },
        ],
      }
    : {
        query: 'Juso search',
        chipActive: 'Tavily',
        answer:
          'The Juso browser extension is an open-source tool that aggregates various search engines and AI search services into one interface. It is available on the Chrome Web Store and GitHub.',
        citations: ['Juso - Chrome Web Store', 'GitHub - aiguozhi123456/juso-search'],
        results: [
          {
            title: 'GitHub - aiguozhi123456/juso-search',
            url: 'github.com › aiguozhi123456 › juso-search',
            snippet:
              'An open-source browser extension—a gateway with two-sided reach into search, with locally managed credentials—for humans and local AI agents.',
          },
          {
            title: 'Juso - Chrome Web Store',
            url: 'chromewebstore.google.com',
            snippet: 'Unify search engines and AI search into one entry — search, compare and switch in one place.',
          },
        ],
      };

const DEMO_SOURCES = new Map<string, ReturnType<typeof allSources>[number]>(
  allSources(['tavily'], [], [], [], [], []).map((s) => [s.id, s] as const),
);
const tavily = DEMO_SOURCES.get('tavily');

// 打字窗口与 styles.css 时间轴对齐：0.7s 起、1.6s 前收尾（打字窗口 0–14% × 12s
// = 1.68s，不能撞上 16% / 1.92s 起的芯片 pop）。步长按 query 长度推导——
// zh 8 字 ≈ 0.129s/字、en 11 字符 0.09s/字，两种语言的末字都落在窗口内。
const TYPE_START = 0.7;
const TYPE_END = 1.6;

export function WelcomeDemo() {
  // 每轮循环边界（wb2-fade 迭代）重挂子树：one-shot 动画（打字/芯片 pop）
  // 随之从头重播，与 infinite 动画天然同相（同一挂载起点 + 相同 12s 周期）。
  const [cycle, setCycle] = useState(0);
  const copy = COPY();
  const queryChars = Array.from(copy.query);
  const typeStep = queryChars.length > 1 ? (TYPE_END - TYPE_START) / (queryChars.length - 1) : 0;

  return (
    <div
      className="onboarding-wb-demo"
      aria-hidden="true"
      inert
      onAnimationIteration={(e) => {
        if (e.animationName === 'wb2-fade') setCycle((c) => c + 1);
      }}
    >
      {/* 示意容器框：静态描边（同划词示意 .onboarding-sel-page），跨循环常驻不淡出 */}
      <div className="onboarding-wb-page">
        <div className="onboarding-wb-cycle" key={cycle}>
          <div className="onboarding-wb-stage">
            {/* 搜索框：真实 .search-box（input + 品牌按钮 + 真实间距）；
                打字覆盖层挂在 input 外的定位 wrapper 上（见 styles.css） */}
            <div className="search-box">
              <span className="wb-inputwrap">
                <input type="text" tabIndex={-1} readOnly />
                <span className="wb-type">
                  {queryChars.map((ch, i) => (
                    <span key={i} className="onboarding-wb-char" style={{ animationDelay: `${(TYPE_START + i * typeStep).toFixed(3)}s` }}>
                      {ch === ' ' ? '\u00A0' : ch}
                    </span>
                  ))}
                  <span className="onboarding-wb-caret" />
                </span>
              </span>
              <button type="submit" tabIndex={-1}>
                <SearchIcon size={16} />
                <span>{t(MSG.btn_search)}</span>
              </button>
            </div>

            {/* 快切栏：真实 .switcher-track 胶囊轨道。置顶激活源 pill 走
                button.active fallback（brand 实色；指示器依赖 JS 测量，见组件头注释）
                + 全部内置分组 pill（DEFAULT_GROUPS 投影，顺序同真实快切栏） */}
            <div className="source-switcher">
              <div className="switcher-track">
                <button
                  type="button"
                  className="active"
                  data-active="true"
                  tabIndex={-1}
                  style={{ animationDelay: '1.9s' }}
                >
                  {tavily?.favicon && (
                    <img className="source-icon" src={resolveIconUrl(tavily.favicon)} alt="" width={14} height={14} />
                  )}
                  <span className="source-label">{copy.chipActive}</span>
                </button>
                {DEFAULT_GROUPS.map((g, i) => (
                  <div key={g.id} className="switcher-group" style={{ animationDelay: `${(2.02 + i * 0.12).toFixed(2)}s` }}>
                    <button type="button" className="group-trigger" tabIndex={-1}>
                      <span className="group-label">{groupLabelText(g.label, t)}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 结果区：骨架（真实 .loading-skeleton 结构与 shimmer）→ AI 回答卡 +
                结果卡（真实 .answer-card / .result-list / .result-card 流） */}
            <div className="onboarding-wb-body">
              <div className="loading-skeleton">
                <div className="skel-answer">
                  <div className="skel-line skel-head" />
                  <div className="skel-line w-90" />
                  <div className="skel-line w-75" />
                  <div className="skel-line w-60" />
                </div>
                {[90, 40].map((w, i) => (
                  <div key={i} className="skel-result">
                    <div className="skel-line skel-title" />
                    <div className="skel-line skel-url" />
                    <div className={`skel-line w-${w}`} />
                  </div>
                ))}
              </div>

              <section className="answer-card">
                <h3>
                  <span className="answer-card-mark">
                    <BrandMark size={14} />
                  </span>
                  {t(MSG.answer_heading)}
                </h3>
                <p className="answer-text">{copy.answer}</p>
                <ul className="citations">
                  {copy.citations.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </section>

              <div className="result-list">
                {copy.results.map((r, i) => (
                  <article key={i} className={`result-card wb-r${i + 1}`}>
                    <div className="result-head">
                      {tavily?.favicon && (
                        <img src={resolveIconUrl(tavily.favicon)} alt="" width={16} height={16} />
                      )}
                      <a className="result-title">{r.title}</a>
                    </div>
                    <div className="result-url">{r.url}</div>
                    <p className="result-snippet">{r.snippet}</p>
                  </article>
                ))}
              </div>
            </div>

            <DemoCursor cursorClass="onboarding-wb-cursor" rippleClass="onboarding-wb-ripple" />
          </div>
        </div>
      </div>
    </div>
  );
}
