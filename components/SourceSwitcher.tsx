import { useLayoutEffect, useRef, useState } from 'react';
import type { SearchSource, SourceId } from '@/lib/sources';
import { resolveIconUrl } from '@/lib/sources';
import { t, MSG } from '@/lib/i18n';

interface Props {
  sources: SearchSource[];
  /** 当前激活源 id（provider 或 engine）；可为 null（如未配置 provider）。 */
  activeId: SourceId | null;
  /** 选中某源的回调。是否真正跳转/搜索由宿主决定。 */
  onSelect: (source: SearchSource) => void;
  disabled?: boolean;
}

interface IndicatorMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 统一快切栏：把已配置的 AI provider 与全部常规搜索引擎渲染成同一行 pill。
 * 纯展示组件——跳转（SERP）或序列化写+重搜（Juso 页）由宿主通过 onSelect 决定。
 *
 * 签名交互：滑动指示器（segmented control 风格）。
 *   · 激活态由 absolute 定位的 .switcher-indicator 块承载 brand 实色；
 *   · 切换激活源时，useLayoutEffect 重新测量新激活按钮的 offsetLeft/Top/Width/Height，
 *     通过 CSS 自定义属性更新指示器位置，CSS transition 完成"滑动"动画；
 *   · 同一组件用于搜索页与 SERP 注入栏（shadow DOM 内），两处样式各自维护；
 *   · 测量在 layout 阶段同步完成，避免指示器先飞到 (0,0) 再回弹；
 *   · jsdom 下 offset* 返回 0，指示器宽高为 0、视觉不可见，不影响测试断言。
 */
export function SourceSwitcher({ sources, activeId, onSelect, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorMetrics | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || activeId == null) {
      setIndicator(null);
      return;
    }
    const activeBtn = container.querySelector<HTMLButtonElement>('[data-active="true"]');
    if (!activeBtn) {
      setIndicator(null);
      return;
    }
    setIndicator({
      x: activeBtn.offsetLeft,
      y: activeBtn.offsetTop,
      w: activeBtn.offsetWidth,
      h: activeBtn.offsetHeight,
    });
  }, [activeId, sources, disabled]);

  const isReady = indicator != null && indicator.w > 0;
  const style = isReady
    ? ({
        '--indicator-x': `${indicator!.x}px`,
        '--indicator-y': `${indicator!.y}px`,
        '--indicator-w': `${indicator!.w}px`,
        '--indicator-h': `${indicator!.h}px`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={containerRef}
      className="source-switcher"
      role="group"
      aria-label={t(MSG.source_switcher_aria)}
      style={style}
    >
      {isReady && <span className="switcher-indicator" aria-hidden="true" />}
      {sources.map((s) => {
        const active = s.id === activeId;
        const tooltip = s.supportsAnswer
          ? t(MSG.tooltip_supports_answer)
          : t(MSG.tooltip_no_answer);
        return (
          <button
            key={s.id}
            type="button"
            className={active ? 'active' : ''}
            data-active={active ? 'true' : 'false'}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onSelect(s)}
            title={tooltip}
          >
            {s.favicon && (
              <img
                className="source-icon"
                src={resolveIconUrl(s.favicon)}
                alt=""
                width={14}
                height={14}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
            <span className="source-label">{t(s.label)}</span>
            {s.kind === 'provider' && !s.supportsAnswer && (
              <span className="no-answer">{t(MSG.provider_no_answer_badge)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
