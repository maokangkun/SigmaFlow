import { useEffect, useState } from 'react';

export const meta = {
  title: '示例面板: 服务健康',
  description: 'admin mod 槽的活模板 — 复制本目录即可给 admin 加一个面板(chunk 独立)。',
};

interface HealthInfo {
  status?: string;
  mods?: { id: string; state: string }[];
  epoch?: number;
  error?: string;
}

export default function ExampleHealth() {
  const [info, setInfo] = useState<HealthInfo>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [h, m] = await Promise.all([
          fetch('/api/health', { credentials: 'include' }).then((r) => r.json()),
          fetch('/api/mods', { credentials: 'include' })
            .then((r) => r.json())
            .catch(() => ({})),
        ]);
        if (alive) setInfo({ status: h?.status || 'ok', mods: m?.mods, epoch: m?.epoch });
      } catch (e) {
        if (alive) setInfo({ error: String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enabled = (info.mods || []).filter((m) => m.state === 'enabled');

  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2 items-center">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        <span>服务健康: {info.error ? `查询失败 (${info.error})` : info.status || 'ok'}</span>
      </div>
      <p className="text-muted-foreground">
        已启用 mod: {enabled.length || '?'} 个
        {info.epoch !== undefined ? ` · epoch ${info.epoch}` : ''}
      </p>
      <ul className="list-disc pl-5 text-muted-foreground">
        {enabled.slice(0, 6).map((m) => (
          <li key={m.id}>
            {m.id} — {m.state}
          </li>
        ))}
      </ul>
    </div>
  );
}
