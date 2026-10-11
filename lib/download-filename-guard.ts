// 下载文件名守卫子系统（自 lib/gateway.ts 整体移出，行为零变化）：
//
// Chrome 对 data: URL 下载不可靠地应用 filename（回退默认名，中文 locale 为「下载」）；
// 且当任意扩展注册 onDeterminingFilename 监听器时 filename 参数被完全忽略
//（Chromium 579563，官方 downloads.idl 明文）。注册本扩展自己的监听器，对由本扩展
// 发起的下载强制 suggest 正确文件名，其他下载放行。Firefox 无此 API 也无此问题。
const pendingFilenames: string[] = [];

/** 在 worker 启动时调用一次：注册 onDeterminingFilename 监听器，强制本扩展发起的
 *  下载使用指定文件名（绕过 data: URL 与冲突扩展导致的 filename 被忽略问题）。 */
export function installDownloadFilenameGuard(): void {
  const events = browser.downloads?.onDeterminingFilename;
  if (!events) return; // Firefox / 不支持：filename 参数本身可靠，无需修复
  events.addListener((item, suggest) => {
    if (item.byExtensionId === browser.runtime.id && pendingFilenames.length > 0) {
      suggest({ filename: pendingFilenames.shift()! });
    } else {
      suggest(); // 放行：非本扩展发起，或队列空（兜底用 Chrome 默认名）
    }
  });
}

/** 触发一次下载并保证 onDeterminingFilename 收到正确文件名（gateway 的导出/打包默认 onDownload）。
 *  download 失败/取消时按值移除入队项，避免 FIFO 队列永久错位（见下方 catch 注释）。 */
export async function triggerDownload(url: string, filename: string): Promise<void> {
  // Firefox 拒绝 data: URL 下载（bug 1318564，仍 open）；event page 有 URL.createObjectURL，
  // 转 blob: URL 绕过。Chrome service worker 无 URL.createObjectURL，保留 data: URL + 下方守卫。
  let downloadUrl = url;
  if (url.startsWith('data:') && typeof URL.createObjectURL === 'function') {
    const blob = await (await fetch(url)).blob();
    downloadUrl = URL.createObjectURL(blob);
  }
  pendingFilenames.push(filename);
  try {
    await browser.downloads.download({ url: downloadUrl, filename, saveAs: true });
  } catch (e) {
    // download 失败/取消时 onDeterminingFilename 永不触发——不移除会让 FIFO 队列永久错位，
    // 之后每次下载都 suggest 到陈旧文件名。按值删最后一个同名入队项后原样上抛。
    const idx = pendingFilenames.lastIndexOf(filename);
    if (idx >= 0) pendingFilenames.splice(idx, 1);
    throw e;
  }
}
