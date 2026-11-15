export const meta = {
  title: 'Mod 生态示例',
  description: '本区块由构建期 mod 槽注入(website/src/mods/example-showcase)',
}

export default function ExampleShowcase() {
  return (
    <div className="grid md:grid-cols-3 gap-6">
      {[
        { name: '工具 mod', desc: '给 agent 增加工具能力, 会话中即装即用' },
        { name: '环境 mod', desc: '浏览器宿主仿真环境 + MCP 工具面' },
        { name: 'Loop mod', desc: '替换或增强 agent 主循环行为' },
      ].map((item) => (
        <div key={item.name} className="bg-white rounded-lg p-6 border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-2">{item.name}</h3>
          <p className="text-sm text-gray-600">{item.desc}</p>
        </div>
      ))}
    </div>
  )
}
