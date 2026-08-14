import { AGENT_BRIDGE_ENABLED_KEY, AI_AUTO_ENTER_KEY, BAR_POSITION_KEY, ENGINE_SEARCH_ENABLED_KEY, FLAT_LAYOUT_FEW_SOURCES_KEY, LOCALE_KEY, SELECTION_SEARCH_ENABLED_KEY, SELECTION_SEARCH_SOURCE_KEY, STYLE_KEY, THEME_KEY } from './keys';
import type { BarPositionPref, LocalePref, StylePref, ThemePref } from './keys';

/** 主题偏好：auto（跟随系统，默认）/ light / dark。
 *  仅读 THEME_KEY，不 get(null)，避免把 BYOK providerKeys 读入页面内存（R7 信任底线）。 */
export async function getThemePref(): Promise<ThemePref> {
  const got = await browser.storage.local.get(THEME_KEY);
  const stored = got[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  await browser.storage.local.set({ [THEME_KEY]: pref });
}

/** UI 语言偏好：auto（跟随浏览器 UI 语言，默认）/ zh_CN / en。
 *  仅读 LOCALE_KEY，不 get(null)（与 themePref 同样的 key 卫生原则）。 */
export async function getLocalePref(): Promise<LocalePref> {
  const got = await browser.storage.local.get(LOCALE_KEY);
  const stored = got[LOCALE_KEY];
  return stored === 'zh_CN' || stored === 'en' ? stored : 'auto';
}

export async function setLocalePref(pref: LocalePref): Promise<void> {
  await browser.storage.local.set({ [LOCALE_KEY]: pref });
}

/** UI 风格偏好：classic（朱砂经典，默认）/ colorful（分布式多色）。
 *  与 themePref 同样的 key 卫生：仅读自身键，不 get(null)。 */
export async function getStylePref(): Promise<StylePref> {
  const got = await browser.storage.local.get(STYLE_KEY);
  const stored = got[STYLE_KEY];
  return stored === 'colorful' ? 'colorful' : 'classic';
}

export async function setStylePref(pref: StylePref): Promise<void> {
  await browser.storage.local.set({ [STYLE_KEY]: pref });
}

/** 快切栏栏位偏好：auto（窄屏自动底栏，默认）/ top（固定覆盖顶栏）/ inline（内联）/ bottom。
 *  与 stylePref 同样的 key 卫生：仅读自身键，不 get(null)。 */
export async function getBarPositionPref(): Promise<BarPositionPref> {
  const got = await browser.storage.local.get(BAR_POSITION_KEY);
  const stored = got[BAR_POSITION_KEY];
  return stored === 'top' || stored === 'inline' || stored === 'bottom' ? stored : 'auto';
}

export async function setBarPositionPref(pref: BarPositionPref): Promise<void> {
  await browser.storage.local.set({ [BAR_POSITION_KEY]: pref });
}

/** AI engine 自动回车开关：默认 true（stored !== false 才 true）。
 *  控制注入型 AI engine（ChatGPT/DeepSeek/豆包/Gemini）的 URL 是否追加 enter=1 参数。 */
export async function getAiAutoEnter(): Promise<boolean> {
  const got = await browser.storage.local.get(AI_AUTO_ENTER_KEY);
  return got[AI_AUTO_ENTER_KEY] !== false;
}

export async function setAiAutoEnter(v: boolean): Promise<void> {
  await browser.storage.local.set({ [AI_AUTO_ENTER_KEY]: v });
}

/** 少量来源自动平铺开关：默认 true（stored !== false 才 true）。
 *  开启后源总数 ≤4（或单组且 ≤6）时自动把所有来源平铺到顶层，省去展开分组的步骤。 */
export async function getFlatLayoutFewSources(): Promise<boolean> {
  const got = await browser.storage.local.get(FLAT_LAYOUT_FEW_SOURCES_KEY);
  return got[FLAT_LAYOUT_FEW_SOURCES_KEY] !== false;
}

export async function setFlatLayoutFewSources(v: boolean): Promise<void> {
  await browser.storage.local.set({ [FLAT_LAYOUT_FEW_SOURCES_KEY]: v });
}

/** 划词搜索开关：默认 true（stored !== false 才 true）。
 *  控制选中文本后是否显示搜索弹窗。 */
export async function getSelectionSearchEnabled(): Promise<boolean> {
  const got = await browser.storage.local.get(SELECTION_SEARCH_ENABLED_KEY);
  return got[SELECTION_SEARCH_ENABLED_KEY] !== false;
}

export async function setSelectionSearchEnabled(v: boolean): Promise<void> {
  await browser.storage.local.set({ [SELECTION_SEARCH_ENABLED_KEY]: v });
}

/** 划词搜索固定源：null = 跟随全局激活源；指定 SourceId 则弹窗主 chip 固定为该源。
 *  非法值（未知 id）回退 null。 */
export async function getSelectionSearchSource(): Promise<string | null> {
  const got = await browser.storage.local.get(SELECTION_SEARCH_SOURCE_KEY);
  const stored = got[SELECTION_SEARCH_SOURCE_KEY];
  return typeof stored === 'string' ? stored : null;
}

export async function setSelectionSearchSource(id: string | null): Promise<void> {
  await browser.storage.local.set({ [SELECTION_SEARCH_SOURCE_KEY]: id });
}

/** Agent Bridge 总开关：默认 false，stored === true 才 true。
 *  控制整个 Agent Bridge（search / list-providers / engine-search 三 action）。 */
export async function getAgentBridgeEnabled(): Promise<boolean> {
  const got = await browser.storage.local.get(AGENT_BRIDGE_ENABLED_KEY);
  return got[AGENT_BRIDGE_ENABLED_KEY] === true;
}

export async function setAgentBridgeEnabled(v: boolean): Promise<void> {
  await browser.storage.local.set({ [AGENT_BRIDGE_ENABLED_KEY]: v });
}

/** engine-search 子开关：默认 false，stored === true 才 true。
 *  仅控制 engine-search action；UI 上仅当总开关 on 时可点。 */
export async function getEngineSearchEnabled(): Promise<boolean> {
  const got = await browser.storage.local.get(ENGINE_SEARCH_ENABLED_KEY);
  return got[ENGINE_SEARCH_ENABLED_KEY] === true;
}

export async function setEngineSearchEnabled(v: boolean): Promise<void> {
  await browser.storage.local.set({ [ENGINE_SEARCH_ENABLED_KEY]: v });
}
