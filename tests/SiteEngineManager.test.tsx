import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SiteEngineManager } from '@/components/SiteEngineManager';
import { sendMessage } from '@/lib/messaging';
import type { SiteEngineDefinition } from '@/lib/site-engines';

vi.mock('@/lib/messaging', () => ({ sendMessage: vi.fn() }));

const mockedSend = vi.mocked(sendMessage);

const docs: SiteEngineDefinition = {
  id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/guide', engineId: 'google',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SiteEngineManager — empty state', () => {
  it('shows the empty hint and add button when there are no site engines', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/还没有站点引擎/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增站点引擎' })).toBeInTheDocument();
  });
});

describe('SiteEngineManager — list rendering', () => {
  it('renders each definition with its engine label and effective scope', () => {
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);
    expect(screen.getByText('Docs')).toBeInTheDocument();
    // engine_google → "Google" · site:docs.example.com/guide (scheme-free operand)
    const scope = document.querySelector('.site-engine-scope');
    expect(scope).not.toBeNull();
    expect(scope?.textContent).toContain('Google');
    expect(scope?.textContent).toContain('site:docs.example.com/guide');
  });

  it('shows edit and delete buttons per row', () => {
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });
});

describe('SiteEngineManager — create flow', () => {
  it('opens the form focused on the name field and submits a create message', async () => {
    const onChange = vi.fn();
    mockedSend.mockResolvedValue(docs as never);
    render(<SiteEngineManager siteEngines={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));

    const nameInput = await screen.findByLabelText('名称');
    expect(nameInput).toHaveFocus();

    fireEvent.change(nameInput, { target: { value: 'Docs' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'docs.example.com/guide' } });

    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('createSiteEngine', {
      name: 'Docs', target: 'docs.example.com/guide', engineId: 'google',
    }));
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText('已新增站点引擎。')).toBeInTheDocument();
  });

  it('disables the submit button until name and target are valid', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));

    const submit = screen.getByRole('button', { name: '新增' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'docs.example.com' } });
    expect(submit).not.toBeDisabled();
  });

  it('shows a field error for an invalid target', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'not a url' } });

    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 http(s) 网址或主机名。');
    expect(screen.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  it('shows the effective scope preview with a site: prefix', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'docs.example.com/guide' } });

    expect(screen.getByText(/生效范围/)).toBeInTheDocument();
    expect(screen.getByText('site:docs.example.com/guide')).toBeInTheDocument();
  });

  it('warns when Bing truncates deep paths', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Deep' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'example.com/a/b/c/d' } });
    // Select Bing (second button in the segmented control)
    fireEvent.click(screen.getByRole('radio', { name: 'Bing' }));

    expect(screen.getByText(/Bing 仅支持主机名/)).toBeInTheDocument();
  });

  it('warns when Baidu drops the path', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Host' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'example.com/any/path' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Baidu' }));

    expect(screen.getByText(/Baidu 仅支持主机名/)).toBeInTheDocument();
  });

  it('detects a duplicate scope against existing definitions', () => {
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Duplicate' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'https://docs.example.com/guide' } });

    // Same engine (google) + same scope → duplicate error mentioning the existing name
    expect(screen.getByRole('alert')).toHaveTextContent(/Docs/);
    expect(screen.getByRole('button', { name: '新增' })).toBeDisabled();
  });

  it('shows a failure status when the worker rejects create', async () => {
    mockedSend.mockRejectedValueOnce(new Error('invalid'));
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'docs.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));

    expect(await screen.findByText('保存失败，请重试。')).toBeInTheDocument();
  });
});

describe('SiteEngineManager — edit flow', () => {
  it('loads existing values into the form and submits an update message', async () => {
    const onChange = vi.fn();
    const updated = { ...docs, name: 'Docs v2' };
    mockedSend.mockResolvedValue(updated as never);
    render(<SiteEngineManager siteEngines={[docs]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    const nameInput = await screen.findByLabelText('名称');
    expect(nameInput).toHaveValue('Docs');
    expect(screen.getByLabelText('目标网站或页面 URL')).toHaveValue('https://docs.example.com/guide');

    fireEvent.change(nameInput, { target: { value: 'Docs v2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('updateSiteEngine', {
      id: 'site:docs', name: 'Docs v2', target: 'https://docs.example.com/guide', engineId: 'google',
    }));
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText('已更新站点引擎。')).toBeInTheDocument();
  });

  it('can switch the backing engine in edit mode', async () => {
    mockedSend.mockResolvedValue(docs as never);
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    await screen.findByLabelText('名称');
    fireEvent.click(screen.getByRole('radio', { name: 'Bing' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('updateSiteEngine', expect.objectContaining({ engineId: 'bing' })));
  });
});

describe('SiteEngineManager — delete flow', () => {
  it('uses inline confirmation before deleting', async () => {
    const onChange = vi.fn();
    mockedSend.mockResolvedValue(undefined as never);
    render(<SiteEngineManager siteEngines={[docs]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    // Confirmation text appears, no worker call yet
    expect(screen.getByText(/确定删除「Docs」吗？/)).toBeInTheDocument();
    expect(mockedSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(mockedSend).toHaveBeenCalledWith('deleteSiteEngine', 'site:docs'));
    expect(onChange).toHaveBeenCalled();
    expect(await screen.findByText('已删除站点引擎。')).toBeInTheDocument();
  });

  it('can cancel the inline delete confirmation', () => {
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    // Two "取消" buttons may exist (form + confirm); the confirm row's cancel is the last one
    const cancelButtons = screen.getAllByRole('button', { name: '取消' });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    expect(screen.queryByText(/确定删除「Docs」吗？/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  it('disables all action buttons while a delete is in flight', async () => {
    const save = deferred<void>();
    mockedSend.mockReturnValue(save.promise as never);
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled());
    save.resolve(undefined);
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument());
  });
});

describe('SiteEngineManager — engine segmented control keyboard nav', () => {
  it('cycles the engine selection with arrow keys', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));

    const google = screen.getByRole('radio', { name: 'Google' });
    expect(google).toHaveAttribute('aria-checked', 'true');

    // ArrowRight: google → bing
    fireEvent.keyDown(google, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Bing' })).toHaveAttribute('aria-checked', 'true');

    // ArrowDown: bing → baidu
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Bing' }), { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'Baidu' })).toHaveAttribute('aria-checked', 'true');

    // ArrowRight wraps: baidu → google
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Baidu' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Google' })).toHaveAttribute('aria-checked', 'true');

    // ArrowLeft wraps: google → baidu
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Google' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Baidu' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves DOM focus to the newly selected radio, including wrap', async () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveFocus());

    const google = screen.getByRole('radio', { name: 'Google' });
    await act(async () => { google.focus(); });
    expect(google).toHaveFocus();

    // ArrowRight: google → bing, focus follows (ref callback fires during commit)
    await act(async () => { fireEvent.keyDown(google, { key: 'ArrowRight' }); });
    expect(screen.getByRole('radio', { name: 'Bing' })).toHaveFocus();

    // ArrowRight wraps: bing → baidu, focus follows
    await act(async () => { fireEvent.keyDown(screen.getByRole('radio', { name: 'Bing' }), { key: 'ArrowRight' }); });
    expect(screen.getByRole('radio', { name: 'Baidu' })).toHaveFocus();

    // ArrowRight wraps: baidu → google, focus follows
    await act(async () => { fireEvent.keyDown(screen.getByRole('radio', { name: 'Baidu' }), { key: 'ArrowRight' }); });
    expect(screen.getByRole('radio', { name: 'Google' })).toHaveFocus();

    // ArrowLeft wraps: google → baidu, focus follows
    await act(async () => { fireEvent.keyDown(screen.getByRole('radio', { name: 'Google' }), { key: 'ArrowLeft' }); });
    expect(screen.getByRole('radio', { name: 'Baidu' })).toHaveFocus();
  });
});

describe('SiteEngineManager — validation reveal timing', () => {
  it('does not show validation alerts on opening the blank create form', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    // Form is open with empty fields; no alerts should be announced.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Inputs are not marked invalid.
    expect(screen.getByLabelText('名称')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('目标网站或页面 URL')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('shows errors after submitting the blank form', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    // The submit button is disabled when validation fails; press Enter on the name
    // field to attempt submit, which sets `submitted` and reveals all field errors.
    fireEvent.keyDown(screen.getByLabelText('名称'), { key: 'Enter' });
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('名称')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a target error only after the field is touched', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    // Type a valid name first — no errors yet.
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Type an invalid target — error appears because the field is now touched.
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'not a url' } });
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 http(s) 网址或主机名。');
  });

  it('associates the duplicate error with the target control via aria-describedby', () => {
    render(<SiteEngineManager siteEngines={[docs]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Duplicate' } });
    fireEvent.change(screen.getByLabelText('目标网站或页面 URL'), { target: { value: 'https://docs.example.com/guide' } });

    const targetInput = screen.getByLabelText('目标网站或页面 URL');
    // The duplicate error is associated with the target input.
    expect(targetInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = targetInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // The describedby reference points to the visible duplicate error element.
    const errorEl = document.getElementById(describedBy!.split(' ').pop()!);
    expect(errorEl).toHaveTextContent(/Docs/);
  });
});

describe('SiteEngineManager — field limits and count affordances', () => {
  it('enforces maxlength on name and target inputs', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    expect(screen.getByLabelText('名称')).toHaveAttribute('maxlength', '40');
    expect(screen.getByLabelText('目标网站或页面 URL')).toHaveAttribute('maxlength', '2048');
  });

  it('shows a live character count for name and target', () => {
    render(<SiteEngineManager siteEngines={[]} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '新增站点引擎' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Docs' } });
    expect(screen.getByText('4 / 40')).toBeInTheDocument();
    expect(screen.getByText('0 / 2048')).toBeInTheDocument();
  });

  it('disables the add button and shows a message when at max site engine capacity', () => {
    const engines: SiteEngineDefinition[] = Array.from({ length: 50 }, (_, i) => ({
      id: `site:engine${i}` as const, name: `Engine ${i}`, target: `https://e${i}.example.com`, engineId: 'google' as const,
    }));
    render(<SiteEngineManager siteEngines={engines} onChange={vi.fn()} />);
    const addBtn = screen.getByRole('button', { name: '新增站点引擎' });
    expect(addBtn).toBeDisabled();
    expect(screen.getByText(/最多 50 个站点引擎/)).toBeInTheDocument();
  });
});
