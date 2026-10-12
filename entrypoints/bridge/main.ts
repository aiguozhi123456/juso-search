import { abortLoopback, extractLooseBridgeCredentials, parseBridgeFragment } from '@/lib/agent-bridge';
import type { BridgeCredentials } from '@/lib/agent-bridge';
import { sendMessage } from '@/lib/messaging';
import { applyLocalePref, t, MSG } from '@/lib/i18n';
import { getLocalePref } from '@/lib/storage';

const root = document.getElementById('root');
const fragment = window.location.hash;
history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

// External process opens bridge.html as a focused tab; drop focus immediately so the user stays on their current page.
void browser.tabs.getCurrent().then((tab) => {
  if (tab?.id !== undefined) return browser.tabs.update(tab.id, { active: false });
}).catch(() => undefined);

void run();

async function run(): Promise<void> {
  // 状态文案走 t()：先应用扩展的语言偏好再进入 claim 流程，避免 connect() 在
  // 偏好到位前用浏览器语言渲染状态页。读偏好失败时保持 i18n 的惰性播种语言。
  try {
    applyLocalePref(await getLocalePref());
  } catch {
    // 保持默认 locale。
  }
  await connect();
}

async function connect(): Promise<void> {
  const credentials = parseBridgeFragment(fragment);
  if (!credentials.ok) {
    // Fragment 解析失败（如版本不匹配）时，尽力通知 Python 快速失败，
    // 避免 skill 卡到超时。宽松提取 port+token，向 /v1/abort 发信号。
    await notifyAbort(fragment);
    setStatus(t(MSG.bridge_status_failed));
    return closeTab();
  }
  try {
    const result = await sendMessage('agentBridgeClaim', credentials.value);
    if (!result.ok) {
      // 扩展拒绝了 claim（如无效 provider/engine id、bridge 未启用、不受信任的发送方）。
      // 通知 Python 快速失败，避免 skill 卡到 40 秒超时。
      await abortBridge(credentials.value, 'claim_rejected');
    }
    setStatus(t(result.ok ? MSG.bridge_status_completed : MSG.bridge_status_failed));
  } catch {
    await abortBridge(credentials.value, 'send_failed');
    setStatus(t(MSG.bridge_status_failed));
  }
  closeTab();
}

// /v1/abort 的唯一截止：对端是常驻 loopback 进程，正常应答为毫秒级；对端冻结、
// 被安全软件拦截或 handler 耗尽时不能让 abort 挂死——三条失败路径都在 await 本函数
// 之后才 setStatus/closeTab，无界等待会留下永不关闭的孤儿 bridge 标签页。
// 2s < worker 侧 5s：页面侧三条失败路径都在 await 之后才 setStatus/closeTab，收紧
// deadline 以最小化孤儿 bridge 标签页窗口；worker 侧 5s 覆盖更坏的对端状况。
const ABORT_DEADLINE_MS = 2_000;

async function abortBridge(credentials: BridgeCredentials, reason: string): Promise<void> {
  await abortLoopback(credentials, reason, ABORT_DEADLINE_MS);
}

async function notifyAbort(fragment: string): Promise<void> {
  const loose = extractLooseBridgeCredentials(fragment);
  if (!loose) return;
  await abortBridge(loose, 'invalid_fragment');
}

function setStatus(message: string): void {
  // 文案来自构建期打包的 locale 表，非页面输入；textContent 避免任何 HTML 组合。
  if (root) root.textContent = message;
}

function closeTab(): void {
  setTimeout(() => window.close(), 300);
}
