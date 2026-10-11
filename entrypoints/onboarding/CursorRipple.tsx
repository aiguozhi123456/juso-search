// 演示鼠标指针（装饰）：经典箭头造型 + 双环点击涟漪。
// 四处演示（KeyDemo / WelcomeDemo / QuickbarDemo / SourceLayoutDemo）此前各持一份
// 逐字相同的 SVG path 与 ripple span 结构，抽到此处单一化。
// 两个导出：
//   CursorGlyph — 纯箭头 SVG（图形左上角对准坐标热点）；SourceLayoutDemo 的
//                 JS 驱动光标（动态 transform / 按压态 / 条件涟漪）结构不同，
//                 只复用箭头本体；
//   DemoCursor  — 包层 span + 箭头 + 双环涟漪的完整相位动画光标，供纯 CSS 相位
//                 驱动的三处演示使用；包层/涟漪类名按各演示在 styles.css 的
//                 键位传入，--lag 变体由基类名派生。

/** 经典箭头造型鼠标指针（图形左上角对准坐标热点）。 */
export function CursorGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 2.5 L18.8 12.2 L12.6 13.3 L16.2 20.2 L13.4 21.6 L10 14.6 L5.5 18.2 Z"
        fill="#fff"
        stroke="#333"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 相位动画光标：涟漪可见性由各演示 styles.css 的 10s/12s 相位动画控制。 */
export function DemoCursor({ cursorClass, rippleClass }: { cursorClass: string; rippleClass: string }) {
  return (
    <span className={cursorClass}>
      <CursorGlyph />
      <span className={rippleClass} />
      <span className={`${rippleClass} ${rippleClass}--lag`} />
    </span>
  );
}
