import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AggregateSearchManager } from '@/components/AggregateSearchManager';
import { sendMessage } from '@/lib/messaging';
import type { AggregateConfigSnapshot, AggregateInstanceId } from '@/lib/aggregate/types';
import type { ProviderInstance } from '@/lib/provider-instances';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));

const mockedSend = vi.mocked(sendMessage);

const SNAPSHOT: AggregateConfigSnapshot = {
  instances: [
    { id: 'agg:a', name: '全家桶', members: ['tavily', 'inst:exa:1', 'google'], topN: 20 },
    { id: 'agg:b', name: '失效实例', members: ['tavily'], topN: 5 },
  ],
  eligibility: {
    'agg:a': { eligible: true, validMembers: 3 },
    'agg:b': { eligible: false, validMembers: 0 },
  },
  rerank: { configured: true, hasApiKey: false, endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge-reranker' },
};

const NOT_CONFIGURED: AggregateConfigSnapshot = { instances: [], eligibility: {}, rerank: { configured: false, hasApiKey: false } };

const PROVIDER_INSTANCES: ProviderInstance[] = [
  { id: 'inst:exa:1', baseProviderId: 'exa', name: '深度', options: {} },
];

function renderManager(aggregate: AggregateConfigSnapshot = SNAPSHOT, onChange: () => void = vi.fn()) {
  return render(
    <AggregateSearchManager
      aggregate={aggregate}
      configuredProviderIds={['tavily', 'exa']}
      providerInstances={PROVIDER_INSTANCES}
      onChange={onChange}
    />,
  );
}

/** 打开 inline 编辑器后取表单容器（rerank 卡也有「保存」按钮，须在表单内查询）。 */
function editorForm(): HTMLElement {
  return document.querySelector('.aggregate-instance-form') as HTMLElement;
}

function editorSaveButton(): HTMLElement {
  return within(editorForm()).getByRole('button', { name: '保存' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AggregateSearchManager — 三卡结构与警示条（R12）', () => {
  it('renders the rerank card and the instances card when rerank is configured', () => {
    renderManager();
    expect(screen.getByText('重排服务（全局）')).toBeInTheDocument();
    expect(screen.getByText('聚合实例')).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows the persistent warning banner when the rerank endpoint is empty and does NOT lock instance management', () => {
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, rerank: { configured: false, hasApiKey: false }, eligibility: {} }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent('未配置重排服务，聚合实例不会显示');
    expect(screen.getByRole('button', { name: '新建聚合' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: '编辑' })[0]).toBeEnabled();
    expect(screen.getAllByRole('button', { name: '删除' })[0]).toBeEnabled();
  });

  it('prefills endpoint/model from the snapshot but never renders an api key value', () => {
    renderManager();
    expect(screen.getByLabelText('Endpoint')).toHaveValue('http://127.0.0.1:8000/v1/rerank');
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect((screen.getByLabelText(/API Key/) as HTMLInputElement).type).toBe('password');
    expect(screen.queryByText('已配置')).toBeNull();
  });

  it('shows the full-URL hint under the endpoint field — the path is not auto-appended (用户反馈)', () => {
    // rerankDocuments 直接 POST endpoint 全 URL：填 Base URL（如 http://127.0.0.1:8090/v1）
    // 会 404。hint 明示「含 /v1/rerank 路径，不会自动补全」+ 配套服务示例（端口 8090）；
    // placeholder 同步对齐 8090。按 URL 断言对 zh/en 两份文案都稳健。
    renderManager();
    expect(screen.getByText(/需填完整接口地址/)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:8090\/v1\/rerank/)).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute('placeholder', 'http://127.0.0.1:8090/v1/rerank');
  });
});

describe('AggregateSearchManager — rerank 卡协议下拉（jev/SystemOne）', () => {
  it('defaults the protocol to Cohere/Jina and keeps the cohere hint/placeholder', () => {
    renderManager();
    expect((screen.getByLabelText('协议') as HTMLSelectElement).value).toBe('cohere');
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute('placeholder', 'http://127.0.0.1:8090/v1/rerank');
    expect(screen.getByText(/需填完整接口地址/)).toBeInTheDocument();
  });

  it('restores the stored jev protocol from the snapshot with jev-specific hints', () => {
    renderManager({ ...SNAPSHOT, rerank: { ...SNAPSHOT.rerank, protocol: 'jev' } });
    expect((screen.getByLabelText('协议') as HTMLSelectElement).value).toBe('jev');
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute('placeholder', 'https://api.typesafe.ai/v1/systemone');
    expect(screen.getByText(/api\.typesafe\.ai\/v1\/systemone/)).toBeInTheDocument();
    expect(screen.getByLabelText('模型（可选）')).toHaveAttribute('placeholder', 'jev-latest');
  });

  it('switching the protocol only swaps draft hints without touching entered values', () => {
    renderManager();
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'http://127.0.0.1:9000/v1/rerank' } });
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'jev' } });

    expect(screen.getByLabelText('Endpoint')).toHaveValue('http://127.0.0.1:9000/v1/rerank');
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute('placeholder', 'https://api.typesafe.ai/v1/systemone');
    expect(screen.queryByText(/需填完整接口地址/)).toBeNull();
    expect(screen.getByText(/api\.typesafe\.ai\/v1\/systemone/)).toBeInTheDocument();
  });

  it('sends protocol: jev on save when switched and omits it again for cohere (full-write semantics)', async () => {
    mockedSend.mockResolvedValue({ ok: true, endpoint: 'https://api.typesafe.ai/v1/systemone', rewritten: false });
    renderManager();
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'jev' } });
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://api.typesafe.ai/v1/systemone' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', {
        endpoint: 'https://api.typesafe.ai/v1/systemone',
        model: 'bge-reranker',
        protocol: 'jev',
      }),
    );

    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'cohere' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', {
        endpoint: 'https://api.typesafe.ai/v1/systemone',
        model: 'bge-reranker',
      }),
    );
  });

  it('disables the test button while the protocol draft diverges from the stored snapshot', () => {
    renderManager({ ...SNAPSHOT, rerank: { ...SNAPSHOT.rerank, protocol: 'jev' } });
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'cohere' } });
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
  });
});

describe('AggregateSearchManager — rerank 卡保存链路（KTD12/AE8）', () => {
  it('saves the endpoint, shows the rewritten notice and adopts the normalized value (AE8)', async () => {
    const onChange = vi.fn();
    mockedSend.mockResolvedValueOnce({ ok: true, endpoint: 'http://127.0.0.1:8000/v1/rerank', rewritten: true });
    renderManager(SNAPSHOT, onChange);
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'http://localhost:8000/v1/rerank' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', {
        endpoint: 'http://localhost:8000/v1/rerank',
        model: 'bge-reranker',
      }),
    );
    expect(await screen.findByText('已将 localhost/[::1] 自动改写为 127.0.0.1')).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toHaveValue('http://127.0.0.1:8000/v1/rerank');
    expect(onChange).toHaveBeenCalled();
  });

  it('rejects non-loopback / https endpoints locally without contacting the worker', async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://api.example.com/v1/rerank' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('重排 endpoint 无效：仅允许 http://127.0.0.1（可含端口）、https://api.siliconflow.cn 或 https://api.typesafe.ai');
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('omits an empty api key on save (preserves the stored key); the "configured" badge is snapshot-driven', async () => {
    mockedSend.mockResolvedValue({ ok: true, endpoint: 'http://127.0.0.1:8000/v1/rerank', rewritten: false });
    const { rerender } = renderManager();

    // 空 apiKey：保存负载不携带 apiKey（保留已存值语义）；快照未回流前徽标不亮
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', { endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge-reranker' }),
    );
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(screen.queryByText('已配置')).toBeNull();

    // 填了 apiKey：保存后输入框清空、绝不回显；onChange → syncConfig 快照回流 hasApiKey:true
    // →「已配置」徽标 + 清除按钮出现（Lane G：已配置态由快照驱动，不再用会话内本地投影）
    fireEvent.change(screen.getByLabelText(/API Key/), { target: { value: 'sk-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', expect.objectContaining({ apiKey: 'sk-secret' })),
    );
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    rerender(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, rerank: { ...SNAPSHOT.rerank, hasApiKey: true } }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();

    // 清除：带 apiKey:'' 重发；快照回流 hasApiKey:false → 徽标与清除按钮消失
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', expect.objectContaining({ apiKey: '' })),
    );
    expect(await screen.findByText('已清除 API Key。')).toBeInTheDocument();
    rerender(
      <AggregateSearchManager
        aggregate={SNAPSHOT}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('已配置')).toBeNull();
    expect(screen.queryByRole('button', { name: '清除' })).toBeNull();
  });

  it('restores the configured api-key state from the snapshot alone (cross-session accuracy)', () => {
    // 跨会话准确（Lane G 打磨项 A）：页面重载后无需任何本地动作，快照 hasApiKey:true
    // 直接恢复「已配置」态；值本身永不回显（password 输入恒为空）。
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, rerank: { ...SNAPSHOT.rerank, hasApiKey: true } }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
  });

  it('clears only the api key and never persists dirty unsaved endpoint/model drafts (Oracle #5)', async () => {
    mockedSend.mockResolvedValue({ ok: true, endpoint: 'http://127.0.0.1:8000/v1/rerank', rewritten: false });
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, rerank: { ...SNAPSHOT.rerank, hasApiKey: true } }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={vi.fn()}
      />,
    );

    // 输入框里留有未保存的脏 endpoint/model 草稿
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'http://127.0.0.1:9999/draft' } });
    fireEvent.change(screen.getByLabelText('模型（可选）'), { target: { value: 'draft-model' } });
    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    // 负载只带**快照已存** endpoint/model + apiKey:''——脏草稿既不持久化也不丢（仍在输入框）。
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('setRerankConfig', {
        endpoint: 'http://127.0.0.1:8000/v1/rerank',
        model: 'bge-reranker',
        apiKey: '',
      }),
    );
    expect(await screen.findByText('已清除 API Key。')).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toHaveValue('http://127.0.0.1:9999/draft');
    expect(screen.getByLabelText('模型（可选）')).toHaveValue('draft-model');
  });

  it('renders the worker failure message when clearing the api key returns ok:false (no fake success)', async () => {
    // setRerankConfig 是 ok/error 判别联合：清除失败必须按失败渲染（role="alert"），
    // 绝不落到「已清除 API Key」的假成功，也不触发 onChange 回流。
    const onChange = vi.fn();
    mockedSend.mockResolvedValue({ ok: false, error: { kind: 'invalid', message: '端点无效' } });
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, rerank: { ...SNAPSHOT.rerank, hasApiKey: true } }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('端点无效');
    expect(screen.queryByText('已清除 API Key。')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // 失败后忙态解除：清除按钮回到可用（非永久 saving）。
    expect(screen.getByRole('button', { name: '清除' })).toBeEnabled();
  });
});

describe('AggregateSearchManager — 测试连接分型（KTD6）', () => {
  it('shows ok / keyMissing / providerError results with distinct messages', async () => {
    renderManager();

    mockedSend.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('连接成功')).toBeInTheDocument();

    mockedSend.mockResolvedValueOnce({ ok: false, error: { kind: 'keyMissing', message: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('尚未配置重排服务（rerank endpoint），聚合搜索不可用')).toBeInTheDocument();

    mockedSend.mockResolvedValueOnce({ ok: false, error: { kind: 'providerError', message: 'Rerank: HTTP 500' } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('连接失败：Rerank: HTTP 500')).toBeInTheDocument();
  });

  it('disables test when rerank is unconfigured or the endpoint input diverges from the stored value', () => {
    const { unmount } = render(
      <AggregateSearchManager
        aggregate={NOT_CONFIGURED}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    unmount();

    renderManager();
    const test = screen.getByRole('button', { name: '测试连接' });
    expect(test).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'http://127.0.0.1:9000/v1/rerank' } });
    expect(test).toBeDisabled();
    expect(test).toHaveAttribute('title', '请先保存修改后的 endpoint 再测试');
  });
});

describe('AggregateSearchManager — 实例列表卡（R12）', () => {
  it('renders rows with member summary, topN badge and validity state', () => {
    renderManager();
    expect(screen.getByText('全家桶')).toBeInTheDocument();
    expect(screen.getByText('Tavily、Exa · 深度、Google · 3 个成员')).toBeInTheDocument();
    expect(screen.getByText('top 20')).toBeInTheDocument();
    expect(screen.getByText('top 5')).toBeInTheDocument();
    // 失效实例（0 有效成员）→ 警示图标带分型原因；有效实例无图标
    expect(screen.getByRole('img', { name: '没有有效成员，该实例不会显示' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /重排服务未配置/ })).toBeNull();
  });

  it('marks every instance invalid with the rerank reason while rerank is unconfigured', () => {
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, rerank: { configured: false, hasApiKey: false }, eligibility: {} }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('img', { name: '重排服务未配置，该实例不会显示' })).toHaveLength(2);
  });

  it('deletes through inline two-step confirmation (no sole-instance guard, AE9)', async () => {
    const onChange = vi.fn();
    mockedSend.mockResolvedValue(undefined as never);
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, instances: [SNAPSHOT.instances[0]], eligibility: { 'agg:a': { eligible: true, validMembers: 3 } } }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={PROVIDER_INSTANCES}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText('确定删除「全家桶」吗？')).toBeInTheDocument();
    expect(mockedSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('deleteAggregateInstance', 'agg:a'));
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText('已删除聚合实例。')).toBeInTheDocument();
  });

  it('can cancel the inline delete confirmation', () => {
    renderManager();
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0]);
    expect(screen.queryByText('确定删除「全家桶」吗？')).not.toBeInTheDocument();
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('disables creating and shows the capacity hint at the 50-instance cap', () => {
    const instances = Array.from({ length: 50 }, (_, i) => ({
      id: `agg:cap${i}` as AggregateInstanceId,
      name: `实例${i}`,
      members: ['google' as const],
      topN: 20,
    }));
    const eligibility = Object.fromEntries(instances.map((x) => [x.id, { eligible: true, validMembers: 1 }]));
    render(
      <AggregateSearchManager
        aggregate={{ instances, eligibility, rerank: { configured: true, hasApiKey: false } }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '新建聚合' })).toBeDisabled();
    expect(screen.getByText(/最多 50 个聚合实例/)).toBeInTheDocument();
  });

  it('shows the empty state with the create CTA when there are no instances', () => {
    render(
      <AggregateSearchManager
        aggregate={{ ...SNAPSHOT, instances: [], eligibility: {} }}
        configuredProviderIds={['tavily', 'exa']}
        providerInstances={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/还没有聚合实例/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建聚合' })).toBeEnabled();
  });
});

describe('AggregateSearchManager — 实例编辑器（R2/R9/R12）', () => {
  it('opens create blank: no preselected members, topN 20, save gated on ≥1 valid member', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));

    expect(screen.getByLabelText('名称')).toHaveValue('');
    expect(screen.getByLabelText('topN（重排保留条数）')).toHaveValue(20);
    expect(screen.getByText(/有效成员：0/)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).not.toBeChecked();
    }
    expect(editorSaveButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '全家桶' } });
    expect(editorSaveButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tavily' }));
    expect(editorSaveButton()).toBeEnabled();
    expect(screen.getByText(/有效成员：1/)).toBeInTheDocument();
  });

  it('shows a live name character count', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'abc' } });
    expect(screen.getByText('3 / 40')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveAttribute('maxlength', '40');
  });

  it('derives the two-section checklist from snapshot + extractor registry with the fixed engine warning (R9/KTD15③)', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));

    // API 节：已配置 provider 裸行（Tavily）；有实例的 Exa 展开为「Exa · 深度」子行，不投影裸 Exa 行
    expect(screen.getByRole('checkbox', { name: 'Tavily' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Exa · 深度' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Exa' })).toBeNull();
    // 未配置 provider 不出现（清单只列有效候选）
    expect(screen.queryByRole('checkbox', { name: 'Brave Search' })).toBeNull();

    // 传统引擎节：extractor registry 派生（9 引擎全带 extractor）+ 节头固定警示文案
    expect(screen.getByRole('checkbox', { name: 'Google' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '搜狗公众号' })).toBeInTheDocument();
    expect(screen.getByText(/后台标签页/)).toBeInTheDocument();

    // 勾选引擎计入有效成员
    fireEvent.click(screen.getByRole('checkbox', { name: 'Google' }));
    expect(screen.getByText(/有效成员：1/)).toBeInTheDocument();
  });

  it('clamps topN into [5, 20] on save and at the stepper bounds (KTD8)', async () => {
    mockedSend.mockResolvedValueOnce({ id: 'agg:new', name: 'X', members: ['tavily'], topN: 5 });
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tavily' }));

    const topN = screen.getByLabelText('topN（重排保留条数）');
    const form = editorForm();
    // 默认 20 = 上界 → 「增加」禁用
    expect(within(form).getByRole('button', { name: '增加 topN' })).toBeDisabled();
    // 越界输入在 blur 时钳回界内
    fireEvent.change(topN, { target: { value: '99' } });
    fireEvent.blur(topN);
    expect(topN).toHaveValue(20);
    // 保存前钳位下界：2 → 5
    fireEvent.change(topN, { target: { value: '2' } });
    fireEvent.click(editorSaveButton());
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('createAggregateInstance', { name: 'X', members: ['tavily'], topN: 5 }),
    );
  });

  it('blocks non-integer keys in the topN input (e/E/./+/-); digit and control keys pass; blur clamp stays as fallback', () => {
    // Lane G 打磨项 B：type=number 允许 e/E/./+/- 进入中间态（"1e5"、"--"），后续 blur 钳位
    // 会兜底，但期间有效成员计数/stepper 状态会闪错值。keydown 直接拦截单字符非数字键，
    // 控制键（Backspace/方向键/Tab）与 Ctrl/Meta/Alt 组合（复制粘贴）放行。
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));
    const topN = screen.getByLabelText('topN（重排保留条数）');
    expect(topN).toHaveValue(20);

    // 原生 KeyboardEvent + defaultPrevented 断言：被拦截 ⇔ defaultPrevented=true。
    const press = (init: KeyboardEventInit): boolean => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      topN.dispatchEvent(event);
      return event.defaultPrevented;
    };

    for (const key of ['e', 'E', '.', '+', '-', ' ']) {
      expect(press({ key }), `key "${key}" should be blocked`).toBe(true);
    }
    // 数字与控制键放行（不阻止默认行为）
    for (const key of ['1', '0', 'Backspace', 'ArrowUp', 'ArrowDown', 'Tab']) {
      expect(press({ key }), `key "${key}" should pass`).toBe(false);
    }
    // Ctrl/Meta 组合（如粘贴）放行；粘贴进来的垃圾仍由 blur 钳位兜底
    expect(press({ key: 'v', ctrlKey: true })).toBe(false);
    expect(press({ key: 'v', metaKey: true })).toBe(false);

    // 兜底仍在：越界/垃圾值在 blur 时钳回界内
    fireEvent.change(topN, { target: { value: '99' } });
    fireEvent.blur(topN);
    expect(topN).toHaveValue(20);
  });

  it('saves members in checklist display order regardless of click order', async () => {
    mockedSend.mockResolvedValueOnce({ id: 'agg:new', name: '乱序', members: ['tavily', 'google'], topN: 20 });
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '乱序' } });
    // 先勾引擎（清单靠后）、再勾 API（清单靠前）→ 保存仍按两节清单序
    fireEvent.click(screen.getByRole('checkbox', { name: 'Google' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tavily' }));
    fireEvent.click(editorSaveButton());
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('createAggregateInstance', { name: '乱序', members: ['tavily', 'google'], topN: 20 }),
    );
  });

  it('round-trips every field through edit → save (name/members/topN), id invisible in edit mode', async () => {
    const onChange = vi.fn();
    mockedSend.mockResolvedValueOnce({ ...SNAPSHOT.instances[0], name: '全家桶2', topN: 15 });
    renderManager(SNAPSHOT, onChange);
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    expect(screen.getByLabelText('名称')).toHaveValue('全家桶');
    expect(screen.getByLabelText('topN（重排保留条数）')).toHaveValue(20);
    expect(screen.getByRole('checkbox', { name: 'Tavily' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Exa · 深度' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Google' })).toBeChecked();
    expect(screen.getByText(/有效成员：3/)).toBeInTheDocument();
    // edit 态 id 隐形不可改（无身份字段渲染）
    expect(screen.queryByText(/agg:/)).toBeNull();

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '全家桶2' } });
    // stepper 20 → 15（5 次「减少」）
    const decrease = screen.getByRole('button', { name: '减少 topN' });
    for (let i = 0; i < 5; i += 1) fireEvent.click(decrease);
    fireEvent.click(editorSaveButton());
    await waitFor(() =>
      expect(mockedSend).toHaveBeenCalledWith('updateAggregateInstance', {
        id: 'agg:a',
        patch: { name: '全家桶2', members: ['tavily', 'inst:exa:1', 'google'], topN: 15 },
      }),
    );
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText('已更新聚合实例。')).toBeInTheDocument();
  });

  it('cancel discards the draft without persisting', () => {
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '草稿' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tavily' }));
    fireEvent.click(within(editorForm()).getByRole('button', { name: '取消' }));

    expect(mockedSend).not.toHaveBeenCalled();
    expect(screen.queryByText('草稿')).not.toBeInTheDocument();
    expect(screen.getByText('全家桶')).toBeInTheDocument();
  });

  it('shows a failure status when the worker rejects create', async () => {
    mockedSend.mockRejectedValue(new Error('invalid_aggregate_instance'));
    renderManager();
    fireEvent.click(screen.getByRole('button', { name: '新建聚合' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tavily' }));
    fireEvent.click(editorSaveButton());
    expect(await screen.findByText('保存失败，请重试。')).toBeInTheDocument();
  });
});
