import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

/** 激活段几何（相对测量根的 offset 坐标），经 CSS 变量 --indicator-x/y/w/h 驱动指示器。 */
export interface IndicatorMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlidingIndicator {
  /** 分段按钮容器（指示器的 offsetParent），同时是默认测量根。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 就绪时返回 --indicator-x/y/w/h 变量组；未就绪为 undefined（CSS 回退 active 段实色 bg）。 */
  style: CSSProperties | undefined;
  /** 测量成功且宽度 > 0（jsdom 下 offset* 恒 0 → false，不渲染指示器）。 */
  isReady: boolean;
}

/**
 * 滑动指示器共享机制（分段控件 segmented control）。
 * 此前在 StyleToggle / AiAutoEnterToggle / FlatLayoutToggle / SelectionSearchToggle /
 * BarPositionToggle / SourceSwitcher 六处逐字重复，此处为单一实现。
 *
 * 机制：
 *   - layout 阶段测量激活段（selector 在测量根内命中的元素）的 offsetLeft/Top/Width/Height；
 *   - 以 CSS 变量 --indicator-x/y/w/h 喂给 *-indicator 绝对定位元素，CSS transition 呈现滑动；
 *   - 测量失败（无根 / selector 为 null / 无命中）→ 发布 null，指示器不渲染，
 *     回退 active 段实色 bg（[style*="--indicator-w"] 兜底由 CSS 承担）。
 *
 * 重测时机（除「每次渲染后」外均为陈旧几何修复）：
 *   - 每次渲染后：激活段切换、locale 切语言后文案宽度变化（options 根 useLocale 重渲染整树）、
 *     以及六处原实现各自 effect deps 覆盖的一切时刻——deps 都是会触发渲染的 state/props，
 *     故「每渲染重测」是原有重测时机的超集，视觉行为不变；
 *   - 测量根尺寸变化：ResizeObserver，覆盖晚到 webfont、父布局挤压等无渲染的尺寸变化；
 *   - webfont 加载完成：document.fonts ready / loadingdone，字体替换改变文本宽度。
 *   几何未变化时等值短路：不触发无谓重渲染，也切断 ResizeObserver 反馈回路。
 *
 * 环境降级：jsdom 的 offset* 恒 0（isReady=false，与原实现一致）；无 ResizeObserver /
 * document.fonts 的环境静默跳过对应观察，其余行为不变。
 */
export function useSlidingIndicator(
  selector: string | null,
  rootRef?: RefObject<HTMLElement | null>,
): SlidingIndicator {
  const containerRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<IndicatorMetrics | null>(null);
  // 上次发布值：等值守卫基准。
  const publishedRef = useRef<IndicatorMetrics | null>(null);
  // 异步观察（ResizeObserver / fonts）触达的最新测量闭包；每渲染的 layout effect 刷新，
  // ref 赋值发生在 commit 阶段（layout effect 内），不在渲染期写 ref。
  const measureRef = useRef<() => void>(() => {});

  const publish = (next: IndicatorMetrics | null) => {
    const prev = publishedRef.current;
    if (prev === next) return;
    if (
      prev != null && next != null &&
      prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h
    ) {
      return;
    }
    publishedRef.current = next;
    setMetrics(next);
  };

  // 每次渲染后重测：layout 阶段同步完成，指示器不会先飞到 (0,0) 再回弹；
  // measure 捕获本次渲染的 selector。
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef?.current ?? containerRef.current;
      if (!root || selector == null) {
        publish(null);
        return;
      }
      const target = root.querySelector<HTMLElement>(selector);
      if (!target) {
        publish(null);
        return;
      }
      publish({
        x: target.offsetLeft,
        y: target.offsetTop,
        w: target.offsetWidth,
        h: target.offsetHeight,
      });
    };
    measureRef.current = measure;
    measure();
  });

  // 无渲染伴随的几何变化：测量根尺寸变化与 webfont 加载完成。回调经 measureRef 取
  // 最新测量闭包；卸载后丢弃（ disposed 守卫）。挂载时根元素已确定（ref 先于 effect 赋值）。
  useLayoutEffect(() => {
    const root = rootRef?.current ?? containerRef.current;
    if (!root) return;
    let disposed = false;
    const requestMeasure = () => {
      if (!disposed) measureRef.current();
    };
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(requestMeasure) : null;
    ro?.observe(root);
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.ready?.then(requestMeasure).catch(() => {
      // fonts.ready 理论上不 reject；兜底避免 unhandled rejection。
    });
    fonts?.addEventListener?.('loadingdone', requestMeasure);
    return () => {
      disposed = true;
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', requestMeasure);
    };
  }, [rootRef]);

  const isReady = metrics != null && metrics.w > 0;
  const style = isReady
    ? ({
        '--indicator-x': `${metrics!.x}px`,
        '--indicator-y': `${metrics!.y}px`,
        '--indicator-w': `${metrics!.w}px`,
        '--indicator-h': `${metrics!.h}px`,
      } as CSSProperties)
    : undefined;

  return { containerRef, style, isReady };
}
