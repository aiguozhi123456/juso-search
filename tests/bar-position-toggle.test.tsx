import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BarPositionToggle } from '@/components/BarPositionToggle';

// 组件接线单测：mirror tests/style-toggle.test.tsx。
// useBarPosition 由 bar-position.test.tsx 覆盖；此处只验 click→setPref、OPTIONS 顺序、active 类、aria-pressed。
const setPref = vi.fn();
let currentPref: 'auto' | 'top' | 'inline' | 'bottom' = 'auto';

vi.mock('@/lib/useBarPosition', () => ({
  useBarPosition: () => ({ pref: currentPref, setPref }),
}));

function renderWith(pref: 'auto' | 'top' | 'inline' | 'bottom') {
  currentPref = pref;
  setPref.mockClear();
  render(<BarPositionToggle />);
}

describe('BarPositionToggle', () => {
  it('renders four buttons (自动 / 顶栏 / 内联 / 底栏)', () => {
    renderWith('auto');
    // i18n 真实查表（默认 zh_CN），bar_position_group → "快切栏栏位"
    const group = screen.getByRole('group', { name: '快切栏栏位' });
    expect(group.querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '自动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '顶栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '内联' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '底栏' })).toBeInTheDocument();
  });

  it('clicking the top button calls setPref with "top"', () => {
    renderWith('auto');
    // OPTIONS 顺序：auto / top / inline / bottom
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(setPref).toHaveBeenCalledWith('top');
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('clicking the inline button calls setPref with "inline"', () => {
    renderWith('auto');
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[2]);
    expect(setPref).toHaveBeenCalledWith('inline');
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('clicking the bottom button calls setPref with "bottom"', () => {
    renderWith('auto');
    // OPTIONS 顺序：auto / top / inline / bottom
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[3]);
    expect(setPref).toHaveBeenCalledWith('bottom');
    expect(setPref).toHaveBeenCalledTimes(1);
  });

  it('marks only the active option with active class + aria-pressed', () => {
    renderWith('bottom');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[3]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[3]).toHaveClass('active');
    expect(buttons[0]).not.toHaveClass('active');
  });

  it('switching from bottom back to auto calls setPref with auto', () => {
    renderWith('bottom');
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(setPref).toHaveBeenCalledWith('auto');
  });
});
