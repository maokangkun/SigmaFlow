import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * 构建期 mod 槽(P4): src/mods/<dir>/index.tsx 每个目录一个懒加载 chunk。
 *
 * - Vite 对 import.meta.glob 的非急式条目各发一个独立 chunk — 改一个 mod
 *   只改它自己的 chunk 哈希, 其余命中浏览器缓存(设计 §6.7 构建期档)。
 * - 运行时按 /api/mods 启用态过滤: 停用的 mod 不加载 chunk; 拉取失败
 *   (如多用户下无 science 会话)按全部内置处理 — 这里的 mod 是随产品
 *   构建的第一方代码, 本身可信。
 * - mod 模块 default 导出组件, 具名导出 meta 元信息。
 */

export interface AdminModMeta {
  title: string;
  description?: string;
}

export interface AdminModEntry {
  id: string;
  meta?: AdminModMeta;
  Load: LazyExoticComponent<ComponentType>;
}

interface ModModule {
  default: ComponentType;
  meta?: AdminModMeta;
}

const modules = import.meta.glob<ModModule>('./*/index.{tsx,ts,jsx,js}');

export const adminMods: AdminModEntry[] = Object.entries(modules).map(
  ([path, loader]) => {
    const dir = path.split('/')[1];
    const Load = lazy(async () => {
      const mod = await loader();
      (Load as unknown as { meta?: AdminModMeta }).meta = mod.meta;
      return { default: mod.default };
    });
    return { id: dir, Load };
  }
);

/** 服务端 mod 清单; 失败时按全部启用(内置第一方 chunk, 见文件头注释)。 */
export interface ServerModInfo {
  id: string;
  state: string;
}

export async function fetchServerMods(): Promise<{
  mods: ServerModInfo[] | null;
  epoch: number | null;
}> {
  try {
    const res = await fetch('/api/mods', { credentials: 'include' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return { mods: data.mods || [], epoch: data.epoch ?? null };
  } catch {
    return { mods: null, epoch: null };
  }
}
