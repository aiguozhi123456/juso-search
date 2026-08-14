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
 */
export function SelectionSearchPopup({ sources, groupConfig, primarySource, flatLayoutFewSources, onSearch }: Props) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setOpen(false);
    }, 150);
  }, []);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const layout = flatLayoutFewSources
    ? resolveEffectiveLayout(sources, groupConfig, primarySource.id)
    : projectLayout(sources, groupConfig, primarySource.id);

  return (
    <div className="juso-sel-popup">
      <div className="juso-sel-bar">
        <button type="button" className="juso-sel-primary" onClick={() => onSearch(primarySource)} title={sourceLabel(primarySource, t)} aria-label={sourceLabel(primarySource, t)}>
          <svg className="juso-sel-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="5" />
            <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
          </svg>
        </button>
        <div
          className="juso-sel-expand-area"
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
        >
          <button
            type="button"
            className="juso-sel-expand"
            onClick={() => { cancelClose(); setOpen((v) => !v); }}
            aria-label={t('context_menu_root')}
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
                      onClick={() => onSearch(item.source)}
                    >
                      {item.source.favicon && (
                        <img className="juso-sel-favicon" src={resolveIconUrl(item.source.favicon)} alt="" />
                      )}
                      <span>{sourceLabel(item.source, t)}</span>
                    </button>
                  );
                }
                return (
                  <div key={`group-${index}`} className="juso-sel-group" role="group" aria-label={resolveLabel(item.group.label)}>
                    <div className="juso-sel-group-row">
                      <span>{resolveLabel(item.group.label)}</span>
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M4 2 L8 6 L4 10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="juso-sel-group-sources">
                      {item.items.map((source) => (
                        <button
                          key={source.id}
                          type="button"
                          className="juso-sel-source-item"
                          role="menuitem"
                          onClick={() => onSearch(source)}
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
