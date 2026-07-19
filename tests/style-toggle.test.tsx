import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StyleToggle } from '@/components/StyleToggle';

// 组件接线单测：mirror tests/theme-toggle.test.tsx。
// useStyle 由 style.test.tsx 覆盖；此处只验 click→setPref、OPTIONS 顺序、active 类、aria-pressed。
const setPref = vi.fn();
let currentPref: 'classic' | 'colorful' = 'classic';

vi.mock('@/lib/useStyle', () => ({
  useStyle: () => ({ pref: currentPref, setPref }),
}));

function renderWith(pref: 'classic' | 'colorful') {
  currentPref = pref;
  setPref.mockClear();
  render(<StyleToggle />);
}

describe('StyleToggle', () => {
  it('renders two buttons (classic / colorful)', () => {
    renderWith('classic');
    // i18n 真实查表（默认 zh_CN），style_group → "风格"
    const group = screen.getByRole('group', { name: '风格' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '经典' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '彩色' })).toBeInTheDocument();
  });

  it('clicking the colorful button calls setPref with "colorful"', () => {
    renderWith('classic');
    // OPTIONS 顺序：classic / colorful
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(setPref).toHaveBeenCalledWith('colorful');
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('marks only the active option with active class + aria-pressed', () => {
    renderWith('colorful');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveClass('active');
    expect(buttons[0]).not.toHaveClass('active');
  });

  it('switching from colorful back to classic calls setPref with classic', () => {
    renderWith('colorful');
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(setPref).toHaveBeenCalledWith('classic');
  });
});
