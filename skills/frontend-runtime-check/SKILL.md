---
name: frontend-runtime-check
description: >
  用于在浏览器中检查前端页面，包括路由加载、console 错误、页面可用性和根 DOM 截图。适合在开发服务已可访问，用户要求
  “运行时检查”“页面运行报错”“check console errors”“open page route”或“browser validation”时使用。不适合代码生成、
  API 设计、仅 lint 错误、开发服务启动失败、后端问题、非浏览器测试，或无关前端调试。
---

# 路由运行时检查

<EXTREMELY-IMPORTANT>
你**必须先调用 `afp_get_project_config` 解析项目配置**, 读取 userName、password 作为登录时的员工号和密码。调用 `afp_get_project_config` 无需传参。
</EXTREMELY-IMPORTANT>

## 目标

在真实浏览器中验证目标前端路由，修复运行时报错，并保存页面根节点 DOM 的元素截图。

截图保存目录：`.codegen/artifacts/<语义化任务名或时间戳>/screenshot.png`

## 浏览器自动化策略

优先使用 `playwright` MCP。浏览器操作应由 `playwright` MCP 完成。

1. 查找并启用 `playwright` MCP。
   - 如果当前上下文已有 `playwright` MCP 工具，直接使用，没有则使用`chrome-dev-tool` MCP。
   - 先读取 `playwright` MCP 暴露的工具列表、帮助信息、schema、说明或元数据，确认可用方法和参数，再调用对应能力。
   - 让模型按 MCP 实际提供的方法完成导航、点击、输入、等待、控制台错误读取、页面错误读取、DOM 查询和元素截图。

2. `playwright` MCP 不可用时再使用 `chrome-dev-tool` MCP。
   - 仅当 `playwright` MCP 未安装、无法暴露、无法调用或缺少完成任务所需能力时，才 fallback 到 `chrome-dev-tool` MCP。
   - fallback 前记录 `playwright` MCP 不可用的原因。
   - 降级是必选方案：只要 `chrome-dev-tool` MCP 可用，就继续用它完成导航、错误读取、DOM 检查和截图，不要因为 `playwright` MCP 不可用就直接停止。
   - 如果 `playwright` MCP 和 `chrome-dev-tool` MCP 都不可用，报告该阻塞原因。

不要自动安装 `playwright`、不要下载浏览器二进制、不要临时生成 `playwright` 脚本，除非用户明确要求。

## 登录

如果目标路由跳转登录页（页面地址包含 `/SOAM/oauth/login`），则说明需要登录；

使用 `playwright` MCP 时，填入员工号、密码，点击提交，并等待路由稳定，再访问目标路由。使用 `chrome-dev-tool` MCP fallback 时，也按同样的流程完成登录。

**请注意，下面这句话非常重要，你必须严格遵守：密码输入必须模拟键盘输入，一个一个键入**

## 工作流程

1. 确定项目根目录和服务端口。
   - 如果用户提供了端口号，以用户提供的为准。
   - 否则按 JSON 解析 `package.json`，读取 `scripts.start` 或 `scripts.dev` 命令脚本。
   - 如果命令脚本中包含 `--port <数字>` 或 `--port=<数字>`，端口号就是该数字。
   - 如果没有 `--port` 参数，默认端口为 `8000`。

2. 检测项目服务是否已经启动。
   - 探测 `http://localhost:<端口>`。
   - 如果服务已响应，不要重启，直接复用当前服务。
   - 如果服务未启动，使用项目现有脚本启动服务，优先使用 `start`，必要时再使用 `dev`，并保持该进程运行。
   **特别说明:启动操作的shell 命令不会自动结束，你只需要判断输出中是否包含明确的错误信息或者明确的成功信息即可，成功的信息示例: successfully。**

3. 确认目标页面的完整路由。
   - 如果用户请求或上下文中已经有路由，直接使用，不要再次确认。
   - 如果只提供了页面名或组件名，自动扫描项目路由系统来确认完整路由。检查常见位置和写法，例如 `src/router`、`app`、`pages`、路由配置文件、router 声明和链接引用。
   - 只有在扫描后仍无法唯一确定目标路由时，才向用户提出一个简短问题。

4. 打开目标路由。
   - 使用已选择的 MCP 浏览器工具导航到 `http://localhost:<端口><路由>`。
   - 如果导航之后发现不是目标路由，判断一下当前的路由是hash路由还是browser路由（无法确认时默认按hash路由处理），hash路由通过在浏览器控制台执行 `window.location.hash = '#/<目标路由>' ` 跳转至目标路由，browser路由通过在浏览器控制台执行 `window.location.pathname = '/<目标路由>' ` 跳转至目标路由
   - 如果使用 `playwright` MCP，在导航前或导航后按 MCP 能力开启/读取 console、page error、request failed 等信息。
   - 等待应用完成初始渲染，并等待开发服务器错误遮罩或热更新状态稳定。
   - 如果发现需要登录，按“登录占位”流程处理；占位未填写时停止并报告。

5. 检测运行时问题。
   - 收集浏览器控制台错误、未捕获异常、page error、模块加载失败、开发服务器错误遮罩、水合或运行时崩溃，以及会导致页面不可用的失败网络请求。
   - 使用 `playwright` MCP 时，优先使用 MCP 暴露的 console、page error、network/request failed、evaluate、snapshot 或等价能力读取错误；使用 `chrome-dev-tool` MCP 时读取对应的控制台、页面错误和网络失败信息。
   - 忽略无害 warning，除非它对应可见 UI 损坏或用户可感知故障。
   - 将重复错误按错误指纹归类。错误指纹由错误信息、栈顶帧和失败源码位置组成。

6. 修复错误，但不要重启服务。
   - 根据错误栈、sourcemap、代码搜索和相关组件树定位出错源码。
   - 只修改最小必要代码，让热更新自动刷新页面。
   - 每次修改后，用已选择的 MCP 浏览器工具刷新或重新导航目标路由，再重新收集错误。
   - 按错误指纹记录修复次数。同一个错误最多修改五次；第五次后仍未修复时放弃该错误，报告已放弃的错误指纹和最后一次证据。

7. 无阻塞运行时错误后，截取页面根节点 DOM。
   - 如果上下文中已有根节点 id，直接使用。
   - 否则检查 DOM，寻找页面根节点，优先使用现有 id。
   - 如果目标根节点没有 id，在源码中给它添加稳定 id，例如 `id="page-root"` 或更符合项目语义的名称，并等待热更新生效。
   - 使用 `playwright` MCP 时优先调用其元素定位和元素截图能力；fallback 到 `chrome-dev-tool` MCP 时使用对应元素截图能力。
   - 只截取该 DOM 元素，不截全屏视口。
   - 将截图保存到 `.codegen/artifacts/<语义化任务名或时间戳>/screenshot.png`，文件名使用路由派生出的稳定名称。

## 最终汇报

汇报最终访问 URL、实际使用的浏览器工具、是否发生了从 `playwright` MCP 到 `chrome-dev-tool` MCP 的降级及原因、是否仍有运行时错误、是否有放弃修复的错误指纹及尝试次数、修改过的文件和截图路径。如果修改了代码，明确说明没有重启服务，使用的是热更新。
