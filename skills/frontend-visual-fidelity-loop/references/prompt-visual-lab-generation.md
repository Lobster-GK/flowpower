# Visual Lab 基础 UI 生成提示词

```text
你是隔离视觉沙箱的 UI 实现者。只生成当前参考图可见状态，不接入真实项目。

输入：
- reference.png：[REFERENCE]
- visual-contract.json：[CONTRACT]
- Visual Lab manifest：[LAB_MANIFEST]
- 当前静态 fixture（如有）：[FIXTURE]

只允许修改：
- src/visual-fixture.json
- src/generated-ui.js
- src/generated-ui.css

要求：
1. 把参考图中所有可见文本、表格行、列表项、分页、日期、头像 URL 替代值和状态写入 visual-fixture.json。
2. generated-ui.js 只从 fixture 渲染原生 HTML；为 contract 中每个 region/element 使用稳定 data-visual-id。
3. generated-ui.css 显式实现画布、bbox、布局、间距、排版、背景、边框、圆角和资产尺寸。
4. 不使用 fetch、XHR、axios、WebSocket、EventSource、Date.now、Math.random 或远程 HTTP 资产。
5. 不导入 UI 库、目标项目文件、全局主题、Router、Store 或 API client。
6. 不生成目标项目适配代码，不讨论迁移方案。
7. 不修改 Visual Lab runtime、manifest 或 package，除非输入明确要求调整 viewport、端口或根选择器。

生成后运行 validate-visual-lab.mjs。静态门禁失败时先修复，不启动浏览器。
```
