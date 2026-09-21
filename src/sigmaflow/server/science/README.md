# SigmaFlow Science

浅灰、扁平、简约新拟态的生物科研工作空间。

这是一套可运行、可编辑的多页面前端工程，不是截图切片。界面采用 HTML、CSS 和 JavaScript 编写，包含原生 SVG 图标与可交互图表。没有外部字体、图片 CDN、运行依赖或构建依赖。

**范围说明：** 当前 Agent 对话、分析流程及单细胞结果为明确标注的演示。项目未接入真实大模型、Scanpy 或计算集群。文件本地预览、DNA 基础统计、项目管理、文献笔记、图表交互与文件导出是真实可用的前端功能。

## 1. 立即打开

### 方式 A：不安装任何环境

打开 `dist/index.html`。

这是完全自包含的单文件版本：CSS、JavaScript 和 SVG 都在一个 HTML 中。首次打开不需要联网，只有主动点击公共资源或 PubMed 检索才会打开外部站点。

不同浏览器对 `file://` 页面持久化存储的处理不同。在隐私模式或禁止存储的环境中，会降级为“仅当前会话”。需要稳定保存项目时，请使用下面的本地 HTTP 服务。

### 方式 B：本地开发

需要 Node.js 20 或以上。本项目没有 npm 依赖，**不需要执行 npm install**。

```bash
npm run dev
```

浏览器打开：

```text
http://127.0.0.1:5173
```

Windows PowerShell、macOS 和 Linux 都使用以上命令。按 `Ctrl+C` 停止服务。

修改端口：

```bash
# macOS / Linux
PORT=3000 npm run dev

# PowerShell
$env:PORT=3000; npm run dev
```

默认只监听 `127.0.0.1`，不会向局域网公开。`HOST=0.0.0.0` 可用于受控测试，但该演示服务没有生产身份认证，不应直接暴露到公网。

### 方式 C：只运行静态前端

不使用接口联调时，也可以使用任意静态 HTTP 服务：

```bash
python -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000`。这种方式不提供 `/api` 模拟接口，使用默认“浏览器本地演示”模式即可。

## 2. 页面与功能

| 页面 | 路由 | 可操作内容 |
| --- | --- | --- |
| 工作台首页 | `#/home` | 研究问题输入、文件/数据上下文、流程入口、新对话 |
| Agent 对话 | `#/chat` | 人工确认计划、演示进度、暂停/继续/取消、折叠日志、跟进问题 |
| 数据集 | `#/data` | 导入、拖放、文件元信息、文本/CSV/TSV 预览、筛选、批量移除与元数据导出 |
| 工作流 | `#/workflows` | 四种演示流程、输入数据选择、物种上下文、参数编辑、生成待确认计划 |
| 分析结果 | `#/results` | 合成细胞图谱、分组高亮、点信息、缩放、表达热图/表格、记录导出 |
| 文献 | `#/literature` | 预置文献、本地筛选、收藏、笔记、引用复制、清单导出、PubMed 跳转 |
| 生物工具 | `#/tools` | 真实本地 DNA / FASTA 基础统计、表格预览、官方数据库入口 |
| 项目 | `#/projects` | 创建、编辑、标签、归档、恢复、按项目组织任务 |
| 任务队列 | `#/tasks` | 查看历史任务、执行状态、打开已有对话 |
| 设置 / 帮助 | `#/settings` / `#/help` | 本地保存、清空、导出、增强对比、减少动效、接口配置与说明 |

### 推荐体验路径

首页 → **单细胞分析** → 检查分析计划 → **确认并执行** → 展开步骤日志 → 暂停 / 继续 → **查看结果** → 点击图例或图中数据点 → 表达特征 → 导出演示记录。

任务计时器与页面分离，切换页面不终止本地演示。刷新页面会暂停本地任务。接口模式中的任务由服务端管理；刷新后需要重新连接来同步实际状态，不会宣称服务端已暂停。

### 本地文件处理边界

- 文件经用户选择或拖放后，才会获得浏览器 `File` 对象。
- 文件不自动上传，不执行其中任何内容，也不解压。
- 文本预览最多读取 **64 KB**；CSV / TSV 最多展示 **100 行正文**。
- H5AD、H5、MTX、GZ 等只登记元信息，不实现矩阵解析或解压。
- 原始文件仅在当前页面内存中保留。刷新后只保留元信息，重新导入同一文件可恢复预览。
- 单文件最多接受 2 GB 的元信息登记；最多保留 500 份记录。实际大规模科学计算需专用后端。
- 支持的格式：CSV、TSV、TXT、JSON、FASTA、FA、FASTQ、FQ、H5AD、H5、MTX、GZ。

### DNA 基础统计

这是实际运行的浏览器计算，不是演示结果。

支持纯 DNA 文本和多条 FASTA，接受标准 DNA IUPAC 字符。计算每条序列的长度、A/C/G/T/N 数量、模糊碱基数量与 GC 比例。GC 的分母只包含 A/C/G/T，不含模糊碱基；分母为零时返回空值。最多处理 1 MB 文本，不做功能、致病性或结构预测。

## 3. 项目结构

```text
science/
├── index.html                 # 开发版入口，可由普通静态服务访问
├── css/
│   ├── tokens.css             # 颜色、阴影、尺寸、主题变量
│   └── app.css                # 全部页面、组件与响应式布局
├── js/
│   ├── icons.js               # 内联 SVG 图标，无图标字体
│   ├── data.js                # 合成示例、预置文献、流程与工具元信息
│   ├── core.js                # 状态、保存、转义、CSV / DNA 工具函数
│   ├── charts.js              # 固定种子的 SVG 图表
│   ├── agent.js               # 演示状态机 + HTTP/SSE 客户端适配层
│   ├── views.js               # 所有页面与可复用组件
│   └── app.js                 # 路由、事件、对话框、导入导出逻辑
├── server.mjs                 # 无依赖静态服务器 + 模拟 Agent API
├── scripts/
│   ├── build.mjs              # 将源码打包为独立 HTML
│   └── check.mjs              # JS 语法与纯函数/保存机制测试
├── sample-data/               # 可实际导入的人工示例文件
├── tests/
│   ├── test_ui.py             # 浏览器交互自动化测试
│   ├── test_api.py            # HTTP/SSE 协议测试
│   ├── inspect_ui.py          # 实际网页截图脚本
│   ├── browser-results.json  # 浏览器测试结果
│   └── api-results.json      # 接口测试结果
├── docs/                      # 由代码渲染的页面截图
├── dist/
│   └── index.html             # 已构建的独立离线版
├── API.md                     # 后端接入契约
├── README.md
└── package.json
```

## 4. 修改界面

### 全局视觉

只修改 `css/tokens.css` 即可统一更换颜色、阴影、圆角和侧栏宽度。

```css
:root {
  --bg: #f3f4f6;
  --sidebar: #eef0f3;
  --surface: #f7f8fa;
  --ink: #292d3c;
  --accent: #7775b6;
  --shadow: 5px 5px 15px #dfe2e980, -5px -5px 15px #ffffffc9;
  --radius: 16px;
  --sidebar-width: 226px;
}
```

页面没有渐变背景。仅在卡片和控件使用浅双向阴影；大面积背景保持纯浅灰。字体使用操作系统字体栈，不下载也不分发字体文件。

### 增加一个页面

1. 在 `js/views.js` 中添加一个 `CS.views.yourPage` 函数。
2. 在侧栏 `nav` 数组添加路由项。
3. 根据需要在 `js/app.js` 中添加事件处理。
4. 所有用户输入的 HTML 插值都要使用 `CS.escape()`。

路由采用 Hash 模式，不需要服务器 SPA 重写规则，可部署到子目录。

### 更换示例内容

编辑 `js/data.js`。图表由 `js/charts.js` 生成，不是图片，不依赖 ECharts 或其它图表库。

请保持“合成数据 / 演示结果”的标记，直到完整接入并验证真实计算服务。不要只删除标记来让预设结果看起来像真实计算。

## 5. 构建与检查

```bash
npm run check   # 语法检查 + 转义、CSV、DNA、保存与清空等测试
npm run build   # 重新生成 dist/index.html
```

浏览器测试为可选开发工具，需要单独安装 Playwright，不是应用运行依赖：

```bash
python -m pip install playwright
python -m playwright install chromium
```

脚本默认使用 `/usr/bin/chromium`。其他系统用 `CHROMIUM_PATH` 指向 Chrome / Chromium 的可执行文件。例如 macOS：

```bash
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" python tests/test_ui.py
```

Windows PowerShell：

```powershell
$env:CHROMIUM_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
python tests/test_ui.py
```

如使用 Playwright 下载的浏览器，可以在脚本中移除 `executable_path=...` 参数。

本次交付执行了语法/纯函数检查、**15 组浏览器交互检查**与 **9 组 HTTP/SSE 协议检查**。浏览器检查使用 Chromium 将独立 HTML 注入页面，不依赖外部网站导航；持久化逻辑另有 Node 模拟存储测试。测试覆盖 1440、768 和 390 像素宽度，无横向溢出；没有验证所有浏览器、所有辅助技术或所有操作系统。

```bash
# 接口测试先启动 npm run dev，再在另一个终端运行
python tests/test_api.py

# 重新生成实际页面截图
python tests/inspect_ui.py
```

## 6. Agent 接入与生产边界

完整协议见 `API.md`。入口在 `js/agent.js`。

默认“浏览器本地演示”不发出 Agent 网络请求。在设置页切换至接口联调、使用 `/api` 并启动 `npm run dev`，可以体验真实 HTTP 请求与 SSE 推送，但服务器仍是模拟服务。

生产系统还需实现：用户认证、项目授权、数据存储、真实文件上传与解析、模型服务端调用、计算任务与资源限制、服务端人工审批、工具权限和审计、真实结果接口，以及相应的错误与重连策略。

**不要将模型 API 密钥放在前端代码、Local Storage 或构建环境公开变量中。** 使用服务端密钥与适当的会话认证。当前接口模式仅发送问题、配置与文件 ID，不包含原始文件上传实现。

真实结果的数据结构应由后端定义，再替换 `charts.js` 的合成数据源与 `views.js` 的演示结果渲染；仅填写一个接口 URL，并不会自动获得真实分析能力。

## 7. 数据与安全说明

- 应用不会把输入解释为 HTML；动态内容使用转义输出。
- CSV 导出对潜在公式开头进行处理，以降低电子表格公式注入风险。
- 文件不会执行、不解析 HTML、不使用 `eval` 或任意命令执行。
- 链接由用户主动打开，使用 `noopener noreferrer`。
- 保存内容包括项目、文件名、问题、任务记录和阅读笔记。它们可能含敏感信息，分享导出文件前需自行检查。
- “在本机保存”关闭后，原有工作空间保存被删除，当前会话仍可继续；仅保留关闭保存的偏好。
- 这不是完整安全审计或生产合规认证。真实科研环境仍需按机构要求做好数据脱敏、授权与审计。

## 8. 预置资料与开发参考

预置文献只是静态阅读卡片，不是实时检索结果：

- Wolf, F. A., Angerer, P. & Theis, F. J. (2018). *SCANPY: large-scale single-cell gene expression data analysis*. Genome Biology. DOI: `10.1186/s13059-017-1382-0`。
- Luecken, M. D. & Theis, F. J. (2019). *Current best practices in single-cell RNA-seq analysis: a tutorial*. Molecular Systems Biology. DOI: `10.15252/msb.20188746`。

开发参考：

- MDN File API: https://developer.mozilla.org/en-US/docs/Web/API/File_API/Using_files_from_web_applications
- MDN localStorage: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage

图标与页面装饰均在源码中以 SVG 绘制；应用不包含第三方字体文件。项目是按需求制作的独立界面工程。
