import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { EngineId } from '@/lib/engines/types';
import type { ProviderId } from '@/lib/providers/types';
import type { SearchSource } from '@/lib/sources';
import { sourceLabel } from '@/lib/sources';
import { SourceGroupEditor } from '@/components/SourceGroupEditor';
import { defaultGroupConfig, DEFAULT_GROUPS, type GroupConfig } from '@/lib/source-groups';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));

const mockedSend = vi.mocked(sendMessage);

// 构造一组覆盖 provider / engine 两种 kind 的测试 source。
const sources: SearchSource[] = [
  { id: 'tavily' as ProviderId, kind: 'provider', label: 'provider_tavily', supportsAnswer: true },
  { id: 'google' as EngineId, kind: 'engine', label: 'engine_google', supportsAnswer: false, favicon: '/icons/google.svg' },
];

// 拖拽/组内排序用例：两组各两个成员，便于观察顺序变化。
const multiSources: SearchSource[] = [
  { id: 'tavily' as ProviderId, kind: 'provider', label: 'provider_tavily', supportsAnswer: true },
  { id: 'exa' as ProviderId, kind: 'provider', label: 'provider_exa', supportsAnswer: true },
  { id: 'google' as EngineId, kind: 'engine', label: 'engine_google', supportsAnswer: false, favicon: '/icons/google.svg' },
  { id: 'bing' as EngineId, kind: 'engine', label: 'engine_bing', supportsAnswer: false, favicon: '/icons/bing.svg' },
];

// 带显式组内顺序的分组配置。
function orderedGroupConfig(): GroupConfig {
  return {
    groups: DEFAULT_GROUPS,
    layout: [
      { kind: 'group', groupId: 'ai-search' },
      { kind: 'group', groupId: 'engines' },
    ],
    assignments: {},
    groupOrders: {
      'ai-search': ['exa', 'tavily'],
      'engines': ['google', 'bing'],
    },
  };
}

// 解析按钮标签（随测试环境 locale 变化，避免硬编码文案）。
const LABEL = {
  newGroup: () => t(MSG.opts_group_new),
  newPlaceholder: () => t(MSG.opts_group_new_placeholder),
  rename: () => t(MSG.opts_group_rename),
  delete: () => t(MSG.opts_group_delete),
  pin: () => t(MSG.opts_group_pin_source),
  saveFailed: () => t(MSG.opts_group_save_failed),
};

function resolveLabel(source: SearchSource): string {
  return sourceLabel(source, t);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// jsdom 无真实 DataTransfer：用带 setData/getData 的最小 mock。
function dragDataTransfer() {
  return { setData: vi.fn(), getData: vi.fn() };
}

describe('SourceGroupEditor — render', () => {
  it('renders the default groups (built-ins are not deletable)', () => {
    const cfg = defaultGroupConfig(sources.map((s) => s.id));
    render(
      <SourceGroupEditor sources={sources} groupConfig={cfg} onChange={vi.fn()} resolveLabel={resolveLabel} />,
    );
    // 三个内置分组各一行；内置组无「删除」按钮。
    expect(screen.queryAllByRole('button', { name: LABEL.delete() })).toHaveLength(0);
    // AI 搜索 / 搜索引擎 / 站点 的分组标签经 i18n 解析后应可见（这里只断言重命名按钮存在）。
    expect(screen.getAllByRole('button', { name: LABEL.rename() }).length).toBeGreaterThan(0);
  });
});

describe('SourceGroupEditor — persist success', () => {
  it('optimistically applies onChange and sends setGroupConfig', async () => {
    const cfg = defaultGroupConfig(sources.map((s) => s.id));
    const onChange = vi.fn();
    mockedSend.mockResolvedValue(undefined as never);
    render(
      <SourceGroupEditor sources={sources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );

    // 新建一个自定义分组：填名 + 点「新建分组」。
    const input = screen.getByPlaceholderText(LABEL.newPlaceholder());
    fireEvent.change(input, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: LABEL.newGroup() }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('setGroupConfig', expect.anything()));
    // onChange 被乐观推进（携带新增分组的 next 配置）。
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.groups.some((g: { id: string }) => g.id !== 'ai-search' && g.id !== 'engines' && g.id !== 'sites')).toBe(true);
  });
});

describe('SourceGroupEditor — persist rollback', () => {
  it('rolls back to the previous config and surfaces the error when setGroupConfig rejects', async () => {
    const cfg = defaultGroupConfig(sources.map((s) => s.id));
    const onChange = vi.fn();
    mockedSend.mockRejectedValue(new Error('boom') as never);
    render(
      <SourceGroupEditor sources={sources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );

    const input = screen.getByPlaceholderText(LABEL.newPlaceholder());
    fireEvent.change(input, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: LABEL.newGroup() }));

    // 失败后：先乐观 onChange(next)，再回滚 onChange(previous)。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    // 最后一次 onChange 是回滚（previous：仍是默认配置，无自定义分组）。
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.groups.every((g: { id: string }) => g.id === 'ai-search' || g.id === 'engines' || g.id === 'sites' || g.id === 'custom')).toBe(true);
    // 错误提示可见。
    expect(await screen.findByText(LABEL.saveFailed())).toBeInTheDocument();
  });
});

describe('SourceGroupEditor — builtin group protection', () => {
  it('does not show a Delete button for builtin groups', () => {
    const cfg = defaultGroupConfig(sources.map((s) => s.id));
    render(
      <SourceGroupEditor sources={sources} groupConfig={cfg} onChange={vi.fn()} resolveLabel={resolveLabel} />,
    );
    // 内置三组都不可删；没有任何行带 删除 按钮。
    expect(screen.queryAllByRole('button', { name: LABEL.delete() })).toHaveLength(0);
  });

  it('shows a Delete button for a custom group', () => {
    const cfg = defaultGroupConfig(sources.map((s) => s.id));
    // 追加一个自定义分组（含 layout 项）。
    cfg.groups.push({ id: 'g-custom', label: { kind: 'literal', value: 'Custom' } });
    cfg.layout.push({ kind: 'group', groupId: 'g-custom' });
    render(
      <SourceGroupEditor sources={sources} groupConfig={cfg} onChange={vi.fn()} resolveLabel={resolveLabel} />,
    );
    expect(screen.getByRole('button', { name: LABEL.delete() })).toBeInTheDocument();
  });
});

describe('SourceGroupEditor — groupOrders maintenance', () => {
  it('pinSource removes the source from every groupOrders entry (empty keys cleaned)', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    // ai-search 的显式顺序仅含 tavily：置顶后该条目清空 → 整条 key 清理。
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'group', groupId: 'ai-search' },
        { kind: 'group', groupId: 'engines' },
      ],
      assignments: {},
      groupOrders: { 'ai-search': ['tavily'], 'engines': ['google', 'bing'] },
    };
    render(
      <SourceGroupEditor sources={multiSources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    // 组内成员行的「置顶」按钮（aria-label 不含源名，按所在 chip 定位）。
    const chip = screen.getAllByText('Tavily')[0].closest('.layout-group-member');
    fireEvent.click(within(chip as HTMLElement).getByRole('button', { name: LABEL.pin() }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    // ai-search 的显式顺序移除 tavily 后为空 → 整条 key 清理；engines 不受影响。
    expect(next.groupOrders).toEqual({ 'engines': ['google', 'bing'] });
    // 置顶项追加到 layout 末尾，assignment 清除。
    expect(next.layout[next.layout.length - 1]).toEqual({ kind: 'source', sourceId: 'tavily' });
    expect(next.assignments.tavily).toBeUndefined();
  });

  it('foldIntoGroup appends the source to the target group order and removes it from the old one', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'tavily' }, // 已置顶
        { kind: 'group', groupId: 'ai-search' },
        { kind: 'group', groupId: 'engines' },
      ],
      assignments: {},
      groupOrders: { 'engines': ['google', 'bing'] },
    };
    render(
      <SourceGroupEditor sources={multiSources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    // 置顶行的「收入分组」select：从 __pinned__ 改选 engines（编辑器内唯一的 select）。
    const foldSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(foldSelect, { target: { value: 'engines' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    // layout 中移除置顶项；assignment 写入；组内顺序 = 显式顺序 + 末尾追加。
    expect(next.layout.some((item) => item.kind === 'source' && item.sourceId === 'tavily')).toBe(false);
    expect(next.assignments.tavily).toBe('engines');
    expect(next.groupOrders['engines']).toEqual(['google', 'bing', 'tavily']);
  });

  it('foldIntoGroup into a group without explicit order appends to its member order (no cross-group pollution)', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    // 旧组 ai-search 有显式顺序 ['exa']；目标组 engines 无显式顺序。
    // 回归：不能以旧组顺序为基底（会把 exa 写进 engines 顺序）。
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'tavily' }, // 已置顶
        { kind: 'group', groupId: 'ai-search' },
        { kind: 'group', groupId: 'engines' },
      ],
      assignments: {},
      groupOrders: { 'ai-search': ['exa'] },
    };
    render(
      <SourceGroupEditor sources={multiSources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const foldSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(foldSelect, { target: { value: 'engines' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    // 新组顺序 = 新组成员序（google, bing）+ 末尾追加 tavily；不混入旧组的 exa。
    expect(next.groupOrders['engines']).toEqual(['google', 'bing', 'tavily']);
    // 旧组显式顺序保持原样（tavily 本就不在其中）。
    expect(next.groupOrders['ai-search']).toEqual(['exa']);
  });

  it('deleteGroup drops the groupOrders entry', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onChange = vi.fn();
    const cfg: GroupConfig = {
      groups: [...DEFAULT_GROUPS, { id: 'g-custom', label: { kind: 'literal', value: 'Custom' } }],
      layout: [
        { kind: 'group', groupId: 'ai-search' },
        { kind: 'group', groupId: 'engines' },
        { kind: 'group', groupId: 'g-custom' },
      ],
      assignments: { tavily: 'g-custom' },
      groupOrders: { 'g-custom': ['tavily'], 'engines': ['google', 'bing'] },
    };
    render(
      <SourceGroupEditor sources={multiSources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: LABEL.delete() }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    expect(next.groupOrders['g-custom']).toBeUndefined();
    expect(next.groupOrders['engines']).toEqual(['google', 'bing']);
    confirmSpy.mockRestore();
  });
});

describe('SourceGroupEditor — drag & drop reordering', () => {
  it('drags a member chip within its group and persists the new groupOrders', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const { container } = render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const dt = dragDataTransfer();
    const chips = Array.from(container.querySelectorAll('.layout-group-member')) as HTMLElement[];
    const exa = chips.find((c) => c.textContent?.includes('Exa')) as HTMLElement;
    const tavily = chips.find((c) => c.textContent?.includes('Tavily')) as HTMLElement;
    fireEvent.dragStart(exa, { dataTransfer: dt });
    fireEvent.dragOver(tavily, { dataTransfer: dt });
    fireEvent.drop(tavily, { dataTransfer: dt });
    fireEvent.dragEnd(exa, { dataTransfer: dt });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    // exa（index 0）drop 到 tavily（index 1）：remove+insert → [tavily, exa]
    expect(next.groupOrders['ai-search']).toEqual(['tavily', 'exa']);
    // 组内顺序独立于全局 sourceOrder：engines 的显式顺序不被触碰。
    expect(next.groupOrders['engines']).toEqual(['google', 'bing']);
    expect(mockedSend).toHaveBeenCalledWith('setGroupConfig', expect.anything());
  });

  it('drags a top-level row and persists the new layout order', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const { container } = render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const dt = dragDataTransfer();
    const rows = Array.from(container.querySelectorAll('.layout-row--group')) as HTMLElement[];
    // orderedGroupConfig 的 layout 只有 ai-search/engines；组件内 normalizeGroupConfig 把缺失的
    // 内置组（sites/custom）追加到末尾（L4），故编辑器渲染 4 行。
    expect(rows).toHaveLength(4);
    fireEvent.dragStart(rows[0], { dataTransfer: dt });
    fireEvent.dragOver(rows[1], { dataTransfer: dt });
    fireEvent.drop(rows[1], { dataTransfer: dt });
    fireEvent.dragEnd(rows[0], { dataTransfer: dt });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    // 拖动 row[0](ai-search) 到 row[1](engines)：remove+insert 交换两者，末尾追加的 sites/custom 位置不变。
    expect(next.layout.map((item) => item.kind === 'group' ? item.groupId : item.sourceId))
      .toEqual(['engines', 'ai-search', 'sites', 'custom']);
  });

  it('does not reorder across groups (cross-group member drag is a no-op)', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const { container } = render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const dt = dragDataTransfer();
    const chips = Array.from(container.querySelectorAll('.layout-group-member')) as HTMLElement[];
    const exa = chips.find((c) => c.textContent?.includes('Exa')) as HTMLElement; // ai-search
    const google = chips.find((c) => c.textContent?.includes('Google')) as HTMLElement; // engines
    fireEvent.dragStart(exa, { dataTransfer: dt });
    fireEvent.dragOver(google, { dataTransfer: dt });
    fireEvent.drop(google, { dataTransfer: dt });
    fireEvent.dragEnd(exa, { dataTransfer: dt });
    // 跨组拖拽被忽略：无乐观更新、无持久化。
    expect(onChange).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalledWith('setGroupConfig', expect.anything());
  });

  it('rolls back a dragged reorder when persisting fails', async () => {
    mockedSend.mockRejectedValue(new Error('boom') as never);
    const onChange = vi.fn();
    const { container } = render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const dt = dragDataTransfer();
    const chips = Array.from(container.querySelectorAll('.layout-group-member')) as HTMLElement[];
    const exa = chips.find((c) => c.textContent?.includes('Exa')) as HTMLElement;
    const tavily = chips.find((c) => c.textContent?.includes('Tavily')) as HTMLElement;
    fireEvent.dragStart(exa, { dataTransfer: dt });
    fireEvent.dragOver(tavily, { dataTransfer: dt });
    fireEvent.drop(tavily, { dataTransfer: dt });
    fireEvent.dragEnd(exa, { dataTransfer: dt });
    // 先乐观 onChange(next)，失败后再回滚 onChange(previous)。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as GroupConfig;
    expect(lastCall.groupOrders['ai-search']).toEqual(['exa', 'tavily']);
    expect(await screen.findByText(LABEL.saveFailed())).toBeInTheDocument();
  });

  it('member up/down arrows reorder the group order (touch fallback)', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    // 边界：组内首成员「上移」禁用、末成员「下移」禁用。
    expect(screen.getByRole('button', { name: t(MSG.opts_group_move_up, ['Exa']) })).toBeDisabled();
    expect(screen.getByRole('button', { name: t(MSG.opts_group_move_down, ['Tavily']) })).toBeDisabled();
    // 点击 Exa 下移：与拖拽同走 moveGroupMember（remove+insert）→ [tavily, exa]。
    fireEvent.click(screen.getByRole('button', { name: t(MSG.opts_group_move_down, ['Exa']) }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    expect(next.groupOrders['ai-search']).toEqual(['tavily', 'exa']);
    // 其它组的显式顺序不受影响。
    expect(next.groupOrders['engines']).toEqual(['google', 'bing']);
    expect(mockedSend).toHaveBeenCalledWith('setGroupConfig', expect.anything());
  });

  it('foldIntoGroup into a partially-ordered group materializes the full order (new member lands last)', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    // engines 只有部分显式序（仅 google，bing 未列出）：fold 后应物化全量，
    // 保证 tavily 真正排在渲染末尾（排在补尾的 bing 之后）。
    const cfg: GroupConfig = {
      groups: DEFAULT_GROUPS,
      layout: [
        { kind: 'source', sourceId: 'tavily' }, // 已置顶
        { kind: 'group', groupId: 'ai-search' },
        { kind: 'group', groupId: 'engines' },
      ],
      assignments: {},
      groupOrders: { 'engines': ['google'] },
    };
    render(
      <SourceGroupEditor sources={multiSources} groupConfig={cfg} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const foldSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(foldSelect, { target: { value: 'engines' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as GroupConfig;
    expect(next.groupOrders['engines']).toEqual(['google', 'bing', 'tavily']);
  });

  it('dragging from a member button does not start a reorder drag (misclick guard)', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const { container } = render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const dt = dragDataTransfer();
    const chips = Array.from(container.querySelectorAll('.layout-group-member')) as HTMLElement[];
    const exa = chips.find((c) => c.textContent?.includes('Exa')) as HTMLElement;
    const tavily = chips.find((c) => c.textContent?.includes('Tavily')) as HTMLElement;
    const pinButton = within(exa).getByRole('button', { name: LABEL.pin() });
    // 从芯片内按钮上按下再拖到其它成员：拖拽被守卫取消 → 无排序、无持久化。
    fireEvent.dragStart(pinButton, { dataTransfer: dt });
    fireEvent.dragOver(tavily, { dataTransfer: dt });
    fireEvent.drop(tavily, { dataTransfer: dt });
    fireEvent.dragEnd(pinButton, { dataTransfer: dt });
    expect(onChange).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalledWith('setGroupConfig', expect.anything());
  });

  it('dragging from a top-level row button does not start a layout drag', async () => {
    mockedSend.mockResolvedValue(undefined as never);
    const onChange = vi.fn();
    const { container } = render(
      <SourceGroupEditor sources={multiSources} groupConfig={orderedGroupConfig()} onChange={onChange} resolveLabel={resolveLabel} />,
    );
    const dt = dragDataTransfer();
    const rows = Array.from(container.querySelectorAll('.layout-row--group')) as HTMLElement[];
    const renameButton = within(rows[0]).getByRole('button', { name: LABEL.rename() });
    fireEvent.dragStart(renameButton, { dataTransfer: dt });
    fireEvent.dragOver(rows[1], { dataTransfer: dt });
    fireEvent.drop(rows[1], { dataTransfer: dt });
    fireEvent.dragEnd(renameButton, { dataTransfer: dt });
    expect(onChange).not.toHaveBeenCalled();
    expect(mockedSend).not.toHaveBeenCalledWith('setGroupConfig', expect.anything());
  });
});
