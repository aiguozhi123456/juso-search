/** 引导页收尾导航：当前页替换进搜索页。
 *  独立成模块是为了测试替身——jsdom 的 location.replace 是不可重定义的 own property。 */
export function navigateToSearchPage(): void {
  window.location.replace(browser.runtime.getURL('/search.html'));
}
