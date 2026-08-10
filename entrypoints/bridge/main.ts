import { extractLooseBridgeCredentials, parseBridgeFragment } from '@/lib/agent-bridge';
import type { BridgeCredentials } from '@/lib/agent-bridge';
import { sendMessage } from '@/lib/messaging';

const root = document.getElementById('root');
const fragment = window.location.hash;
history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

// External process opens bridge.html as a focused tab; drop focus immediately so the user stays on their current page.
void browser.tabs.getCurrent().then((tab) => {
  if (tab?.id !== undefined) return browser.tabs.update(tab.id, { active: false });
}).catch(() => undefined);

void connect();

async function connect(): Promise<void> {
  const credentials = parseBridgeFragment(fragment);
  if (!credentials.ok) {
    // Fragment 解析失败（如版本不匹配）时，尽力通知 Python 快速失败，
    // 避免 skill 卡到超时。宽松提取 port+token，向 /v1/abort 发信号。
    await notifyAbort(fragment);
    setStatus('连接失败。请从 Juso Agent 重新发起。', 'Connection failed. Start again from Juso Agent.');
    return closeTab();
  }
  try {
    const result = await sendMessage('agentBridgeClaim', credentials.value);
    if (!result.ok) {
      // 扩展拒绝了 claim（如无效 provider/engine id、bridge 未启用、不受信任的发送方）。
      // 通知 Python 快速失败，避免 skill 卡到 40 秒超时。
      await abortBridge(credentials.value, 'claim_rejected');
    }
    setStatus(
      result.ok ? '请求已完成。' : '连接失败。请从 Juso Agent 重新发起。',
      result.ok ? 'Request completed.' : 'Connection failed. Start again from Juso Agent.',
    );
  } catch {
    await abortBridge(credentials.value, 'send_failed');
    setStatus('连接失败。请从 Juso Agent 重新发起。', 'Connection failed. Start again from Juso Agent.');
  }
  closeTab();
}

async function abortBridge(credentials: BridgeCredentials, reason: string): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${credentials.port}/v1/abort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    // Python server 可能已关闭或凭据不可读——忽略，skill 会走自己的超时路径
  }
}

async function notifyAbort(fragment: string): Promise<void> {
  const loose = extractLooseBridgeCredentials(fragment);
  if (!loose) return;
  await abortBridge(loose, 'invalid_fragment');
}

function setStatus(chinese: string, english: string): void {
  if (root) root.innerHTML = `${chinese}<br />${english}`;
}

function closeTab(): void {
  setTimeout(() => window.close(), 300);
}
