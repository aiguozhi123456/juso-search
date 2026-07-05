import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';

// 组件接线单测：hook 由 theme.test.tsx 覆盖，这里只验 click→setPref/opt.value、active 类、aria-pressed。
const setPref = vi.fn();
let currentPref: 'auto' | 'light' | 'dark' = 'auto';

vi.mock('@/lib/useTheme', () => ({
  useTheme: () => ({ pref: currentPref, resolved: 'light', setPref }),
}));

function renderWith(pref: 'auto' | 'light' | 'dark') {
  currentPref = pref;
  setPref.mockClear();
  render(<ThemeToggle />);
}

describe('ThemeToggle', () => {
  it('renders three buttons (auto/light/dark)', () => {
    renderWith('auto');
    // i18n 用真实查表（默认 zh_CN），theme_group → "主题"
    const group = screen.getByRole('group', { name: '主题' });
    expect(group.querySelectorAll('button')).toHaveLength(3);
  });

  it('clicking a button calls setPref with that option value', () => {
    renderWith('auto');
    // 三个按钮按 OPTIONS 顺序：auto 🌓 / light ☀️ / dark 🌙
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]); // dark
    expect(setPref).toHaveBeenCalledWith('dark');
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('marks only the active option with active class + aria-pressed', () => {
    renderWith('dark');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveClass('active');
    expect(buttons[0]).not.toHaveClass('active');
  });
});
