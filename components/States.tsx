interface ErrorProps {
  message: string;
  onOpenSettings?: () => void;
}

export function Loading() {
  return <div className="state">搜索中…</div>;
}

export function Empty() {
  return <div className="state">输入查询以开始搜索。</div>;
}

export function ErrorState({ message, onOpenSettings }: ErrorProps) {
  return (
    <div className="state error">
      <p>{message}</p>
      {onOpenSettings && <button onClick={onOpenSettings}>打开设置配置 API key</button>}
    </div>
  );
}
