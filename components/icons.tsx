// 内联 SVG 图标集（Lucide/Feather 风格，1.75px 描边，currentColor 主题化）。
//
// 设计准则：
//   · 所有图标都是 24×24 viewBox + 统一描边粗细，在小尺寸下保持清晰；
//   · 不接受 className —— 颜色继承自 currentColor，尺寸由 `size` 控制；
//   · 默认带 aria-hidden=true（装饰图，文字可访问名由宿主组件提供）。
//
// 这套图标用于替换主题/历史/设置/上下箭头等原本用 emoji 表示的入口，避免
// emoji 在不同系统下字形/色彩漂移。

interface IconProps {
  size?: number;
}

/**
 * 聚搜品牌图形：三层水平条带，宽度自上而下递减 —— 漏斗隐喻。
 *   · 多个信息源（顶部宽条）→ 聚合筛选（中部）→ 单一聚焦答案（底部窄条）
 *   · 与 wordmark 锁定时使用 brand 色；独立装饰时由 currentColor 决定
 *   · 实心填充，无描边，确保 16px 以下仍清晰
 */
export function BrandMark({ size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="4" width="18" height="3" rx="1.5" />
      <rect x="6" y="10.5" width="12" height="3" rx="1.5" />
      <rect x="9" y="17" width="6" height="3" rx="1.5" />
    </svg>
  );
}

function Base({ size = 16, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Base>
  );
}

export function StopIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Base>
  );
}

export function SunIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </Base>
  );
}

export function MoonIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Base>
  );
}

export function MonitorIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </Base>
  );
}

export function HistoryIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <line x1="12" y1="7" x2="12" y2="12" />
      <line x1="15" y1="10" x2="12" y2="12" />
    </Base>
  );
}

export function SettingsIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Base>
  );
}

export function CloseIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Base>
  );
}

export function ChevronUpIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <polyline points="18 15 12 9 6 15" />
    </Base>
  );
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  );
}

export function TrashIcon({ size }: IconProps) {
  return (
    <Base size={size}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </Base>
  );
}
