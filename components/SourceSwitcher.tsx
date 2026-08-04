import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SearchSource, SourceId } from '@/lib/sources';
import { resolveIconUrl, sourceLabel } from '@/lib/sources';
import type { GroupConfig, SourceLabel } from '@/lib/source-groups';
import { projectLayout, defaultGroupConfig } from '@/lib/source-groups';
import { scrollChildToCenter } from '@/lib/scroll-child-to-center';
import { t, MSG } from '@/lib/i18n';

interface Props {
  /** 已投影的候选源（含顺序/显隐，由宿主用 allSources 产出）。 */
  sources: SearchSource[];
  /** 来源分组与顶层布局配置；缺失时回退默认分组（全部按类型入组）。 */
  groupConfig: GroupConfig;
  /** 当前激活源 id（provider 或 engine）；可为 null（如未配置 provider）。 */
  activeId: SourceId | null;
  /** 选中某源的回调。是否真正跳转/搜索由宿主决定。 */
  onSelect: (source: SearchSource) => void;
  disabled?: boolean;
  /**
   * 覆盖层定位模式，三态：
   *   · null/undefined（默认）= 内联（搜索页顶栏）：无横滑轨道、无 active 居中，
   *     flyout 走既有 .group-flyout 的 top:100% 向下展开；
   *   · 'bottom' = 底部覆盖层：横滑轨道 + active 居中，flyout fixed 锚定向上展开；
   *   · 'top' = 顶部覆盖层：横滑轨道 + active 居中，flyout fixed 锚定向下展开。
   * 点击切换（固定展开）为各模式统一行为，见组件头注释。
   */
  overlayPosition?: 'top' | 'bottom' | null;
}

interface IndicatorMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FlyoutAnchor {
  left: number;
  bottom?: number;
  top?: number;
}

/** 解析分组/来源标签为可见文本（i18n key 走 t()，字面量直出）。 */
function resolveLabel(label: SourceLabel): string {
  return label.kind === 'literal' ? label.value : t(label.key);
}

/**
 * 统一快切栏：把已配置的 AI provider 与全部常规搜索引擎投影成同一行。
 * 顶层是混合序列——置顶 source（裸平铺 pill）与分组（折叠 pill，hover 展开浮层）同级。
 * 纯展示组件——跳转（SERP）或序列化写+重搜（Juso 页）由宿主通过 onSelect 决定。
 *
 * 签名交互：滑动指示器（segmented control 风格）。
 *   · 激活态由 absolute 定位的 .switcher-indicator 块承载 brand 实色；
 *   · 指示器只跟随激活的置顶 source；组内 source 的分类状态仅由 trigger 小圆点表达；
 *   · useLayoutEffect 重新测量目标 pill 的 offset*，CSS transition 完成"滑动"动画；
 *   · 分组 trigger hover 进入时展开浮层（.group-flyout），离开关闭；键盘 onFocus/Blur 同步；
 *   · 分组 trigger 点击固定展开（两模式一致）：收起→打开并固定；瞬态展开中点击→转为固定；
 *     固定后 hover 移出不收起，仅再点/Escape/外部点击/选中组内源时关闭；
 *   · overlayPosition（'bottom'/'top'）：轨道横滑、指示器在 track 内、active 居中、
 *     flyout fixed（向上/向下）、点击切换；
 *   · 同一组件用于搜索页与 SERP 注入栏（shadow DOM 内），两处样式各自维护；
 *   · 测量在 layout 阶段同步完成，避免指示器先飞到 (0,0) 再回弹；
 *   · jsdom 下 offset* 返回 0，指示器宽高为 0、视觉不可见，不影响测试断言。
 */
export function SourceSwitcher({ sources, groupConfig, activeId, onSelect, disabled, overlayPosition = null }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // overlayPosition 非 null 即覆盖层模式（top/bottom 共用横滑轨道、active 居中与 fixed flyout）。
  const isOverlay = overlayPosition !== null;
  const trackRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorMetrics | null>(null);
  // 当前展开的分组 id（hover/focus/click 控制）；null 表示全部收起。
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  // 点击固定的分组 id：固定后不因 hover 移出而收起，仅显式关闭（再点/Escape/外部点击/选中组内源）。
  const [pinnedGroupId, setPinnedGroupId] = useState<string | null>(null);

  const layout = useMemo(
    () => projectLayout(sources, groupConfig ?? defaultGroupConfig(sources.map((s) => s.id)), activeId),
    [sources, groupConfig, activeId],
  );

  // 决定指示器锚定的置顶 source pill。组内 source 不把指示器投射到分类 trigger：
  // source 的亮态只属于实际 source，分类选中状态仅由 containsActive 小圆点表达。
  const indicatorKey = useMemo(() => {
    if (activeId == null) return null;
    for (const item of layout.items) {
      if (item.kind === 'source') {
        if (item.source.id === activeId) return `s:${item.source.id}`;
      }
    }
    return null;
  }, [activeId, layout]);

  // 居中目标：置顶 active pill，或含 active 的分组 trigger（组内不重排 DOM）。
  const centerKey = useMemo(() => {
    if (activeId == null) return null;
    for (const item of layout.items) {
      if (item.kind === 'source' && item.source.id === activeId) return `s:${item.source.id}`;
      if (item.kind === 'group' && item.containsActive) return `g:${item.group.id}`;
    }
    return null;
  }, [activeId, layout]);

  useLayoutEffect(() => {
    // 指示器相对 track（覆盖层模式横滑时与 pill 同滚动上下文）；内联/搜索页 track 不滚动，等价于原 container。
    const measureRoot = trackRef.current ?? containerRef.current;
    if (!measureRoot || indicatorKey == null) {
      setIndicator(null);
      return;
    }
    const target = measureRoot.querySelector<HTMLElement>(`[data-key="${CSS.escape(indicatorKey)}"]`);
    if (!target) {
      setIndicator(null);
      return;
    }
    setIndicator({
      x: target.offsetLeft,
      y: target.offsetTop,
      w: target.offsetWidth,
      h: target.offsetHeight,
    });
  }, [indicatorKey, layout, overlayPosition]);

  useLayoutEffect(() => {
    if (!isOverlay || centerKey == null) return;
    const track = trackRef.current;
    if (!track) return;
    const target = track.querySelector<HTMLElement>(`[data-key="${CSS.escape(centerKey)}"]`);
    if (!target) return;
    scrollChildToCenter(track, target);
  }, [overlayPosition, centerKey, layout]);

  // 覆盖层 scroll-hide 或模式切换时关闭浮层，避免 fixed 菜单悬空。
  useEffect(() => {
    if (!isOverlay) {
      setOpenGroupId(null);
      setPinnedGroupId(null);
    }
  }, [overlayPosition]);

  // 覆盖层 host 被 data-hidden 藏起时关闭浮层（scroll-hide 不走 unmount）。
  useEffect(() => {
    if (!isOverlay) return;
    const el = containerRef.current;
    if (!el) return;
    const root = el.getRootNode();
    const host = root instanceof ShadowRoot
      ? (root.host as HTMLElement)
      : (el.closest?.('[data-position]') as HTMLElement | null);
    if (!host) return;
    const obs = new MutationObserver(() => {
      if (host.dataset.hidden === 'true') {
        setOpenGroupId(null);
        setPinnedGroupId(null);
      }
    });
    obs.observe(host, { attributes: true, attributeFilter: ['data-hidden'] });
    return () => obs.disconnect();
  }, [overlayPosition]);

  const isReady = indicator != null && indicator.w > 0;
  const style = isReady
    ? ({
        '--indicator-x': `${indicator!.x}px`,
        '--indicator-y': `${indicator!.y}px`,
        '--indicator-w': `${indicator!.w}px`,
        '--indicator-h': `${indicator!.h}px`,
      } as React.CSSProperties)
    : undefined;
  // 指示器锚定的那个 pill 的 data-key。CSS 用 [data-indicator-target="true"]
  // 精确清除「该 pill 自身的 .active/.open 底色」，避免指示器实色与按钮底色叠加。
  // 此前用 [style*="--indicator-w"] 全局清除所有 .active 按钮底色，会误伤浮层内
  // 的 active 项（其后无指示器 → 白字透明底不可见）。
  const indicatorTargetKey = isReady ? indicatorKey : null;

  const pills = layout.items.map((item) => {
    if (item.kind === 'source') {
      const key = `s:${item.source.id}`;
      return (
        <SourceButton
          key={key}
          source={item.source}
          active={item.source.id === activeId}
          disabled={disabled}
          onSelect={onSelect}
          indicatorTarget={indicatorTargetKey === key}
        />
      );
    }
    return (
      <GroupPill
        key={`g:${item.group.id}`}
        group={item.group}
        items={item.items}
        containsActive={item.containsActive}
        activeId={activeId}
        disabled={disabled}
        onSelect={onSelect}
        open={openGroupId === item.group.id}
        pinned={pinnedGroupId === item.group.id}
        onOpen={() => {
          setOpenGroupId(item.group.id);
          // hover/focus 展开为瞬态：单开语义下，固定的是别的组时清掉旧固定；
          // 且 hover 回原组也不恢复固定（固定只能由点击产生）。
          setPinnedGroupId((cur) => (cur === item.group.id ? cur : null));
        }}
        onClose={() => {
          setOpenGroupId((cur) => (cur === item.group.id ? null : cur));
          setPinnedGroupId((cur) => (cur === item.group.id ? null : cur));
        }}
        onToggle={() => {
          if (openGroupId === item.group.id) {
            if (pinnedGroupId === item.group.id) {
              // 固定展开 → 关闭并取消固定。
              setOpenGroupId(null);
              setPinnedGroupId(null);
            } else {
              // 瞬态展开 → 固定。
              setPinnedGroupId(item.group.id);
            }
          } else {
            // 收起 → 打开并固定。
            setOpenGroupId(item.group.id);
            setPinnedGroupId(item.group.id);
          }
        }}
        overlayPosition={overlayPosition}
      />
    );
  });

  return (
    <div
      ref={containerRef}
      className="source-switcher"
      role="group"
      aria-label={t(MSG.source_switcher_aria)}
      data-active-source={activeId ?? undefined}
      data-overlay={overlayPosition ?? undefined}
    >
      <div ref={trackRef} className="switcher-track" style={style}>
        {isReady && <span className="switcher-indicator" aria-hidden="true" />}
        {pills}
      </div>
    </div>
  );
}

/** 单个来源 pill（置顶平铺项，或分组浮层内项）。 */
function SourceButton({
  source,
  active,
  disabled,
  onSelect,
  indicatorTarget,
}: {
  source: SearchSource;
  active: boolean;
  disabled?: boolean;
  onSelect: (source: SearchSource) => void;
  /** 该 pill 是否为指示器锚定目标（仅置顶源可能为 true；浮层内项恒为 false）。 */
  indicatorTarget?: boolean;
}) {
  const tooltip = source.kind === 'ai-engine'
    ? t(MSG.tooltip_ai_engine)
    : source.kind === 'site-engine'
      ? t(MSG.tooltip_site_engine)
      : source.supportsAnswer
        ? t(MSG.tooltip_supports_answer)
        : t(MSG.tooltip_no_answer);
  const label = sourceLabel(source, t);
  return (
    <button
      type="button"
      className={active ? 'active' : ''}
      data-active={active ? 'true' : 'false'}
      data-source={source.id}
      data-key={`s:${source.id}`}
      data-indicator-target={indicatorTarget ? 'true' : undefined}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onSelect(source)}
      title={tooltip}
    >
      {source.favicon && (
        <img
          className="source-icon"
          src={resolveIconUrl(source.favicon)}
          alt=""
          width={14}
          height={14}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      )}
      <span className="source-label">{label}</span>
      {source.kind === 'provider' && !source.supportsAnswer && (
        <span className="no-answer">{t(MSG.provider_no_answer_badge)}</span>
      )}
    </button>
  );
}

/** 分组 pill：trigger + hover/click 浮层。 */
function GroupPill({
  group,
  items,
  containsActive,
  activeId,
  disabled,
  onSelect,
  open,
  pinned,
  onOpen,
  onClose,
  onToggle,
  overlayPosition,
}: {
  group: { id: string; label: SourceLabel };
  items: SearchSource[];
  containsActive: boolean;
  activeId: SourceId | null;
  disabled?: boolean;
  onSelect: (source: SearchSource) => void;
  open: boolean;
  /** 是否点击固定（固定后 hover 移出不收起）。 */
  pinned: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
  overlayPosition: 'top' | 'bottom' | null;
}) {
  const label = resolveLabel(group.label);
  // overlayPosition 非 null 即覆盖层模式（top/bottom 共用 fixed flyout 行为）。
  const isOverlay = overlayPosition !== null;
  // 浮层内每个 source 的按钮 id，用于 aria 与可访问性。
  const groupId = `switcher-group-${group.id}`;
  const groupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [flyoutAnchor, setFlyoutAnchor] = useState<FlyoutAnchor | null>(null);
  // hover-intent：trigger 与浮层之间存在视觉缝隙，鼠标穿缝时会先离开 .switcher-group
  // 触发 mouseleave。若立即关闭，浮层会在鼠标抵达前被收回，导致无法切到组内 source。
  // 改为延迟关闭：离开后留一个短窗口，期间重新进入（到 trigger 或浮层）即取消关闭。
  // 点击固定的分组不受延迟关闭影响（pinnedRef 读取最新固定态）。
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  // onClose 的本地包装：显式关闭路径（Escape/外部 pointerdown/blur/选中组内源）
  // 都先取消挂起的 hover-intent 延迟关闭，避免旧定时器到期后再触发幂等 onClose。
  const handleClose = () => {
    cancelClose();
    onClose();
  };
  const scheduleClose = () => {
    if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (!pinnedRef.current) handleClose();
    }, 120);
  };
  // 卸载时清掉未触发的延迟关闭，避免回调作用到已卸载组件。
  useEffect(() => () => cancelClose(), []);

  // 覆盖层 fixed flyout：按 trigger 视口盒锚定到上方（bottom）或下方（top）
  // （host 无 backdrop-filter 时 fixed 相对 viewport）。
  useLayoutEffect(() => {
    if (!open || !isOverlay) {
      setFlyoutAnchor(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      let left = rect.left;
      // 粗略右缘夹紧，避免 flyout 贴出视口（flyout 宽度未知时用 200 作下限估计）。
      const maxLeft = Math.max(0, window.innerWidth - 200);
      if (left > maxLeft) left = maxLeft;
      if (left < 0) left = 0;
      if (overlayPosition === 'top') {
        // 顶部覆盖层：flyout 从 trigger 下缘向下展开。
        setFlyoutAnchor({ left, top: rect.bottom + 4 });
      } else {
        // 底部覆盖层：flyout 从 trigger 上缘向上展开。
        setFlyoutAnchor({ left, bottom: window.innerHeight - rect.top + 4 });
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, overlayPosition]);

  // 点外部关闭（各模式统一）：触屏无可靠 hover-out（覆盖层主路径），
  // 内联/搜索页固定态同理。监听 document（capture），页面（shadow 外）的点击
  // 也能命中；composedPath 含 shadow 内后代，path.includes 判断对 shadow 内点击同样有效。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      const path = typeof (e as PointerEvent).composedPath === 'function'
        ? (e as PointerEvent).composedPath()
        : [];
      if (groupRef.current && path.includes(groupRef.current)) return;
      if (flyoutRef.current && path.includes(flyoutRef.current)) return;
      handleClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, handleClose]);

  const flyoutStyle: React.CSSProperties | undefined = isOverlay && flyoutAnchor
    ? overlayPosition === 'top'
      ? {
          position: 'fixed',
          left: flyoutAnchor.left,
          top: flyoutAnchor.top,
          bottom: 'auto',
          right: 'auto',
        }
      : {
          position: 'fixed',
          left: flyoutAnchor.left,
          bottom: flyoutAnchor.bottom,
          top: 'auto',
          right: 'auto',
        }
    : undefined;

  return (
    <div
      ref={groupRef}
      className={`switcher-group${open ? ' open' : ''}`}
      data-group={group.id}
      onMouseEnter={() => {
        // 覆盖层 + 粗指针（触屏）：禁用 hover 开层，避免点触后 hover 粘滞。
        if (isOverlay && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return;
        cancelClose();
        onOpen();
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        // 覆盖层：不靠 focus 开层。触屏 focus 先于 click，若 focus 开层会被 click 关掉
        // （首次点触空操作）；键盘用户用 Enter/Space 触发 click→onToggle 开层。
        if (isOverlay) return;
        onOpen();
      }}
      onBlur={(e) => {
        // 仅当焦点离开整个分组（trigger + 浮层）时才关闭。
        // fixed flyout 可能不在 currentTarget 子树内：用 flyoutRef 检查。
        const related = e.relatedTarget as Node | null;
        if (groupRef.current?.contains(related)) return;
        if (flyoutRef.current?.contains(related)) return;
        handleClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          // Escape 关闭浮层并归还焦点到 trigger，保持键盘用户的位置感。
          triggerRef.current?.focus();
          handleClose();
          return;
        }
        // 覆盖层键盘路径：Enter/Space 显式切换（与 click→onToggle 等价，兜底防止
        // 某些合成键盘事件不派发 click）。
        if (isOverlay && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
          if (e.target === triggerRef.current) {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="group-trigger"
        data-key={`g:${group.id}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={groupId}
        aria-label={t(MSG.source_switcher_group_aria, [label])}
        disabled={disabled}
        onClick={(e) => {
          // 点击切换（两模式一致）：收起→打开并固定；瞬态展开→固定；固定→关闭。
          e.stopPropagation();
          onToggle();
        }}
      >
        <span className="group-label">{label}</span>
        {containsActive && <span className="group-badge" aria-hidden="true" />}
      </button>
      {open && (
        <div
          ref={flyoutRef}
          className={`group-flyout${overlayPosition === 'bottom' ? ' group-flyout--fixed-up' : overlayPosition === 'top' ? ' group-flyout--fixed-down' : ''}`}
          id={groupId}
          style={flyoutStyle}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {items.map((source) => (
            <SourceButton
              key={source.id}
              source={source}
              active={source.id === activeId}
              disabled={disabled}
              onSelect={(s) => {
                onSelect(s);
                handleClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
