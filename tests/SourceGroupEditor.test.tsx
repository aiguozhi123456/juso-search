import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { EngineId } from '@/lib/engines/types';
import type { ProviderId } from '@/lib/providers/types';
import type { SearchSource } from '@/lib/sources';
import { sourceLabel } from '@/lib/sources';
import { SourceGroupEditor } from '@/components/SourceGroupEditor';
import { defaultGroupConfig } from '@/lib/source-groups';
import { sendMessage } from '@/lib/messaging';
import { t, MSG } from '@/lib/i18n';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));

const mockedSend = vi.mocked(sendMessage);

// 构造一组覆盖 provider / engine 两种 kind 的测试 source。
const sources: SearchSource[] = [
  { id: 'tavily' as ProviderId, kind: 'provider', label: 'provider_tavily', supportsAnswer: true },
  { id: 'google' as EngineId, kind: 'engine', label: 'engine_google', supportsAnswer: false, favicon: '/icons/google.svg' },
];

// 解析按钮标签（随测试环境 locale 变化，避免硬编码文案）。
const LABEL = {
  newGroup: () => t(MSG.opts_group_new),
  newPlaceholder: () => t(MSG.opts_group_new_placeholder),
  rename: () => t(MSG.opts_group_rename),
  delete: () => t(MSG.opts_group_delete),
  saveFailed: () => t(MSG.opts_group_save_failed),
};

function resolveLabel(source: SearchSource): string {
  return sourceLabel(source, t);
}

beforeEach(() => {
  vi.clearAllMocks();
});

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
    expect(lastCall.groups.every((g: { id: string }) => g.id === 'ai-search' || g.id === 'engines' || g.id === 'sites')).toBe(true);
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
