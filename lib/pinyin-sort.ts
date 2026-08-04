// 拼音排序工具：把中文来源名按拼音排序，使中文与拉丁文来源按拼写交错排列
// （如「豆包」与「DuckDuckGo」相邻、「哔哩哔哩」与「Bing」相邻）。
//
// 仅用于设置页快切栏管理列表的「展示排序」——不写入 sourceOrder，不影响快切栏
// 实际顺序（实际顺序由「来源布局」编辑器拖动持久化）。Intl.Collator('zh-CN') 会
// 把中文整组排到拉丁文之前，无法实现按拼写交错，故用 pinyin-pro 显式转拼音。
//
// 仅被设置页引入，WXT/Vite 按入口分包，pinyin-pro 字典只进 options chunk。

import { pinyin } from 'pinyin-pro';

/**
 * 把任意字符串转成「拼音排序键」：CJK 字符转无声调拼音，非 CJK 字符原样保留，
 * 整体小写。多音字取 pinyin-pro 的默认读音。
 */
export function pinyinSortKey(s: string): string {
  return pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .toLowerCase();
}

/** 按拼音排序键比较两个字符串；键相同时回退原串的 localeCompare 以保持稳定。 */
export function compareByPinyin(a: string, b: string): number {
  const ka = pinyinSortKey(a);
  const kb = pinyinSortKey(b);
  return ka === kb ? a.localeCompare(b) : ka.localeCompare(kb);
}
