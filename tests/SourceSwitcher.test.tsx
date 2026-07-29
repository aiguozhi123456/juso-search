import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  return { groups: DEFAULT_GROUPS, layout, assignments: {} };
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
    // 两个分组 trigger：AI 搜索 / 搜索引擎（站点组为空不渲染）
    expect(screen.getByRole('button', { name: /AI 搜索/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /搜索引擎/ })).toBeInTheDocument();
    // 收起态下不渲染组内 source 按钮
    expect(screen.queryByRole('button', { name: /Tavily/ })).toBeNull();
  });

  it('shows a badge on the group that contains the active source', () => {
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId="tavily" onSelect={vi.fn()} />);
    const aiTrigger = screen.getByRole('button', { name: /AI 搜索/ });
    expect(aiTrigger.querySelector('.group-badge')).toBeTruthy();
    const enginesTrigger = screen.getByRole('button', { name: /搜索引擎/ });
    expect(enginesTrigger.querySelector('.group-badge')).toBeNull();
  });

  it('expands the flyout on hover and renders inner source buttons', () => {
    render(<SourceSwitcher sources={sources} groupConfig={groupedConfig} activeId={null} onSelect={vi.fn()} />);
    const aiTrigger = screen.getByRole('button', { name: /AI 搜索/ });
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
    const aiTrigger = screen.getByRole('button', { name: /AI 搜索/ });
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
    };
    render(<SourceSwitcher sources={sources} groupConfig={mixedConfig} activeId="google" onSelect={vi.fn()} />);
    // google 作为置顶平铺项直接可见
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    // AI 搜索作为分组 trigger
    expect(screen.getByRole('button', { name: /AI 搜索/ })).toBeInTheDocument();
  });
});
