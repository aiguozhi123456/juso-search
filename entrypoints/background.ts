export default defineBackground(() => {
  // 独立扩展页：点工具栏图标在标签页打开搜索页（无 default_popup，onClicked 才会触发）
  browser.action.onClicked.addListener(() => {
    browser.tabs.create({ url: browser.runtime.getURL('/search.html') });
  });
});
