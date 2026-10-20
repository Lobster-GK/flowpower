---
name: frontend-ui-review
description: >
  用于审查 UI 还原度，通过对比已渲染页面或 DOM 截图与参考截图、layout spec、component mapping spec 或视觉需求发现偏差。适合在用户要求
  “UI 还原检查”“截图审查”“visual review”“compare with screenshot”或需要检查页面是否符合视觉目标时，并提供原始设计图，同时有 playwright（或chrome-dev-tool）mcp时使用。不适合初始图片转 spec、
  直接生码、API 设计、lint 错误、启动错误、普通图片描述、非 UI 图片、后端调试或无关前端问题。
---

# 页面设计稿对比

<EXTREMELY-IMPORTANT>
你**必须先调用 `afp_get_project_config` 解析项目配置**, 读取 userName、password 作为登录时的员工号和密码。调用 `afp_get_project_config` 无需传参
</EXTREMELY-IMPORTANT>

## 目标

对比已实现页面 UI 和原始设计稿，修复缺失或错误实现的 UI，并用新截图持续验证，直到页面匹配设计稿或达到修复轮数上限。

截图保存目录：`.codegen/artifacts/<语义化任务名或时间戳>/screenshot.png`

## 输入

- 需要上下文中存在原始设计稿，例如图片、截图、导出的设计图、PDF 页面渲染图，或明确引用的本地设计文件。如果没有设计稿，先请用户提供。
- 如果上下文中已经有目标页面运行时截图，并且能明确对应目标路由，直接使用该截图进行对比。
- 如果没有可用运行时截图，则按下面的路由截图流程先获取截图。

## 浏览器自动化策略

优先使用 `playwright` MCP。浏览器操作应由 `playwright` MCP 完成。

1. 使用 `playwright` MCP。
   - 如果当前上下文已有 `playwright` MCP 工具，直接使用，没有则使用`chrome-dev-tool` MCP。
   - 先读取 `playwright` MCP 暴露的工具列表、帮助信息、schema、说明或元数据，确认可用方法和参数，再调用对应能力。
   - 让模型按 MCP 实际提供的方法完成导航、点击、输入、等待、DOM 查询和元素截图。

2. `playwright` MCP 不可用时再使用 `chrome-dev-tool` MCP。
   - 仅当 `playwright` MCP 未安装、无法暴露、无法调用或缺少完成任务所需能力时，才 fallback 到 `chrome-dev-tool` MCP。
   - fallback 前记录 `playwright` MCP 不可用的原因。
   - 降级是必选方案：只要 `chrome-dev-tool` MCP 可用，就继续用它完成导航、DOM 检查和截图，不要因为 `playwright` MCP 不可用就直接停止。
   - 如果 `playwright` MCP 和 `chrome-dev-tool` MCP 都不可用，报告该阻塞原因。

不要自动安装 `playwright`、不要下载浏览器二进制、不要临时生成 `playwright` 脚本，除非用户明确要求。

## 登录

如果目标路由跳转登录页（页面地址包含 `/SOAM/oauth/login`），则说明需要登录；

使用 `playwright` MCP 时，填入员工号、密码，点击提交，并等待路由稳定，再访问目标路由。使用 `chrome-dev-tool` MCP fallback 时，也按同样的流程完成登录。

## 工作流程

1. 确定项目根目录和服务端口。
   - 如果用户提供了端口号，以用户提供的为准。
   - 否则按 JSON 解析 `package.json`，读取 `scripts.start` 或 `scripts.dev` 命令脚本。
   - 如果命令脚本中包含 `--port <数字>` 或 `--port=<数字>`，端口号就是该数字。
   - 如果没有 `--port` 参数，默认端口为 `8000`。

2. 检测项目服务是否已经启动。
   - 探测 `http://localhost:<端口>/`，或用 `chrome-dev-tool` 导航到该地址。
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

4. 截取目标根节点 DOM。
   - 如果上下文中已有根节点 id，直接使用。
   - 否则检查 DOM，寻找页面根节点，优先使用现有 id。
   - 如果目标根节点没有 id，在源码中给它添加稳定 id，并依赖热更新生效。
   - 使用 Playwright MCP 时优先调用其元素定位和元素截图能力；fallback 到 `chrome-dev-tool` MCP 时使用对应元素截图能力。
   - 只截取该根 DOM 元素，并将截图保存到 `.codegen/artifacts/<语义化任务名或时间戳>/screenshot.png`。

## 对比与修复循环

最多执行五轮修复。

1. 使用视觉推理对比运行时截图和原始设计稿。
   - 检查缺失元素、层级错误、布局、间距、对齐、字体、颜色、图标、图片、设计稿中可见的交互状态，以及设计稿包含视口信息时的响应式约束。
   - 将明显占位内容、文案错误、图片缺失、裁切异常和组件状态错误视为实现问题。
   - 不要凭空发明设计稿里不可见、用户也没有说明的需求。

2. 如果没有有意义的差异，停止循环。

3. 如果仍有差异，定位对应代码。
   - 搜索组件、样式、资源、路由文件和设计系统封装。
   - 保持修改聚焦，遵循项目既有架构，并保护用户已有改动。

4. 让热更新刷新页面。
   - 修改代码后不要重启服务。
   - 只在需要时用已选择的 MCP 浏览器工具重新导航或刷新页面。

5. 重新截取根 DOM 并再次对比。
   - 持续循环，直到视觉对比通过，或五轮修复用完。

## 最终汇报

汇报最终访问 URL、实际使用的浏览器工具、是否发生了从 `playwright` MCP 到 `chrome-dev-tool` MCP 的降级及原因、实际使用的修复轮数、修改过的文件、截图路径，以及如果达到五轮上限仍未完全匹配时遗留的视觉差异。
