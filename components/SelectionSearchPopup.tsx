import { useState, useRef, useEffect, useCallback } from 'react';
import type { SearchSource } from '@/lib/sources';
import { resolveIconUrl, sourceLabel } from '@/lib/sources';
import type { GroupConfig, SourceLabel } from '@/lib/source-groups';
import { projectLayout, resolveEffectiveLayout } from '@/lib/source-groups';
import { t } from '@/lib/i18n';

interface Props {
  sources: SearchSource[];
  groupConfig: GroupConfig;
  primarySource: SearchSource;
  flatLayoutFewSources: boolean;
  onSearch: (source: SearchSource) => void;
}

function resolveLabel(label: SourceLabel): string {
  return label.kind === 'literal' ? label.value : t(label.key);
}

/**
 * 划词搜索弹窗：主 chip（统一放大镜图标 + 固定源名称，点击即搜）
 * + 展开箭头（hover/click 出分组源列表）。
 *
 * 交互（复用快切栏 SourceSwitcher 的 hover-intent 模式）：
 *  - hover 展开箭头区域 → 打开 flyout
 *  - 离开 → 150ms 延迟关闭（穿缝保护）
 *  - 重新进入 → 取消关闭
 *  - 点击展开按钮 → 切换开关（触屏 fallback）
 *  - 分组侧边展开：hover 分组行 → 子浮层向右展开（级联菜单模式）
 *  - 点击固定分组时连带固定主浮层（分组固定依赖主浮层存活）
 */
export function SelectionSearchPopup({ sources, groupConfig, primarySource, flatLayoutFewSources, onSearch }: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);
  pinnedRef.current = pinned;
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [pinnedGroupId, setPinnedGroupId] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandAreaRef = useRef<HTMLDivElement>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current != null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      if (!pinnedRef.current) setOpen(false);
    }, 150);
  }, []);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      const path = typeof (e as PointerEvent).composedPath === 'function'
        ? (e as PointerEvent).composedPath()
        : [];
      if (expandAreaRef.current && path.includes(expandAreaRef.current)) return;
      cancelClose();
      setOpen(false);
      setPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, cancelClose]);

  useEffect(() => {
    if (!open) {
      setOpenGroupId(null);
      setPinnedGroupId(null);
    }
  }, [open]);

  const handleGroupOpen = (id: string) => {
    setOpenGroupId(id);
    setPinnedGroupId((cur) => (cur === id ? cur : null));
  };
  const handleGroupClose = (id: string) => {
    setOpenGroupId((cur) => (cur === id ? null : cur));
    setPinnedGroupId((cur) => (cur === id ? null : cur));
  };
  const handleGroupToggle = (id: string) => {
    if (openGroupId === id) {
      if (pinnedGroupId === id) {
        setOpenGroupId(null);
        setPinnedGroupId(null);
      } else {
        // 瞬态展开 → 固定。分组固定依赖主浮层存活（主浮层关闭会重置分组状态），
        // 点击固定分组时连带把主浮层提升为固定，否则 hover 瞬态主浮层
        // 会在移出后 150ms 收起并连带清除分组固定。
        cancelClose();
        setPinned(true);
        setPinnedGroupId(id);
      }
    } else {
      // 收起 → 打开并固定（同样连带固定主浮层，理由同上）。
      cancelClose();
      setPinned(true);
      setOpenGroupId(id);
      setPinnedGroupId(id);
    }
  };

  const layout = flatLayoutFewSources
    ? resolveEffectiveLayout(sources, groupConfig, primarySource.id)
    : projectLayout(sources, groupConfig, primarySource.id);

  return (
    // 阻止 mousedown 默认动作折叠划词选区（保持高亮可见），从源头避免
    // selectionchange 误杀弹窗；与 content script 的压制守卫互为双保险。
    <div className="juso-sel-popup" onMouseDown={(e) => e.preventDefault()}>
      <div className="juso-sel-bar">
        <button type="button" className="juso-sel-primary" onClick={() => onSearch(primarySource)} title={sourceLabel(primarySource, t)} aria-label={sourceLabel(primarySource, t)}>
          <svg className="juso-sel-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
          </svg>
        </button>
        <div
          ref={expandAreaRef}
          className="juso-sel-expand-area"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) {
              cancelClose();
              setOpen(false);
              setPinned(false);
            }
          }}
        >
          <button
            type="button"
            className="juso-sel-expand"
            onClick={() => {
              cancelClose();
              if (open) {
                if (pinned) {
                  // pinned open → close and unpin
                  setOpen(false);
                  setPinned(false);
                } else {
                  // transient open → pin
                  setPinned(true);
                }
              } else {
                // collapsed → open and pin
                setOpen(true);
                setPinned(true);
              }
            }}
            aria-label={t('context_menu_root')}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4 L6 8 L10 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div className="juso-sel-flyout" role="menu">
              {layout.items.map((item, index) => {
                if (item.kind === 'source') {
                  return (
                    <button
                      key={item.source.id}
                      type="button"
                      className="juso-sel-source-item"
                      role="menuitem"
                      onClick={() => { onSearch(item.source); cancelClose(); setOpen(false); setPinned(false); }}
                    >
                      {item.source.favicon && (
                        <img className="juso-sel-favicon" src={resolveIconUrl(item.source.favicon)} alt="" />
                      )}
                      <span>{sourceLabel(item.source, t)}</span>
                    </button>
                  );
                }
                return (
                  <SelectionGroupItem
                    key={`group-${index}`}
                    group={item.group}
                    items={item.items}
                    open={openGroupId === item.group.id}
                    pinned={pinnedGroupId === item.group.id}
                    onOpen={() => handleGroupOpen(item.group.id)}
                    onClose={() => handleGroupClose(item.group.id)}
                    onToggle={() => handleGroupToggle(item.group.id)}
                    onSearch={onSearch}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 分组行 + 侧边子浮层：hover 瞬态展开，点击固定（复用快切栏 GroupPill 模式）。
 *  点击识别范围为整个分组框（子浮层内点击除外，source 按钮自行处理）。 */
function SelectionGroupItem({
  group,
  items,
  open,
  pinned,
  onOpen,
  onClose,
  onToggle,
  onSearch,
}: {
  group: { id: string; label: SourceLabel };
  items: SearchSource[];
  open: boolean;
  pinned: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
  onSearch: (source: SearchSource) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;

  const cancelClose = () => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
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
  useEffect(() => () => cancelClose(), []);

    // 外部点击关闭（固定态）：点击在分组框之外时关闭。
    // 子浮层是分组框的 DOM 子孙，rootRef 判定已覆盖子浮层内点击。
    useEffect(() => {
      if (!open) return;
      const onPointerDown = (e: Event) => {
        const path = typeof (e as PointerEvent).composedPath === 'function'
          ? (e as PointerEvent).composedPath()
          : [];
        if (rootRef.current && path.includes(rootRef.current)) return;
        handleClose();
      };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`juso-sel-group${open ? ' open' : ''}`}
      role="group"
      aria-label={resolveLabel(group.label)}
      onMouseEnter={() => { cancelClose(); onOpen(); }}
      onMouseLeave={scheduleClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          handleClose();
        }
      }}
      onBlur={(e) => {
        const related = e.relatedTarget as Node | null;
        if (rootRef.current?.contains(related)) return;
        handleClose();
      }}
      // 点击识别范围为整个分组框（子浮层内点击除外，交给 source 按钮自身）。
      onClick={(e) => {
        if (sourcesRef.current && sourcesRef.current.contains(e.target as Node)) return;
        // 弹窗根的 mousedown preventDefault 抑制了默认聚焦，主动聚焦分组行，
        // 让随后的 Escape 走分组级处理（stopPropagation 只关分组）而非 document 级关闭整个弹窗。
        rowRef.current?.focus();
        onToggle();
      }}
    >
      <div
        ref={rowRef}
        className="juso-sel-group-row"
        role="menuitem"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }
        }}
      >
        <span>{resolveLabel(group.label)}</span>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 2 L8 6 L4 10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div
        ref={sourcesRef}
        className="juso-sel-group-sources"
        role="menu"
        aria-label={resolveLabel(group.label)}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {items.map((source) => (
          <button
            key={source.id}
            type="button"
            className="juso-sel-source-item"
            role="menuitem"
            onClick={() => { onSearch(source); handleClose(); }}
          >
            {source.favicon && (
              <img className="juso-sel-favicon" src={resolveIconUrl(source.favicon)} alt="" />
            )}
            <span>{sourceLabel(source, t)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
