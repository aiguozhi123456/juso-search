import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import type { SearchSource } from '@/lib/sources';
import type { ProviderId } from '@/lib/providers/types';
import type { EngineId } from '@/lib/engines/types';
import type { GroupConfig, SwitcherItem } from '@/lib/source-groups';
import { DEFAULT_GROUPS, AI_SEARCH_GROUP, defaultGroupConfig } from '@/lib/source-groups';

const sources: SearchSource[] = [
  { id: 'tavily' as ProviderId, kind: 'provider', label: 'provider_tavily', supportsAnswer: true },
  { id: 'stepfun' as ProviderId, kind: 'provider', label: 'provider_stepfun', supportsAnswer: false },
  { id: 'google' as EngineId, kind: 'engine', label: 'engine_google', supportsAnswer: false, favicon: '/icons/google.svg' },
  { id: 'bing' as EngineId, kind: 'engine', label: 'engine_bing', supportsAnswer: false, favicon: '/icons/bing.svg' },
  { id: 'baidu' as EngineId, kind: 'engine', label: 'engine_baidu', supportsAnswer: false, favicon: '/icons/baidu.svg' },
];

const siteSources: SearchSource[] = [
  {
    id: 'site:docs' as const, kind: 'site-engine', label: 'Docs Site', supportsAnswer: false, favicon: '/icons/site.svg',
    labelDescriptor: { kind: 'literal', value: 'Docs Site' },
  },
];

/** 全部 source 置顶平铺（layout 只含 source 项），复刻旧的扁平渲染语义。 */
function pinnedLayout(srcs: SearchSource[]): GroupConfig {
  const layout: SwitcherItem[] = srcs.map((s) => ({ kind: 'source', sourceId: s.id }));
  return { groups: DEFAULT_GROUPS, layout, assignments: {}, groupOrders: {} };
}

describe('SourceSwitcher — flat (pinned) layout', () => {
  it('renders one button per source with resolved labels', () => {
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId="tavily" onSelect={vi.fn()} />);
    // i18n 真实查表（默认 zh_CN）
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stepfun 按量/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Baidu/ })).toBeInTheDocument();
  });

  it('marks only the active source with active class + aria-pressed', () => {
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId="google" onSelect={vi.fn()} />);
    const google = screen.getByRole('button', { name: /Google/ });
    const tavily = screen.getByRole('button', { name: /Tavily/ });
    expect(google).toHaveClass('active');
    expect(google).toHaveAttribute('aria-pressed', 'true');
    expect(tavily).not.toHaveClass('active');
    expect(tavily).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes stable source ids for categorical styling', () => {
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId="google" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Google/ })).toHaveAttribute('data-source', 'google');
    expect(screen.getByRole('button', { name: /Tavily/ })).toHaveAttribute('data-source', 'tavily');
    expect(screen.getByRole('group', { name: '切换搜索来源' })).toHaveAttribute('data-active-source', 'google');
  });

  it('renders favicons for engine sources', () => {
    const { container } = render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId={null} onSelect={vi.fn()} />);
    // 三个 engine 各一个 favicon（alt="" 为装饰图，不以 img role 暴露，直接查 DOM）
    const imgs = container.querySelectorAll('img.source-icon');
    expect(imgs).toHaveLength(3);
  });

  it('shows the no-answer badge only for providers without answer support', () => {
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId={null} onSelect={vi.fn()} />);
    const stepfun = screen.getByRole('button', { name: /Stepfun 按量/ });
    expect(stepfun.querySelector('.no-answer')).toBeTruthy();
    const google = screen.getByRole('button', { name: /Google/ });
    expect(google.querySelector('.no-answer')).toBeNull(); // engine 无此标记
  });

  it('calls onSelect with the clicked source', () => {
    const onSelect = vi.fn();
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId="tavily" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Baidu/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'baidu', kind: 'engine' }));
  });

  it('disables all buttons when disabled', () => {
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId={null} onSelect={vi.fn()} disabled />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });

  it('renders an empty group when sources is empty', () => {
    const { container } = render(<SourceSwitcher sources={[]} groupConfig={defaultGroupConfig([])} activeId={null} onSelect={vi.fn()} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('exposes a labelled group for accessibility', () => {
    render(<SourceSwitcher sources={sources} groupConfig={pinnedLayout(sources)} activeId={null} onSelect={vi.fn()} />);
    // aria-label → source_switcher_aria → "切换搜索来源"
    expect(screen.getByRole('group', { name: '切换搜索来源' })).toBeInTheDocument();
  });

  it('renders a literal site-engine name without i18n resolution', () => {
    render(<SourceSwitcher sources={siteSources} groupConfig={pinnedLayout(siteSources)} activeId="site:docs" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Docs Site' })).toHaveAttribute('data-source', 'site:docs');
  });

  it('uses the site-engine tooltip for site-engine sources', () => {
    render(<SourceSwitcher sources={siteSources} groupConfig={pinnedLayout(siteSources)} activeId={null} onSelect={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Docs Site' });
    // tooltip_site_engine → "站外搜索（无 AI 综合答案）"
    expect(btn).toHaveAttribute('title', '站外搜索（无 AI 综合答案）');
  });

  it('renders the site favicon for site-engine sources', () => {
    const { container } = render(<SourceSwitcher sources={siteSources} groupConfig={pinnedLayout(siteSources)} activeId={null} onSelect={vi.fn()} />);
    const imgs = container.querySelectorAll('img.source-icon');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', '/icons/site.svg');
  });

  it('calls onSelect with a clicked site-engine source', () => {
    const onSelect = vi.fn();
    render(<SourceSwitcher sources={siteSources} groupConfig={pinnedLayout(siteSources)} activeId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Docs Site' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'site:docs', kind: 'site-engine' }));
  });
});

describe('SourceSwitcher — grouped layout', () => {
  // 默认分组：providers 进 ai-search，engines 进 engines 组。
  const groupedConfig = defaultGroupConfig(sources.map((s) => s.id));

  it('renders group trigger pills (not flat source buttons) by default', () => {
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />);
    // 两个分组 trigger：API 搜索 / 搜索引擎（站点组为空不渲染）
    expect(screen.getByRole('button', { name: /API 搜索/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /搜索引擎/ })).toBeInTheDocument();
    // 收起态下不渲染组内 source 按钮
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
  });

  it('shows a badge on the group that contains the active source', () => {
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId="tavily" onSelect={vi.fn()} />);
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    expect(aiTrigger.querySelector('.group-badge')).toBeTruthy();
    const enginesTrigger = screen.getByRole('button', { name: /搜索引擎/ });
    expect(enginesTrigger.querySelector('.group-badge')).toBeNull();
  });

  it('expands the flyout on hover and renders inner source buttons', () => {
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />);
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.mouseEnter(aiTrigger.parentElement!); // hover 整个 .switcher-group
    // 浮层展开后，组内 source 可见
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stepfun 按量/ })).toBeInTheDocument();
  });

  it('calls onSelect from a source inside an expanded group flyout', () => {
    const onSelect = vi.fn();
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={onSelect} />);
    const enginesTrigger = screen.getByRole('button', { name: /搜索引擎/ });
    fireEvent.mouseEnter(enginesTrigger.parentElement!);
    fireEvent.click(screen.getByRole('button', { name: /Bing/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'bing', kind: 'engine' }));
  });

  it('closes the flyout after selecting a source inside it', () => {
    const onSelect = vi.fn();
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={onSelect} />);
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.mouseEnter(aiTrigger.parentElement!);
    fireEvent.click(screen.getByRole('button', { name: /Tavily/ }));
    // 选择后浮层应关闭：Tavily 按钮不再存在
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
  });

  it('mixed layout: pinned source and group appear at the same level', () => {
    const mixedConfig: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'google' }, // pinned flat
        { kind: 'group', groupId: AI_SEARCH_GROUP },
      ],
      assignments: {},
      groupOrders: {},
    };
    render(<SourceSwitcher sources={sources} groupConfig={mixedConfig} activeId="google" onSelect={vi.fn()} />);
    // google 作为置顶平铺项直接可见
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    // API 搜索作为分组 trigger
    expect(screen.getByRole('button', { name: /API 搜索/ })).toBeInTheDocument();
  });

  // 回归 #2：鼠标从 trigger 穿过视觉缝隙进入浮层时，浮层不应在抵达前被收回。
  // trigger 与浮层间存在视觉缝隙，穿缝会先触发 mouseleave；用 hover-intent 延迟关闭，
  // 使「短暂离开 → 重新进入浮层」不关闭浮层，只有真正离开（超过延迟）才关闭。
  it('keeps the flyout open when the mouse briefly leaves then re-enters (hover-intent bridge)', () => {
    vi.useFakeTimers();
    try {
      render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />);
      const group = screen.getByRole('button', { name: /搜索引擎/ }).parentElement!;
      // 打开浮层
      fireEvent.mouseEnter(group);
      expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
      // 穿缝：先离开（启动延迟关闭），但在延迟窗口内重新进入浮层区域
      fireEvent.mouseLeave(group);
      fireEvent.mouseEnter(group);
      // 延迟尚未到期，浮层仍应打开
      act(() => { vi.advanceTimersByTime(60); });
      expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
      // 真正离开并超过延迟窗口后才关闭
      fireEvent.mouseLeave(group);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('button', { name: /Bing/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 回归：hover-intent 的延迟关闭计时器在组件卸载时必须被清理，
  // 否则卸载后回调仍会触发 onClose（作用到已卸载组件）。
  it('clears the pending close timer on unmount (no callback after teardown)', () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      const { unmount } = render(
        <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={onSelect} />,
      );
      const group = screen.getByRole('button', { name: /搜索引擎/ }).parentElement!;
      fireEvent.mouseEnter(group);
      expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
      // 离开 → 启动延迟关闭（计时器挂起）
      fireEvent.mouseLeave(group);
      // 在延迟窗口内卸载组件
      unmount();
      // 推进时间超过延迟：不应抛出「setState on unmounted」/不应有异常
      expect(() => act(() => { vi.advanceTimersByTime(300); })).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  // 回归：组内 source 被选中时，分类只用小圆点表达归属，不得把 source 的实色
  // 指示器锚定到分类 trigger；展开分类后，亮态只落在实际选中的 source 按钮上。
  // 桩出非零尺寸，避免错误实现因 jsdom 的 offsetWidth=0 而不渲染指示器、漏过断言。
  it('uses only the badge for an active group and highlights the actual source in its flyout', () => {
    const offsets = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(26);
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockReturnValue(10);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(4);
    try {
      const { container } = render(
        <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId="google" onSelect={vi.fn()} />,
      );
      const enginesTrigger = screen.getByRole('button', { name: /搜索引擎/ });
      // 收起态：分类选中状态只能由小圆点表示，不得出现 source 指示器或亮态标记。
      expect(enginesTrigger.querySelector('.group-badge')).toBeTruthy();
      expect(enginesTrigger).not.toHaveAttribute('data-indicator-target');
      expect(enginesTrigger).not.toHaveClass('active');
      expect(container.querySelector('.switcher-indicator')).toBeNull();
      expect(screen.getByRole('button', { name: /API 搜索/ }).querySelector('.group-badge')).toBeNull();

      // 展开后：只有实际选中的 Google source 获得 active 亮态。
      fireEvent.mouseEnter(enginesTrigger.parentElement!);
      const google = screen.getByRole('button', { name: /Google/ });
      expect(google).toHaveClass('active');
      expect(google).toHaveAttribute('data-active', 'true');
      expect(screen.getByRole('button', { name: /Bing/ })).not.toHaveClass('active');
      expect(enginesTrigger).not.toHaveClass('active');
    } finally {
      offsets.mockRestore();
    }
  });
});

describe('SourceSwitcher — click pin (top bar / search page)', () => {
  const groupedConfig = defaultGroupConfig(sources.map((s) => s.id));

  // 点击固定（pin）：顶栏/搜索页与底栏一致——点击打开并固定，
  // 固定后 hover 移出不收起；再点一次关闭。
  it('click group trigger opens + pins the flyout; hover-out does NOT close it; second click closes', () => {
    vi.useFakeTimers();
    try {
      render(
        <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
      );
      const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
      fireEvent.click(aiTrigger);
      expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
      // 点击固定后移开鼠标并超过 hover-intent 延迟窗口，浮层仍保持展开
      fireEvent.mouseLeave(aiTrigger.parentElement!);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
      // 再次点击 → 关闭
      fireEvent.click(aiTrigger);
      expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 回归：hover 瞬态展开中点击 trigger，应转为固定而非收回（用户描述的"点击导致收回"）。
  it('clicking an already hover-open group pins it instead of closing', () => {
    vi.useFakeTimers();
    try {
      render(
        <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
      );
      const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
      fireEvent.mouseEnter(aiTrigger.parentElement!); // hover 瞬态展开
      expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
      fireEvent.click(aiTrigger); // 点击 → 固定（不得关闭）
      fireEvent.mouseLeave(aiTrigger.parentElement!);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape closes a pinned flyout', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.click(aiTrigger);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    aiTrigger.focus();
    fireEvent.keyDown(aiTrigger, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
  });

  // 固定态与底栏一致：页面（shadow 外）pointerdown 关闭固定展开的浮层。
  it('pointerdown outside the group closes a pinned flyout (top bar too)', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.click(aiTrigger);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    document.body.removeChild(outside);
  });

  // 单开语义：固定 A 后 hover 别的组 → A 关闭且固定被清除；hover 回 A 也不恢复固定。
  it('hovering another group clears the pinned group (single-open)', () => {
    vi.useFakeTimers();
    try {
      render(
        <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
      );
      const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
      const enginesGroup = screen.getByRole('button', { name: /搜索引擎/ }).parentElement!;
      fireEvent.click(aiTrigger); // 固定 AI
      expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
      // hover 另一组：AI 固定被清除并关闭，另一组瞬态展开
      fireEvent.mouseEnter(enginesGroup);
      expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
      expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
      // hover 回 AI 不恢复固定：移开并超过延迟窗口后浮层仍关闭
      fireEvent.mouseEnter(aiTrigger.parentElement!);
      fireEvent.mouseLeave(aiTrigger.parentElement!);
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // 本次行为扩展：顶栏瞬态（hover）展开的浮层同样响应外部 pointerdown 关闭。
  it('pointerdown outside the group closes a transient hover-open flyout (top bar)', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.mouseEnter(aiTrigger.parentElement!);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    document.body.removeChild(outside);
  });

  // 守卫回归：pointerdown 落在 trigger 或浮层内部时不关闭（真实点击顺序 pointerdown 先于 click）。
  it('pointerdown on the trigger or inside the flyout keeps it open', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.click(aiTrigger);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    // trigger 上 pointerdown → path 含 groupRef，不关闭
    fireEvent.pointerDown(aiTrigger);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    // 浮层内 item 上 pointerdown → path 含 flyoutRef，不关闭
    fireEvent.pointerDown(screen.getByRole('button', { name: /Tavily/ }));
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
  });
});

describe('SourceSwitcher — bottomMode', () => {
  const groupedConfig = defaultGroupConfig(sources.map((s) => s.id));

  it('renders data-bottom="true" on .source-switcher', () => {
    const { container } = render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} bottomMode />,
    );
    expect(container.querySelector('.source-switcher')).toHaveAttribute('data-bottom', 'true');
  });

  it('click group trigger opens flyout; second click closes', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} bottomMode />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    // 收起：组内 source 不可见
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    fireEvent.click(aiTrigger);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    fireEvent.click(aiTrigger);
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
  });

  // P0-2: 底栏下 focus 不应自动开层（否则触屏 focus→click 竞态导致首次点触空操作）。
  it('focus on trigger does NOT open the flyout in bottomMode', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} bottomMode />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    aiTrigger.focus();
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
  });

  // P0-2: 键盘路径——focus 不开层，但 Enter/Space 应切换开层。
  it('Enter on focused trigger opens the flyout in bottomMode', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} bottomMode />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    aiTrigger.focus();
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    fireEvent.keyDown(aiTrigger, { key: 'Enter' });
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
  });

  it('Space on focused trigger opens the flyout in bottomMode', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} bottomMode />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    aiTrigger.focus();
    fireEvent.keyDown(aiTrigger, { key: ' ' });
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
  });

  // P1-1: 页面（shadow 外）pointerdown 应关闭已展开的浮层。
  it('pointerdown outside the group closes an open flyout in bottomMode', () => {
    render(
      <SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} bottomMode />,
    );
    const aiTrigger = screen.getByRole('button', { name: /API 搜索/ });
    fireEvent.click(aiTrigger);
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    // 在 document 上派发一个落在分组之外的 pointerdown（capture 监听应捕获并关闭）。
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.pointerDown(outside);
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
    document.body.removeChild(outside);
  });
});
