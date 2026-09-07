import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '@/entrypoints/onboarding/App';
import { navigateToSearchPage } from '@/entrypoints/onboarding/navigate';
import { sendMessage } from '@/lib/messaging';
import { setOnboardingCompleted } from '@/lib/storage';
import { allProviders } from '@/lib/providers/registry';
import { allEngines } from '@/lib/engines/registry';
import { allAiEngines } from '@/lib/ai-engines/registry';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));
// 主题/locale/style 由各自单测覆盖；页面测试隔离掉，避免依赖 matchMedia/storage.onChanged
vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: 'auto', resolved: 'light', setPref: vi.fn() }),
}));
vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: 'auto', setPref: vi.fn() }),
}));
vi.mock('@/lib/useStyle', () => ({
  useStyle: () => ({ pref: 'classic', setPref: vi.fn() }),
}));
// 引导页只写完成标记；mock 掉 storage 域，避免依赖 browser.storage.local
vi.mock('@/lib/storage', () => ({
  setOnboardingCompleted: vi.fn().mockResolvedValue(undefined),
}));
// 收尾导航独立模块（jsdom 的 location.replace 不可重定义），mock 后断言调用
vi.mock('@/entrypoints/onboarding/navigate', () => ({ navigateToSearchPage: vi.fn() }));

const mockedSend = vi.mocked(sendMessage);
const mockedSetCompleted = vi.mocked(setOnboardingCompleted);
const mockedNavigate = vi.mocked(navigateToSearchPage);
const tabsCreate = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('browser', {
  runtime: { getURL: (path: string) => `chrome-extension://testid${path}` },
  tabs: { create: tabsCreate },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedSetCompleted.mockResolvedValue(undefined);
  tabsCreate.mockResolvedValue(undefined);
  // 引导页挂载即拉取脱敏配置状态（默认已配置 tavily + exa）
  mockedSend.mockImplementation(((() => Promise.resolve({ configuredProviderIds: ['tavily', 'exa'] })) as never));
});
/** 步骤圆点辅助：返回当前激活步索引。 */
function activeStep() {
  const dots = document.querySelectorAll('.onboarding-dots__dot');
  return Array.from(dots).findIndex((d) => d.classList.contains('onboarding-dots__dot--active'));
}

describe('onboarding page', () => {
  it('renders the welcome step with live source counts from the registries', () => {
    render(<App />);
    expect(screen.getByText('一个框，搜遍所有来源')).toBeInTheDocument();
    // 数字取自 registry 而非硬编码文案，registry 扩容时引导页与测试同步变化
    expect(screen.getByText(new RegExp(`${allProviders().length} 个 AI 搜索 provider`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${allEngines().length} 个传统搜索引擎`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${allAiEngines().length} 个 AI 对话引擎`))).toBeInTheDocument();
    expect(document.querySelectorAll('.onboarding-dots__dot')).toHaveLength(4);
    expect(activeStep()).toBe(0);
  });

  it('navigates forward through features to the keys step and shows the sanitized configured count', async () => {
    render(<App />);
    // welcome(0) → features(1) → keys(2)
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('配置 API 密钥')).toBeInTheDocument();
    expect(await screen.findByText(/已配置 2 \/ \d+ 个 AI 搜索 provider/)).toBeInTheDocument();
    expect(mockedSend).toHaveBeenCalledWith('getProviderConfig', undefined);
    expect(activeStep()).toBe(2);
  });

  it('shows the unconfigured status when no provider key is set', async () => {
    mockedSend.mockImplementation(((() => Promise.resolve({ configuredProviderIds: [] })) as never));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByText('尚未配置任何 AI 搜索 provider')).toBeInTheDocument();
  });

  it('deep-links the settings button to the keys tab via tabs.create', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开设置，配置密钥' }));
    await waitFor(() =>
      expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://testid/options.html?group=keys' }),
    );
  });

  it('navigates back from the keys step through features to the welcome step', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    // keys(2) → features(1)：上一步先落在功能页
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByText('功能速览')).toBeInTheDocument();
    expect(activeStep()).toBe(1);
    // features(1) → welcome(0)
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByText('一个框，搜遍所有来源')).toBeInTheDocument();
    expect(activeStep()).toBe(0);
  });

  it('renders the feature tour with the agent entry as the fifth list item', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('功能速览')).toBeInTheDocument();
    expect(screen.getByText('快切栏')).toBeInTheDocument();
    expect(screen.getByText('划词搜索')).toBeInTheDocument();
    expect(screen.getByText('右键菜单')).toBeInTheDocument();
    expect(screen.getByText('自定义引擎')).toBeInTheDocument();
    // agent 项并入功能列表末尾（原第三页 agent sub 迁移至此）
    expect(screen.getByText('给智能体用')).toBeInTheDocument();
    expect(activeStep()).toBe(1);
  });

  it('renders the groups step with the source layout demo', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('自定义分组与排序')).toBeInTheDocument();
    // 来源布局示意：复用编辑器真实结构与样式类（options/styles.css），
    // 渲染开箱可见的两枚分组；动画演示组内拖拽排序（编辑器真实支持的拖拽操作）
    const demo = document.querySelector('.onboarding-layout-demo');
    expect(demo).not.toBeNull();
    expect(demo?.querySelectorAll('.layout-row--group')).toHaveLength(2);
    expect(screen.getByText('API 搜索')).toBeInTheDocument();
    expect(screen.getByText('搜索引擎')).toBeInTheDocument();
    expect(screen.getAllByText('分组')).toHaveLength(2);
    expect(demo?.querySelectorAll('.layout-group-member')).toHaveLength(5);
    expect(screen.getByText('Baidu')).toBeInTheDocument();
    expect(activeStep()).toBe(3);
  });

  it('deep-links the two 去设置 buttons to general (features) and search (groups) tabs', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    // features 步：agent 项的「去设置」→ general
    fireEvent.click(screen.getByRole('button', { name: '去设置' }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://testid/options.html?group=general' });
    // groups 步：分组设置的「去设置」→ search
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '去设置' }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome-extension://testid/options.html?group=search' });
  });

  it('finish marks onboarding completed and replaces the page with the search page', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '完成，开始搜索' }));
    await waitFor(() => expect(mockedSetCompleted).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mockedNavigate).toHaveBeenCalled());
  });

  it('skip marks onboarding completed too and navigates to the search page', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    await waitFor(() => expect(mockedSetCompleted).toHaveBeenCalledWith(true));
    await waitFor(() => expect(mockedNavigate).toHaveBeenCalled());
  });

  it('still navigates away when persisting the completion flag fails', async () => {
    mockedSetCompleted.mockRejectedValue(new Error('storage unavailable'));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '跳过引导' }));
    await waitFor(() => expect(mockedNavigate).toHaveBeenCalled());
    expect(mockedSetCompleted).toHaveBeenCalledWith(true);
  });
});
