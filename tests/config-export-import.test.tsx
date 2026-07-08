import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfigExportImport } from '@/components/ConfigExportImport';
import { sendMessage } from '@/lib/messaging';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));

const mockedSend = vi.mocked(sendMessage);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConfigExportImport', () => {
  it('clicking export sends exportConfig and shows success banner', async () => {
    mockedSend.mockResolvedValue({ ok: true, filename: 'juso-config-20260708-1530.json' } as never);
    render(<ConfigExportImport />);
    fireEvent.click(screen.getByRole('button', { name: '导出配置' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('exportConfig', undefined));
    expect(await screen.findByText('导出完成。')).toBeInTheDocument();
  });

  it('export failure shows the error banner', async () => {
    mockedSend.mockResolvedValue({ ok: false, error: { kind: 'download_failed', message: 'blocked' } } as never);
    render(<ConfigExportImport />);
    fireEvent.click(screen.getByRole('button', { name: '导出配置' }));
    expect(await screen.findByText('导出失败，请稍后重试')).toBeInTheDocument();
  });

  it('imports keys without confirmation when no pref changes', async () => {
    // previewImport returns no prefDiffs
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'previewImport') {
        return Promise.resolve({ ok: true, preview: { written: ['exa'], skipped: ['tavily'], prefDiffs: [] } });
      }
      if (type === 'importConfig') {
        return Promise.resolve({ ok: true, report: { written: ['exa'], skipped: ['tavily'], activeProviderOverridden: false, themePrefOverridden: false, localePrefOverridden: false } });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<ConfigExportImport />);
    const input = screen.getByDisplayValue('') as HTMLInputElement;
    // 模拟文件选择：直接触发 onChange（input 是 hidden，用 fireEvent.change）
    const file = new File(['{"schemaVersion":1}'], 'config.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('previewImport', expect.anything()));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('importConfig', expect.objectContaining({ applyPrefs: false })));
    // 成功横幅（含 key 报告）
    expect(await screen.findByText(/导入完成。/)).toBeInTheDocument();
  });

  it('shows confirmation dialog when prefs differ, then imports with applyPrefs on confirm', async () => {
    mockedSend.mockImplementation(((type: string) => {
      if (type === 'previewImport') {
        return Promise.resolve({
          ok: true,
          preview: {
            written: ['exa'], skipped: [],
            prefDiffs: [
              { key: 'themePref', from: 'light', to: 'dark' },
              { key: 'activeProvider', from: 'tavily', to: 'exa' },
            ],
          },
        });
      }
      if (type === 'importConfig') {
        return Promise.resolve({ ok: true, report: { written: ['exa'], skipped: [], activeProviderOverridden: true, themePrefOverridden: true, localePrefOverridden: false } });
      }
      return Promise.resolve({ ok: true });
    }) as never);
    render(<ConfigExportImport />);
    const input = screen.getByDisplayValue('') as HTMLInputElement;
    const file = new File(['{"schemaVersion":1}'], 'config.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    // 确认对话框出现（含 diff 行）
    expect(await screen.findByText('以下偏好将被覆盖：')).toBeInTheDocument();
    expect(screen.getByText(/light/)).toBeInTheDocument();
    expect(screen.getByText(/dark/)).toBeInTheDocument();
    // 点击"导入（含偏好）"
    fireEvent.click(screen.getByRole('button', { name: '导入（含偏好）' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('importConfig', expect.objectContaining({ applyPrefs: true })));
    expect(await screen.findByText(/已覆盖/)).toBeInTheDocument();
  });

  it('oversized file is rejected before any messaging', async () => {
    render(<ConfigExportImport />);
    const input = screen.getByDisplayValue('') as HTMLInputElement;
    // 构造一个 > 256KB 的文件（size 由 File 构造器的内容长度决定，这里用大字符串）
    const big = new File([new Array(300 * 1024).fill('x').join('')], 'huge.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/导入失败：文件格式无效/)).toBeInTheDocument();
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
