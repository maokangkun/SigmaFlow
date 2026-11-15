import { useEffect, useState } from 'react';
import { Puzzle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminMods, fetchServerMods } from '../mods/registry';
import type { AdminModEntry, ServerModInfo } from '../mods/registry';

/**
 * Mod 页(P4 构建期槽): 列出构建期装进的面板, 每个面板一个懒 chunk。
 * 启用判据: 服务端存在同名 mod 时跟随其启停; 否则默认显示(第一方)。
 */
export default function ModsPage() {
  const [serverMods, setServerMods] = useState<ServerModInfo[] | null>(null);
  const [epoch, setEpoch] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const { mods, epoch: ep } = await fetchServerMods();
    setServerMods(mods);
    setEpoch(ep);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const visible = adminMods.filter((m) => {
    if (serverMods === null) return true; // 拉取失败: 第一方默认显示
    const server = serverMods.find((s) => s.id === m.id);
    return !server || server.state === 'enabled';
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Mods</h1>
            <p className="text-sm text-muted-foreground">
              构建期 mod 槽: 每个面板是独立懒加载 chunk, 按服务端启用态装载
              {epoch !== null ? ` · epoch ${epoch}` : ''}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          刷新
        </Button>
      </div>

      {loading && <p className="text-muted-foreground">加载启用状态…</p>}

      {!loading && visible.length === 0 && (
        <p className="text-muted-foreground">
          当前没有启用中的 admin mod。在 src/mods/&lt;dir&gt;/index.tsx 添加后重新构建,
          或在科学工作台设置页启用对应 mod。
        </p>
      )}

      <div className="space-y-6">
        {visible.map((m: AdminModEntry) => (
          <ModPanel key={m.id} entry={m} />
        ))}
      </div>
    </div>
  );
}

function ModPanel({ entry }: { entry: AdminModEntry }) {
  const meta = (entry.Load as unknown as { meta?: { title?: string; description?: string } }).meta;
  const title = meta?.title || entry.id;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-medium text-foreground mb-3">{title}</h2>
      {meta?.description && (
        <p className="text-sm text-muted-foreground mb-3">{meta.description}</p>
      )}
      <entry.Load />
    </section>
  );
}
