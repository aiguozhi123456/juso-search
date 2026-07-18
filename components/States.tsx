import { t, MSG } from '@/lib/i18n';

interface ErrorProps {
  message: string;
  onOpenSettings?: () => void;
}

/**
 * 加载骨架：模拟最终呈现的「AI 回答卡片 + 3 条搜索结果」结构。
 * - 形状对齐 AnswerCard 与 ResultCard，避免真实结果到位时跳动；
 * - 行条带由 CSS 线性渐变 + 关键帧实现 shimmer（见 search/styles.css）；
 * - 文案消息由 role="status" + 屏幕阅读器专用的 .skel-visually-hidden 暴露，
 *   既有可见反馈也给辅助技术。
 */
export function Loading() {
  return (
    <div className="loading-skeleton" role="status" aria-live="polite">
      <span className="skel-visually-hidden">{t(MSG.state_loading)}</span>

      <div className="skel-answer" aria-hidden="true">
        <div className="skel-line skel-head" />
        <div className="skel-line w-90" />
        <div className="skel-line w-75" />
        <div className="skel-line w-60" />
      </div>

      <div className="skel-result" aria-hidden="true">
        <div className="skel-line skel-title" />
        <div className="skel-line skel-url" />
        <div className="skel-line w-90" />
        <div className="skel-line w-75" />
      </div>

      <div className="skel-result" aria-hidden="true">
        <div className="skel-line skel-title" />
        <div className="skel-line skel-url" />
        <div className="skel-line w-90" />
        <div className="skel-line w-40" />
      </div>

      <div className="skel-result" aria-hidden="true">
        <div className="skel-line skel-title" />
        <div className="skel-line skel-url" />
        <div className="skel-line w-75" />
        <div className="skel-line w-30" />
      </div>
    </div>
  );
}

export function Empty() {
  return <div className="state">{t(MSG.state_empty)}</div>;
}

export function ErrorState({ message, onOpenSettings }: ErrorProps) {
  return (
    <div className="state error" role="alert">
      <p>{message}</p>
      {onOpenSettings && <button onClick={onOpenSettings}>{t(MSG.open_settings_cta)}</button>}
    </div>
  );
}
