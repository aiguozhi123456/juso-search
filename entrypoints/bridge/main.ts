import { parseBridgeFragment } from '@/lib/agent-bridge';
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
    setStatus('连接失败。请从 Juso Agent 重新发起。', 'Connection failed. Start again from Juso Agent.');
    return closeTab();
  }
  try {
    const result = await sendMessage('agentBridgeClaim', credentials.value);
    setStatus(
      result.ok ? '请求已完成。' : '连接失败。请从 Juso Agent 重新发起。',
      result.ok ? 'Request completed.' : 'Connection failed. Start again from Juso Agent.',
    );
  } catch {
    setStatus('连接失败。请从 Juso Agent 重新发起。', 'Connection failed. Start again from Juso Agent.');
  }
  closeTab();
}

function setStatus(chinese: string, english: string): void {
  if (root) root.innerHTML = `${chinese}<br />${english}`;
}

function closeTab(): void {
  setTimeout(() => window.close(), 300);
}
