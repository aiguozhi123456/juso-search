import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { SelectionSearchPopup } from '@/components/SelectionSearchPopup';
import type { SearchSource } from '@/lib/sources';
import type { ProviderId } from '@/lib/providers/types';
import type { EngineId } from '@/lib/engines/types';
import type { GroupConfig } from '@/lib/source-groups';
import { defaultGroupConfig, DEFAULT_GROUPS, AI_SEARCH_GROUP, ENGINES_GROUP } from '@/lib/source-groups';

// 划词搜索弹窗的点击固定（pin）状态机组件测试。
// 主浮层 + 分组子浮层都复用 SourceSwitcher 的 hover-intent + 点击固定模式：
//   hover → 瞬态展开；点击 → 打开并固定；固定后移出不收起；再点/外部点击/Escape 关闭。
// i18n 用真实查表（默认 zh_CN）：分组标签为「API 搜索」「搜索引擎」。
//
// 注意：分组子浮层（.juso-sel-group-sources）常驻 DOM，显隐由 CSS
// （.juso-sel-group.open > .juso-sel-group-sources { display: block }）控制，
// jsdom 不应用样式表，因此分组开合状态断言 .open 类 / aria-expanded，而非元素存在性。

const sources: SearchSource[] = [
  { id: 'tavily' as ProviderId, kind: 'provider', label: 'provider_tavily', supportsAnswer: true },
  { id: 'stepfun' as ProviderId, kind: 'provider', label: 'provider_stepfun', supportsAnswer: false },
  { id: 'google' as EngineId, kind: 'engine', label: 'engine_google', supportsAnswer: false, favicon: '/icons/google.svg' },
  { id: 'bing' as EngineId, kind: 'engine', label: 'engine_bing', supportsAnswer: false, favicon: '/icons/bing.svg' },
  { id: 'baidu' as EngineId, kind: 'engine', label: 'engine_baidu', supportsAnswer: false, favicon: '/icons/baidu.svg' },
];

function renderPopup(overrides?: Partial<ComponentProps<typeof SelectionSearchPopup>>) {
  return render(
    <SelectionSearchPopup
      sources={sources}
      groupConfig={defaultGroupConfig(sources.map((s) => s.id))}
      primarySource={sources[0]}
      flatLayoutFewSources={false}
      onSearch={vi.fn()}
      {...overrides}
    />,
  );
}

/** 主展开区（hover/click 出分组列表）与展开按钮。 */
function getExpandArea(container: HTMLElement) {
  return container.querySelector('.juso-sel-expand-area') as HTMLElement;
}
function getExpandButton(container: HTMLElement) {
  return container.querySelector('.juso-sel-expand') as HTMLElement;
}

describe('SelectionSearchPopup — 主浮层点击固定', () => {
  // 基线：hover 展开是瞬态（不固定），移出超过延迟窗口后自动关闭。
  it('hover 展开为瞬态：移出并超过延迟后自动关闭', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      const area = getExpandArea(container);
      fireEvent.mouseEnter(area);
      expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
      fireEvent.mouseLeave(area);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('menuitem', { name: /API 搜索/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 点击固定：点击展开按钮 → 打开并固定；固定后移出不收起；再点一次关闭。
  it('点击展开 → 打开并固定；移出不关闭；再次点击关闭', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      const expandBtn = getExpandButton(container);
      const area = getExpandArea(container);
      fireEvent.click(expandBtn);
      expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
      // 点击固定后移开并超过 hover-intent 延迟窗口，浮层仍保持展开
      fireEvent.mouseLeave(area);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
      // 再次点击 → 关闭
      fireEvent.click(expandBtn);
      expect(screen.queryByRole('menuitem', { name: /API 搜索/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 回归：hover 瞬态展开中点击展开按钮，应转为固定而非收回。
  it('hover 瞬态中点击展开按钮 → 转为固定而非收回', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      const expandBtn = getExpandButton(container);
      const area = getExpandArea(container);
      fireEvent.mouseEnter(area); // hover 瞬态展开
      expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
      fireEvent.click(expandBtn); // 点击 → 固定（不得关闭）
      fireEvent.mouseLeave(area);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape 关闭固定展开的主浮层', () => {
    const { container } = renderPopup();
    const expandBtn = getExpandButton(container);
    fireEvent.click(expandBtn);
    expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
    fireEvent.keyDown(getExpandArea(container), { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: /API 搜索/ })).toBeNull();
  });

  // 固定态：页面（展开区外）pointerdown 关闭固定展开的主浮层。
  it('页面（展开区外）pointerdown 关闭固定主浮层', () => {
    const { container } = renderPopup();
    fireEvent.click(getExpandButton(container));
    expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('menuitem', { name: /API 搜索/ })).toBeNull();
    document.body.removeChild(outside);
  });

  // 守卫：pointerdown 落在展开区内部（展开按钮 / 分组行）时不关闭。
  it('pointerdown 落在展开区内不关闭主浮层（守卫）', () => {
    const { container } = renderPopup();
    const expandBtn = getExpandButton(container);
    fireEvent.click(expandBtn);
    expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
    fireEvent.pointerDown(expandBtn);
    expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: /API 搜索/ }));
    expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
  });

  // 顶层平铺 source（置顶项，非分组内）：点击 → onSearch + 关闭主浮层。
  // defaultGroupConfig 会把全部 source 归组，故自定义混合布局构造顶层平铺项。
  it('点击顶层平铺 source → onSearch 并关闭主浮层', () => {
    const onSearch = vi.fn();
    const mixedConfig: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'google' }, // 置顶平铺（置顶优先，不进任何分组）
        { kind: 'group', groupId: ENGINES_GROUP }, // 剩余 engines：bing/baidu
        { kind: 'group', groupId: AI_SEARCH_GROUP }, // tavily/stepfun
      ],
      assignments: {},
      groupOrders: {},
    };
    const { container } = renderPopup({ groupConfig: mixedConfig, onSearch });
    fireEvent.click(getExpandButton(container));
    const google = screen.getByRole('menuitem', { name: /Google/ });
    expect(google).toBeInTheDocument();
    fireEvent.click(google);
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 'google', kind: 'engine' }));
    // 主浮层关闭：顶层 source 的 menuitem 随 flyout 卸载
    expect(screen.queryByRole('menuitem', { name: /Google/ })).toBeNull();
  });

  // 弹窗内 mousedown 必须 preventDefault：阻止默认动作折叠划词选区，
  // 否则 selectionchange 会在 click 到达前关闭整个弹窗（点击分组容器即触发）。
  // 用真实 MouseEvent dispatch（fireEvent.mouseDown 不暴露 defaultPrevented 断言路径）。
  it('弹窗根与分组根上的真实 mousedown 事件被 preventDefault', () => {
    const { container } = renderPopup();
    const popupRoot = container.querySelector('.juso-sel-popup') as HTMLElement;
    const ev1 = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    popupRoot.dispatchEvent(ev1);
    expect(ev1.defaultPrevented).toBe(true);

    fireEvent.click(getExpandButton(container)); // 打开主浮层
    const groupRoot = screen.getByRole('group', { name: /API 搜索/ });
    const ev2 = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    groupRoot.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });
});

describe('SelectionSearchPopup — 分组子浮层点击固定', () => {
  // 每个用例先点击展开按钮打开主浮层（固定态），再操作分组行。
  function openMainFlyout(container: HTMLElement) {
    fireEvent.click(getExpandButton(container));
    expect(screen.getByRole('menuitem', { name: /API 搜索/ })).toBeInTheDocument();
  }

  // 分组根（整个分组框，role=group，点击识别范围）与分组行（role=menuitem，可聚焦）。
  // 分组行与 source item 同为 menuitem，但名称不冲突（API 搜索/搜索引擎 vs Tavily 等）。
  const groupRoot = (name: RegExp) => screen.getByRole('group', { name });
  const groupRow = (name: RegExp) => screen.getByRole('menuitem', { name });

  // 分组开合断言：子浮层常驻 DOM，.open 类 + aria-expanded 才是真实状态。
  const expectGroupState = (name: RegExp, open: boolean) => {
    if (open) {
      expect(groupRoot(name)).toHaveClass('open');
      expect(groupRow(name)).toHaveAttribute('aria-expanded', 'true');
    } else {
      expect(groupRoot(name)).not.toHaveClass('open');
      expect(groupRow(name)).toHaveAttribute('aria-expanded', 'false');
    }
  };

  // 组内 source 以 menuitem role 暴露；主 chip（aria-label 同源名）不冲突。
  // 分组行同为 menuitem（见 groupRow），名称不冲突。
  const sourceItem = (name: RegExp) => screen.getByRole('menuitem', { name });

  // 点击固定：点击分组行 → 子浮层展开并固定；固定后移出不收起；再点一次关闭。
  it('点击分组行 → 子浮层展开并固定；移出不关闭；再次点击关闭', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      openMainFlyout(container);
      const aiRoot = groupRoot(/API 搜索/);
      const aiRow = groupRow(/API 搜索/);
      fireEvent.click(aiRow);
      expectGroupState(/API 搜索/, true);
      expect(sourceItem(/Tavily/)).toBeInTheDocument();
      // 点击固定后移开并超过 hover-intent 延迟窗口，子浮层仍保持展开
      fireEvent.mouseLeave(aiRoot);
      act(() => { vi.advanceTimersByTime(200); });
      expectGroupState(/API 搜索/, true);
      // 再次点击 → 关闭
      fireEvent.click(aiRow);
      expectGroupState(/API 搜索/, false);
    } finally {
      vi.useRealTimers();
    }
  });

  // 点击识别范围为整个分组框：直接点击容器（非 row 区域）同样 toggle 打开。
  it('点击分组框容器（非 row 区域）→ toggle 打开分组', () => {
    const { container } = renderPopup();
    openMainFlyout(container);
    const aiRoot = groupRoot(/API 搜索/);
    expectGroupState(/API 搜索/, false);
    fireEvent.click(aiRoot); // 点击落在容器本身（target = 分组框）
    expectGroupState(/API 搜索/, true);
  });

  // 守卫：点击子浮层内部（.juso-sel-group-sources）不触发 toggle。
  it('点击子浮层内部不触发 toggle（守卫生效）', () => {
    const { container } = renderPopup();
    openMainFlyout(container);
    fireEvent.click(groupRow(/API 搜索/)); // 打开分组
    expectGroupState(/API 搜索/, true);
    const sourcesBox = container.querySelector('.juso-sel-group-sources') as HTMLElement;
    fireEvent.click(sourcesBox); // 点击子浮层容器：不 toggle，分组保持打开
    expectGroupState(/API 搜索/, true);
  });

  // 回归：hover 瞬态展开中点击分组行，应转为固定而非收回。
  it('hover 瞬态中点击分组行 → 转为固定而非收回', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      openMainFlyout(container);
      const aiRoot = groupRoot(/API 搜索/);
      fireEvent.mouseEnter(aiRoot); // hover 瞬态展开
      expectGroupState(/API 搜索/, true);
      fireEvent.click(groupRow(/API 搜索/)); // 点击 → 固定（不得关闭）
      fireEvent.mouseLeave(aiRoot);
      act(() => { vi.advanceTimersByTime(200); });
      expectGroupState(/API 搜索/, true);
    } finally {
      vi.useRealTimers();
    }
  });

  // 回归主用例：hover 瞬态主浮层（未点展开按钮）上点击分组固定 → 连带把主浮层
  // 提升为固定。否则主浮层 150ms 后收起并连带清掉分组固定（用户需先点菜单再点
  // 分组才能固定的根因）。
  it('hover 瞬态主浮层上点击分组 → 连带固定：移出后主浮层与分组均保持', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      // hover 瞬态打开主浮层（不点展开按钮 → pinned=false）
      fireEvent.mouseEnter(getExpandArea(container));
      expect(groupRow(/API 搜索/)).toBeInTheDocument();
      // 点击分组行 → 分组打开，且主浮层被连带提升为固定
      fireEvent.click(groupRow(/API 搜索/));
      expectGroupState(/API 搜索/, true);
      // 鼠标移出展开区并超过 150ms 延迟窗口：主浮层与分组均保持
      fireEvent.mouseLeave(getExpandArea(container));
      act(() => { vi.advanceTimersByTime(200); });
      expect(groupRow(/API 搜索/)).toBeInTheDocument();
      expectGroupState(/API 搜索/, true);
    } finally {
      vi.useRealTimers();
    }
  });

  // 语义锁定：分组固定又关闭后，主浮层保持固定——点击分组把主浮层也固定了，
  // 收起主浮层需显式动作（展开按钮/Escape/外部点击）。
  it('分组固定又关闭后，主浮层保持固定', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      fireEvent.mouseEnter(getExpandArea(container)); // hover 瞬态打开
      fireEvent.click(groupRow(/API 搜索/)); // 点击分组（连带固定主浮层）
      expectGroupState(/API 搜索/, true);
      fireEvent.click(groupRow(/API 搜索/)); // 再点分组关闭（不动主浮层固定态）
      expectGroupState(/API 搜索/, false);
      fireEvent.mouseLeave(getExpandArea(container));
      act(() => { vi.advanceTimersByTime(200); });
      // 主浮层仍展开
      expect(groupRow(/API 搜索/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Escape 关闭分组子浮层：分组根 stopPropagation，主浮层保留。
  it('Escape 关闭分组子浮层但保留主浮层', () => {
    const { container } = renderPopup();
    openMainFlyout(container);
    const aiRow = groupRow(/API 搜索/);
    fireEvent.click(aiRow);
    expectGroupState(/API 搜索/, true);
    // Escape 从分组行冒泡到分组根：关闭分组但不关闭主浮层
    fireEvent.keyDown(aiRow, { key: 'Escape' });
    expectGroupState(/API 搜索/, false);
    expect(groupRow(/API 搜索/)).toBeInTheDocument();
    // 主浮层上的 Escape 才关闭主浮层
    fireEvent.keyDown(getExpandArea(container), { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: /API 搜索/ })).toBeNull();
  });

  // 固定态：展开区内、分组之外的 pointerdown 关闭固定分组（主浮层保留）。
  it('展开区内、分组外的 pointerdown 关闭固定分组（主浮层保留）', () => {
    const { container } = renderPopup();
    openMainFlyout(container);
    fireEvent.click(groupRow(/API 搜索/));
    expectGroupState(/API 搜索/, true);
    // pointerdown 落在另一分组行上：在展开区内（主浮层守卫放行）但在本分组之外
    fireEvent.pointerDown(groupRow(/搜索引擎/));
    expectGroupState(/API 搜索/, false);
    expect(groupRow(/API 搜索/)).toBeInTheDocument();
  });

  // 单开语义：固定 A 后 hover 别的组 → A 关闭且固定被清除；hover 回 A 也不恢复固定。
  it('单开：固定 A 后 hover B → A 关闭且取消固定；hover 回 A 不恢复固定', () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPopup();
      openMainFlyout(container);
      const aiRoot = groupRoot(/API 搜索/);
      const enginesRoot = groupRoot(/搜索引擎/);
      fireEvent.click(groupRow(/API 搜索/)); // 固定 A
      expectGroupState(/API 搜索/, true);
      // hover 另一组：A 固定被清除并关闭，B 瞬态展开
      fireEvent.mouseEnter(enginesRoot);
      expectGroupState(/API 搜索/, false);
      expectGroupState(/搜索引擎/, true);
      // hover 回 A 不恢复固定：移开并超过延迟窗口后子浮层仍关闭
      fireEvent.mouseEnter(aiRoot);
      expectGroupState(/API 搜索/, true);
      fireEvent.mouseLeave(aiRoot);
      act(() => { vi.advanceTimersByTime(200); });
      expectGroupState(/API 搜索/, false);
    } finally {
      vi.useRealTimers();
    }
  });

  // 选择分组内 source：onSearch 回调 + 关闭该分组子浮层。
  it('选择分组内 source → onSearch 并关闭该分组', () => {
    const onSearch = vi.fn();
    const { container } = renderPopup({ onSearch });
    openMainFlyout(container);
    fireEvent.click(groupRow(/API 搜索/));
    expectGroupState(/API 搜索/, true);
    fireEvent.click(sourceItem(/Tavily/));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 'tavily', kind: 'provider' }));
    // 分组子浮层关闭；主浮层保留（弹窗整体由父层 dismiss）
    expectGroupState(/API 搜索/, false);
    expect(groupRow(/API 搜索/)).toBeInTheDocument();
  });

  // 键盘可达性：焦点离开分组（blur 到分组之外）→ 关闭分组，主浮层保留。
  it('焦点离开分组（blur）→ 关闭分组（主浮层保留）', () => {
    const { container } = renderPopup();
    openMainFlyout(container);
    const aiRow = groupRow(/API 搜索/);
    aiRow.focus();
    fireEvent.click(aiRow); // 点击固定展开
    expectGroupState(/API 搜索/, true);
    fireEvent.blur(aiRow, { relatedTarget: document.body });
    expectGroupState(/API 搜索/, false);
    expect(groupRow(/API 搜索/)).toBeInTheDocument();
  });

  // 重置效果：主浮层关闭时清空分组状态；重开主浮层后无子浮层展开。
  it('主浮层关闭重置分组状态：重开主浮层无子浮层展开', () => {
    const { container } = renderPopup();
    const expandBtn = getExpandButton(container);
    fireEvent.click(expandBtn); // 打开并固定主浮层
    fireEvent.click(groupRow(/API 搜索/)); // 固定分组 A
    expectGroupState(/API 搜索/, true);
    fireEvent.click(expandBtn); // 关闭主浮层（同时清空分组状态）
    expect(screen.queryByRole('menuitem', { name: /API 搜索/ })).toBeNull();
    fireEvent.click(expandBtn); // 重新打开主浮层
    expect(groupRow(/API 搜索/)).toBeInTheDocument();
    // 分组状态已被重置：没有子浮层展开
    expectGroupState(/API 搜索/, false);
  });

  // 守卫：pointerdown 落在分组行或子浮层内部时不关闭分组。
  it('pointerdown 落在分组行/子浮层内不关闭（守卫）', () => {
    const { container } = renderPopup();
    openMainFlyout(container);
    fireEvent.click(groupRow(/API 搜索/));
    expectGroupState(/API 搜索/, true);
    // 分组行上 pointerdown → path 含 rootRef，不关闭
    fireEvent.pointerDown(groupRow(/API 搜索/));
    expectGroupState(/API 搜索/, true);
    // 子浮层内 item 上 pointerdown → 子浮层是分组框 DOM 子孙，path 含 rootRef，不关闭
    fireEvent.pointerDown(sourceItem(/Tavily/));
    expectGroupState(/API 搜索/, true);
  });
});
