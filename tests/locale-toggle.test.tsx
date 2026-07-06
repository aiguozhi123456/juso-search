import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LocaleToggle } from '@/components/LocaleToggle';

// 组件接线单测：useLocale 由 storage 测试覆盖，这里验 click→setPref、active 类、aria-pressed。
const setPref = vi.fn();
let currentPref: 'auto' | 'zh_CN' | 'en' = 'auto';

vi.mock('@/lib/useLocale', () => ({
  useLocale: () => ({ pref: currentPref, setPref }),
}));

function renderWith(pref: 'auto' | 'zh_CN' | 'en') {
  currentPref = pref;
  setPref.mockClear();
  render(<LocaleToggle />);
}

describe('LocaleToggle', () => {
  it('renders three buttons (auto/zh/en)', () => {
    renderWith('auto');
    // i18n 用真实查表（默认 zh_CN），locale_group → "语言"
    const group = screen.getByRole('group', { name: '语言' });
    expect(group.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '自动 (语言)' })).toHaveTextContent('自动');
    expect(screen.getByRole('button', { name: '中文' })).toHaveTextContent('中文');
    expect(screen.getByRole('button', { name: 'English' })).toHaveTextContent('English');
  });

  it('clicking the EN button calls setPref with "en"', () => {
    renderWith('auto');
    const buttons = screen.getAllByRole('button');
    // OPTIONS 顺序：auto / zh_CN / en
    fireEvent.click(buttons[2]);
    expect(setPref).toHaveBeenCalledWith('en');
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('marks only the active option with active class + aria-pressed', () => {
    renderWith('zh_CN');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false'); // auto
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true'); // zh_CN
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false'); // en
    expect(buttons[1]).toHaveClass('active');
  });
});
