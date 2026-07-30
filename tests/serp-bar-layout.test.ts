import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serpBarStyles } from '@/entrypoints/shared/serp-bar-styles';
import { calculateAlignedHostLayout } from '@/lib/serp-bar-layout';

describe('SERP bar shadow-host layout', () => {
  it('sets the shadow host engine data attribute during mount', async () => {
    const source = await readFile(resolve(process.cwd(), 'entrypoints/serp-bar.content.ts'), 'utf8');

    expect(source).toMatch(
      /onMount\([^)]*shadowHost\)\s*\{\s*shadowHost\.dataset\.engine\s*=\s*state\.engine\.id;/,
    );
  });

  it('mounts the bottom bar to document.body, escaping the engine anchor subtree', async () => {
    // 底栏 host 必须脱离 engine 内联锚点子树（小红书 #search-input / 抖音
    // #search-result-container），否则页面祖先的 transform/filter/will-change/contain/
    // backdrop-filter 会让它变成 position:fixed 的 containing block（底栏不贴真底部），
    // 并困住 z-index（被站点浮层盖住）。底栏返回 "body" 锚点并在 append 内 appendChild 到 body。
    const source = await readFile(resolve(process.cwd(), 'entrypoints/serp-bar.content.ts'), 'utf8');

    // anchor 在底栏返回 "body"（让 WXT 的 getAnchor 永远命中，绕过 mountUi 的 throw）。
    expect(source).toMatch(/resolvedPosition\s*===\s*'bottom'\)\s*return\s*'body'/);
    // append 在底栏分支 appendChild 到 document.body（兜底 documentElement）。
    expect(source).toMatch(/document\.body\s*\?\?\s*document\.documentElement\)\.appendChild\(root\)/);
  });

  it('restores host layout with important rules and namespaced alignment variables', () => {
    for (const property of [
      'display: block',
      'position: relative',
      'z-index: 20',
      'box-sizing: border-box',
      'padding: 8px 0',
      'visibility: visible',
      'pointer-events: auto',
    ]) {
      expect(serpBarStyles).toContain(`${property} !important`);
    }
    expect(serpBarStyles).toMatch(/font-family:[^;]+!important/);
    expect(serpBarStyles).toMatch(/margin-left:\s*var\(--juso-serp-offset-left, 0px\)\s*!important/);
    expect(serpBarStyles).toMatch(/width:\s*var\(--juso-serp-width, auto\)\s*!important/);
    expect(serpBarStyles).not.toMatch(/--juso-serp-(?:offset-left|width)\s*:/);
  });

  it('keeps Bing below native suggestions without lowering other engines', () => {
    const sharedHostRule = serpBarStyles.match(/:host \{[^}]*z-index:\s*20\s*!important[^}]*\}/);
    const bingHostRule = serpBarStyles.match(
      /:host\(\[data-engine="bing"\]\)\s*\{[^}]*z-index:\s*1\s*!important[^}]*\}/,
    );

    expect(sharedHostRule).not.toBeNull();
    expect(bingHostRule).not.toBeNull();
    expect(serpBarStyles.indexOf(bingHostRule![0])).toBeGreaterThan(serpBarStyles.indexOf(sharedHostRule![0]));
  });

  it('raises the bottom bar host to int32-max z-index so it sits above site popups once body-mounted', () => {
    // 底栏 host 挂到 document.body 后脱离站点子树层叠上下文；再用 int32 最大值
    // z-index 盖过抖音分享/设置等站点浮层（其值常 >1000，远低于 2147483647）。
    const bottomHostRule = serpBarStyles.match(
      /:host\(\[data-position="bottom"\]\)\s*\{[^}]*z-index:\s*2147483647\s*!important[^}]*\}/,
    );
    expect(bottomHostRule).not.toBeNull();

    // 底栏 fixed-up flyout 同取 int32 最大值：它是 host 的 fixed 子元素，无需超过 host；
    // 同值即可，并一并盖过站点浮层。
    const bottomFlyoutRule = serpBarStyles.match(
      /\.group-flyout--fixed-up\s*\{[^}]*z-index:\s*2147483647\s*!important[^}]*\}/,
    );
    expect(bottomFlyoutRule).not.toBeNull();
  });

  it('aligns the Bing host to the target content box', () => {
    const layout = calculateAlignedHostLayout(
      { left: 0, width: 1096.667 },
      { borderLeft: 0, borderRight: 0, paddingLeft: 0, paddingRight: 0 },
      { left: 0, width: 1096.667 },
      { borderLeft: 0, borderRight: 0, paddingLeft: 113, paddingRight: 0 },
    );

    expect(layout.offsetLeft).toBe(113);
    expect(layout.width).toBeCloseTo(983.667, 3);
  });

  it('aligns the Google host to #center_col relative to its outer parent', () => {
    expect(
      calculateAlignedHostLayout(
        { left: 0, width: 868 },
        { borderLeft: 0, borderRight: 0, paddingLeft: 0, paddingRight: 0 },
        { left: 52, width: 652 },
        { borderLeft: 0, borderRight: 0, paddingLeft: 0, paddingRight: 0 },
      ),
    ).toEqual({ offsetLeft: 52, width: 652 });
  });

  it('uses parent-relative content boxes and clamps negative geometry', () => {
    expect(
      calculateAlignedHostLayout(
        { left: 40, width: 500 },
        { borderLeft: 2, borderRight: 3, paddingLeft: 11, paddingRight: 13 },
        { left: 70, width: 200 },
        { borderLeft: 5, borderRight: 7, paddingLeft: 17, paddingRight: 19 },
      ),
    ).toEqual({ offsetLeft: 39, width: 152 });

    expect(
      calculateAlignedHostLayout(
        { left: 100, width: 10 },
        { borderLeft: 5, borderRight: 5, paddingLeft: 5, paddingRight: 5 },
        { left: 10, width: 8 },
        { borderLeft: 3, borderRight: 3, paddingLeft: 3, paddingRight: 3 },
      ),
    ).toEqual({ offsetLeft: 0, width: 0 });
  });
});
