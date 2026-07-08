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

/**
 * 统一快切栏：把已配置的 AI provider 与全部常规搜索引擎渲染成同一行 pill。
 * 纯展示组件——跳转（SERP）或序列化写+重搜（Juso 页）由宿主通过 onSelect 决定。
 */
export function SourceSwitcher({ sources, activeId, onSelect, disabled }: Props) {
  return (
    <div className="source-switcher" role="group" aria-label={t(MSG.source_switcher_aria)}>
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
