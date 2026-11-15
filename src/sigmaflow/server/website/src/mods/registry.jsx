import { useEffect, useState, lazy, Suspense } from 'react'

/**
 * 构建期 mod 槽(P4): src/mods/<dir>/index.jsx 每个目录一个懒 chunk。
 * 运行时按 /api/mods 启用态过滤 — 停用的 mod 不加载 chunk。
 * 模块 default 导出 React 组件(整段 section), 具名导出 meta。
 */
const modules = import.meta.glob('./*/index.{jsx,tsx,js,ts}')

const entries = Object.entries(modules).map(([path, loader]) => ({
  id: path.split('/')[1],
  Load: lazy(loader),
}))

async function fetchServerMods() {
  try {
    const res = await fetch('/api/mods', { credentials: 'include' })
    if (!res.ok) return null
    const data = await res.json()
    return data.mods || []
  } catch {
    return null // 拉取失败按全部启用(第一方构建期 mod, 可信)
  }
}

export function ModSections() {
  const [serverMods, setServerMods] = useState(null)

  useEffect(() => {
    let alive = true
    fetchServerMods().then((mods) => alive && setServerMods(mods))
    return () => { alive = false }
  }, [])

  // 启用判据: 服务端存在同名 mod 时跟随其启停; 否则默认显示(第一方)
  const visible = entries.filter((m) => {
    if (serverMods === null) return true
    const server = serverMods.find((s) => s.id === m.id)
    return !server || server.state === 'enabled'
  })
  if (!visible.length) return null

  return (
    <section id="mods" className="px-6 py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">扩展能力</h2>
        <p className="text-gray-600 mb-8">
          由 mod 贡献的功能区块 — 停用对应 mod 后此区块自动消失。
        </p>
        <Suspense fallback={<div className="text-gray-400">加载扩展区块…</div>}>
          {visible.map(({ id, Load }) => (
            <Load key={id} />
          ))}
        </Suspense>
      </div>
    </section>
  )
}
