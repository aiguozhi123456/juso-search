import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SearchSource, SourceId } from '@/lib/sources';
import { resolveIconUrl, sourceLabel } from '@/lib/sources';
import type { GroupConfig, SourceLabel } from '@/lib/source-groups';
import { projectLayout, defaultGroupConfig } from '@/lib/source-groups';
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
}

interface IndicatorMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
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
 *   · 指示器跟随「激活/打开项的触发 pill」：置顶源跟随自身 pill，分组内源跟随分组 trigger；
 *   · useLayoutEffect 重新测量目标 pill 的 offset*，CSS transition 完成"滑动"动画；
 *   · 分组 trigger hover 进入时展开浮层（.group-flyout），离开关闭；键盘 onFocus/Blur 同步；
 *   · 同一组件用于搜索页与 SERP 注入栏（shadow DOM 内），两处样式各自维护；
 *   · 测量在 layout 阶段同步完成，避免指示器先飞到 (0,0) 再回弹；
 *   · jsdom 下 offset* 返回 0，指示器宽高为 0、视觉不可见，不影响测试断言。
 */
export function SourceSwitcher({ sources, groupConfig, activeId, onSelect, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorMetrics | null>(null);
  // 当前展开的分组 id（hover/focus 控制）；null 表示全部收起。
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const layout = useMemo(
    () => projectLayout(sources, groupConfig ?? defaultGroupConfig(sources.map((s) => s.id)), activeId),
    [sources, groupConfig, activeId],
  );

  // 决定指示器锚定的 pill data-key：始终跟随「激活源」——
  // 置顶源 → 自身 pill；组内源 → 该分组 trigger。
  // 不跟随 hover 焦点：指示器表达的是「当前选中」，而 hover 展开由分组 trigger
  // 自身的 .open 底色表达。若二者混用，悬停别的分组会让指示器跳过去，造成「选中态
  // 显示重叠 / 错位」——选中态被错误地画在被悬停的分组上。
  const indicatorKey = useMemo(() => {
    if (activeId == null) return null;
    for (const item of layout.items) {
      if (item.kind === 'source') {
        if (item.source.id === activeId) return `s:${item.source.id}`;
      } else if (item.containsActive) {
        return `g:${item.group.id}`;
      }
    }
    return null;
  }, [activeId, layout]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || indicatorKey == null) {
      setIndicator(null);
      return;
    }
    const target = container.querySelector<HTMLElement>(`[data-key="${CSS.escape(indicatorKey)}"]`);
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
  }, [indicatorKey, layout]);

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
      data-active-source={activeId ?? undefined}
      style={style}
    >
      {isReady && <span className="switcher-indicator" aria-hidden="true" />}
      {layout.items.map((item) => {
        if (item.kind === 'source') {
          return (
            <SourceButton
              key={`s:${item.source.id}`}
              source={item.source}
              active={item.source.id === activeId}
              disabled={disabled}
              onSelect={onSelect}
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
            onOpen={() => setOpenGroupId(item.group.id)}
            onClose={() => setOpenGroupId((cur) => (cur === item.group.id ? null : cur))}
          />
        );
      })}
    </div>
  );
}

/** 单个来源 pill（置顶平铺项，或分组浮层内项）。 */
function SourceButton({
  source,
  active,
  disabled,
  onSelect,
}: {
  source: SearchSource;
  active: boolean;
  disabled?: boolean;
  onSelect: (source: SearchSource) => void;
}) {
  const tooltip = source.kind === 'site-engine'
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

/** 分组 pill：trigger + hover 浮层。 */
function GroupPill({
  group,
  items,
  containsActive,
  activeId,
  disabled,
  onSelect,
  open,
  onOpen,
  onClose,
}: {
  group: { id: string; label: SourceLabel };
  items: SearchSource[];
  containsActive: boolean;
  activeId: SourceId | null;
  disabled?: boolean;
  onSelect: (source: SearchSource) => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const label = resolveLabel(group.label);
  // 浮层内每个 source 的按钮 id，用于 aria 与可访问性。
  const groupId = `switcher-group-${group.id}`;
  // hover-intent：trigger 与浮层之间存在视觉缝隙，鼠标穿缝时会先离开 .switcher-group
  // 触发 mouseleave。若立即关闭，浮层会在鼠标抵达前被收回，导致无法切到组内 source。
  // 改为延迟关闭：离开后留一个短窗口，期间重新进入（到 trigger 或浮层）即取消关闭。
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleClose = () => {
    if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 120);
  };
  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  // 卸载时清掉未触发的延迟关闭，避免回调作用到已卸载组件。
  useEffect(() => () => cancelClose(), []);
  return (
    <div
      className={`switcher-group${open ? ' open' : ''}`}
      data-group={group.id}
      onMouseEnter={() => {
        cancelClose();
        onOpen();
      }}
      onMouseLeave={scheduleClose}
      onFocus={onOpen}
      onBlur={(e) => {
        // 仅当焦点离开整个分组（trigger + 浮层）时才关闭。
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          // Escape 关闭浮层并归还焦点到 trigger，保持键盘用户的位置感。
          const trigger = (e.target as HTMLElement).closest('.switcher-group')?.querySelector('.group-trigger') as HTMLElement | null;
          trigger?.focus();
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="group-trigger"
        data-key={`g:${group.id}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={groupId}
        aria-label={t(MSG.source_switcher_group_aria, [label])}
        disabled={disabled}
      >
        <span className="group-label">{label}</span>
        {containsActive && <span className="group-badge" aria-hidden="true" />}
      </button>
      {open && (
        <div className="group-flyout" id={groupId}>
          {items.map((source) => (
            <SourceButton
              key={source.id}
              source={source}
              active={source.id === activeId}
              disabled={disabled}
              onSelect={(s) => {
                onSelect(s);
                onClose();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
