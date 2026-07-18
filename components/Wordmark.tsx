import { useLocale } from '@/lib/useLocale';
import { getCurrentLocale, t, MSG } from '@/lib/i18n';
import { BrandMark } from './icons';

interface Props {
  /** 在 wordmark 之后追加的页面上-context（如设置页的"· 设置"）。 */
  suffix?: string;
}

/**
 * 聚搜 wordmark 锁up：[brand mark] + 「聚搜」(分色) / 「Juso」(整色) + 可选 suffix。
 *
 * 设计：
 *   · mark 与文字同高（22px），保持视觉重心；
 *   · 中文按字符分色 ——「聚」用 brand 朱砂，「搜」用 fg 中性，强对比让 logo 跳出
 *     文本流；英文按词分色，第一词 brand、剩余 fg；
 *   · 字重 700 + display 字体栈，让 wordmark 即使在 system 字体下也接近 logotype
 *     质感（CJK 字体在 macOS / Windows 都提供 Bold/Heavy 字重）。
 *
 * 不依赖外部 webfont（MV3 CSP 性能约束）。
 */
export function Wordmark({ suffix }: Props) {
  // 订阅 locale 变化，语言切换时 wordmark 重渲染
  useLocale();
  const text = t(MSG.search_page_title);
  const isZh = getCurrentLocale() === 'zh_CN';

  let head: string;
  let tail: string;
  if (isZh) {
    // 「聚」brand 色 / 「搜」fg 色
    head = text.charAt(0);
    tail = text.slice(1);
  } else {
    // 英文按词分色：第一词 brand，剩余 fg
    const idx = text.indexOf(' ');
    head = idx > 0 ? text.slice(0, idx) : text;
    tail = idx > 0 ? text.slice(idx) : '';
  }

  return (
    <span className="wordmark">
      <span className="wordmark-mark" aria-hidden="true">
        <BrandMark size={22} />
      </span>
      <span className="wordmark-text">
        <span className="wordmark-head">{head}</span>
        {tail && <span className="wordmark-tail">{tail}</span>}
      </span>
      {suffix && (
        <>
          <span className="wordmark-sep" aria-hidden="true">·</span>
          <span className="wordmark-suffix">{suffix}</span>
        </>
      )}
    </span>
  );
}
