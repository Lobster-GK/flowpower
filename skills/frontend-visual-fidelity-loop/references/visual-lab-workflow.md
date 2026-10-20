# Visual Lab 沙箱工作流

## 边界

本版本只在隔离 Vite 工程中验证参考图对应的基础 UI。不得读取或修改目标项目，不迁移组件，不接入真实接口、Router、Store、权限或应用壳，也不声称真实项目已经完成。

沙箱只允许：

- `visual-fixture.json` 中的静态可见数据；
- 原生 HTML、CSS 和 JavaScript；
- Visual Lab 目录内的本地资源；
- 唯一开发依赖 Vite。

禁止 `fetch`、XHR、WebSocket、EventSource、axios、远程 HTTP 资产、当前时间和随机数。需要显示日期、头像、分页或表格内容时直接写入静态 fixture。

## 创建

```bash
node <SKILL_DIR>/scripts/create-visual-lab.mjs \
  <artifact>/visual-lab \
  --lab-id <task-id>
```

只修改以下三个文件：

- `src/visual-fixture.json`：参考图当前可见状态的全部静态数据；
- `src/generated-ui.js`：基础 UI 结构；
- `src/generated-ui.css`：视觉样式。

保留 `src/main.js`、`src/runtime.css`、`index.html` 和 `visual-lab.json` 的运行边界。调整 viewport、端口或根选择器时只修改 `visual-lab.json`，并同步 source manifest。

## 静态门禁

```bash
node <SKILL_DIR>/scripts/validate-visual-lab.mjs <artifact>/visual-lab
```

任何网络访问、外部包、目录逃逸、非确定性 API 或 target project boundary 违规都必须在安装依赖和启动 Vite 前失败。

## 构建和启动

在 Visual Lab 目录安装已固定版本依赖并验证构建：

模板固定 Vite `8.2.1`，要求 Node.js `^20.19.0 || >=22.12.0`。版本或 Node 要求变化时必须同步更新 `package.json` 并重新执行完整冒烟测试。

```bash
npm install
npm run build
```

构建通过后封存源码、静态 fixture、manifest、package 和 npm 生成的 lockfile：

```bash
node <SKILL_DIR>/scripts/seal-visual-lab.mjs \
  <artifact>/visual-lab \
  --output <artifact>/visual-lab-lock.json

node <SKILL_DIR>/scripts/validate-artifacts.mjs \
  <artifact>/visual-lab-lock.json

npm run dev -- --port 4173 --strictPort
```

把封存脚本 stdout 中的 `lockFileSha256` 同时写入 `00-source-manifest.visualLab.expectedLockSha256` 和 `capture-observation.visualLabReadiness.lockSha256`。浏览器捕获还必须记录相同 `labId`、ready marker、capture mode 和空的 `externalNetworkRequests`。alignment 生成器会重新计算当前源码与 lock；任一文件在封存后变化都会阻塞截图比较。

每次修改 fixture、JS、CSS、manifest、package 或 lockfile 后都要重新校验、构建和封存。

不得在 Skill 资产目录中安装依赖或启动服务。服务只监听 `127.0.0.1`。端口被占用时选择新端口并同时更新 `visual-lab.json` 与 source manifest，禁止让 Vite 静默换端口。

在 Windows 后台启动时使用隐藏窗口，并保存进程信息以便任务结束后停止服务。不要终止没有由当前任务启动的进程。

## 浏览器捕获

打开 manifest 中的 loopback URL，等待：

- `document.documentElement.dataset.visualLabReady === "true"`；
- `document.fonts.ready`；
- 本地图片加载完成；
- 根节点 bbox 稳定。

截图前设置：

```js
document.documentElement.dataset.visualLabCapture = 'true';
```

用 `[data-visual-id='page-root']` 或 manifest 声明的根选择器截图，并采集全部 visual measurement。此沙箱没有 Header、Sidebar 或真实项目容器；不得把目标项目页面拿来替换沙箱截图。

## 通过与停止

只有以下产物同时通过才生成 `visual-lab-acceptance.json`：

- `visual-lab-lock.json`；
- `alignment-report.json`；
- `pixel-report.json`；
- `visual-evaluation.json`；
- 人工复核没有发现测量与图片冲突。

生成 acceptance 后立即停止。不得继续读取目标项目、迁移 UI、生成真实接口代码或执行集成验证。最终表述必须是“Visual Lab 沙箱验证通过”，不能表述为“页面开发完成”或“真实项目验收通过”。
