import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SourceSwitcher } from '@/components/SourceSwitcher';
import type { SearchSource } from '@/lib/sources';
import type { ProviderId } from '@/lib/providers/types';
import type { EngineId } from '@/lib/engines/types';

const sources: SearchSource[] = [
  { id: 'tavily' as ProviderId, kind: 'provider', label: 'provider_tavily', supportsAnswer: true },
  { id: 'stepfun' as ProviderId, kind: 'provider', label: 'provider_stepfun', supportsAnswer: false },
  { id: 'google' as EngineId, kind: 'engine', label: 'engine_google', supportsAnswer: false, favicon: '/icons/google.svg' },
  { id: 'bing' as EngineId, kind: 'engine', label: 'engine_bing', supportsAnswer: false, favicon: '/icons/bing.svg' },
  { id: 'baidu' as EngineId, kind: 'engine', label: 'engine_baidu', supportsAnswer: false, favicon: '/icons/baidu.svg' },
];

describe('SourceSwitcher', () => {
  it('renders one button per source with resolved labels', () => {
    render(<SourceSwitcher sources={sources} activeId="tavily" onSelect={vi.fn()} />);
    // i18n 真实查表（默认 zh_CN）
    expect(screen.getByRole('button', { name: /Tavily/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stepfun 按量/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bing/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Baidu/ })).toBeInTheDocument();
  });

  it('marks only the active source with active class + aria-pressed', () => {
    render(<SourceSwitcher sources={sources} activeId="google" onSelect={vi.fn()} />);
    const google = screen.getByRole('button', { name: /Google/ });
    const tavily = screen.getByRole('button', { name: /Tavily/ });
    expect(google).toHaveClass('active');
    expect(google).toHaveAttribute('aria-pressed', 'true');
    expect(tavily).not.toHaveClass('active');
    expect(tavily).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders favicons for engine sources', () => {
    const { container } = render(<SourceSwitcher sources={sources} activeId={null} onSelect={vi.fn()} />);
    // 三个 engine 各一个 favicon（alt="" 为装饰图，不以 img role 暴露，直接查 DOM）
    const imgs = container.querySelectorAll('img.source-icon');
    expect(imgs).toHaveLength(3);
  });

  it('shows the no-answer badge only for providers without answer support', () => {
    render(<SourceSwitcher sources={sources} activeId={null} onSelect={vi.fn()} />);
    const stepfun = screen.getByRole('button', { name: /Stepfun 按量/ });
    expect(stepfun.querySelector('.no-answer')).toBeTruthy();
    const google = screen.getByRole('button', { name: /Google/ });
    expect(google.querySelector('.no-answer')).toBeNull(); // engine 无此标记
  });

  it('calls onSelect with the clicked source', () => {
    const onSelect = vi.fn();
    render(<SourceSwitcher sources={sources} activeId="tavily" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Baidu/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'baidu', kind: 'engine' }));
  });

  it('disables all buttons when disabled', () => {
    render(<SourceSwitcher sources={sources} activeId={null} onSelect={vi.fn()} disabled />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });

  it('renders an empty group when sources is empty', () => {
    const { container } = render(<SourceSwitcher sources={[]} activeId={null} onSelect={vi.fn()} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('exposes a labelled group for accessibility', () => {
    render(<SourceSwitcher sources={sources} activeId={null} onSelect={vi.fn()} />);
    // aria-label → source_switcher_aria → "切换搜索来源"
    expect(screen.getByRole('group', { name: '切换搜索来源' })).toBeInTheDocument();
  });
});
