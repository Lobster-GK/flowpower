---
name: frontend-visual-fidelity-loop
description: 将 UI 截图或设计稿转化为可测量视觉契约，在隔离的最小 Vite Visual Lab 中用静态写死数据生成基础 UI，并通过作用域对齐、DOM 几何、组件感知图像比较和局部修复完成 sandbox-only 验收。适用于截图生码、D2C、复杂表格或列表、真实项目样式与接口状态干扰严重、上下文预算有限，需要先隔离验证视觉结构与样式的场景。本版本禁止读取或修改目标项目、迁移 PageView、接入真实接口/Router/Store，或声称真实项目已经验收通过。
---

# 前端 Visual Lab 视觉还原闭环

在隔离 Vite 沙箱中验证参考图的基础 UI。最终结论只能是“Visual Lab 沙箱验证通过”，不能是“真实项目开发完成”。

## 不可突破的边界

- 只生成原生 HTML、CSS、JavaScript 和静态 JSON fixture。
- 不读取或修改目标项目，不导入其依赖、主题、组件、Router、Store 或 API client。
- 不访问网络；参考图中的表格、列表、分页、日期、头像和状态全部写死。
- 默认使用 `component-faithful`：原始像素 diff 是诊断证据，不是单独的通过门槛。
- 沙箱通过后立即停止；本版本不迁移 PageView，不进入真实生码或集成流程。

## 上下文纪律

必须读取 [上下文预算与阶段交接](references/context-budget.md)，并遵守：

1. 一次上下文只执行一个阶段；跨阶段只传 `run-state.json` 和 `context-packet.json`。
2. 运行任务时把 `scripts/*.mjs` 当黑盒，禁止读取源码。只有维护本 Skill 时可以读脚本。
3. CLI 默认摘要输出已足够；完整 JSON 留在 `--output` 文件。除脚本故障诊断外禁止 `--verbose`。
4. 不把完整报告、历史对话或整张 diff 粘回提示词；通过路径和 SHA-256 引用规范产物。
5. contract/generation 阶段最多查看 1 张完整参考图；repair 阶段默认只处理 1 个目标和 3 张局部裁图。
6. 每轮只写增量 `iteration-delta.json`，不重复累积完整历史。

## 产物目录

```text
.codegen/artifacts/<task>/visual-fidelity/
├── reference.png
├── 00-source-manifest.json
├── 01-visual-contract.json
├── 02-component-adaptation.json
├── visual-acceptance-policy.json
├── visual-lab/
├── visual-lab-lock.json
├── run-state.json
├── context-packet.json
├── iterations/iteration-N/
│   ├── debug-viewport.png
│   ├── actual.png
│   ├── capture-observation.json
│   ├── alignment-report.json
│   ├── diff.png
│   ├── evidence/<target>/{reference,actual,diff}.png
│   ├── pixel-report.json
│   ├── visual-evaluation.json
│   └── iteration-delta.json
└── visual-lab-acceptance.json
```

从 `assets/` 复制模板到任务目录，绝不直接修改 Skill 模板。

## 阶段路由

只读取当前阶段列出的参考资料：

| 阶段 | 必读 | 可选 | 允许动作 |
|---|---|---|---|
| contract | `visual-contract.md` | `prompt-visual-measurement.md` | 测量参考图并写视觉契约 |
| generation | `visual-lab-workflow.md` | `prompt-visual-lab-generation.md`、`component-adaptation.md` | 创建并实现静态 Visual Lab |
| capture | `comparison-scope-alignment.md` | `prompt-scope-alignment.md`、`data-fixture-stability.md` | 封存、截图和建立对齐报告 |
| repair | `render-convergence.md` | `prompt-render-critic.md`、`prompt-repair.md` | 只修当前失败目标 |
| acceptance | `component-aware-acceptance.md` | `prompt-acceptance-review.md` | 复核硬门槛并停止 |

不要预读后续阶段资料。

## 0. 建立当前阶段上下文包

每个阶段开始前执行：

```bash
node <SKILL_DIR>/scripts/build-run-state.mjs \
  <artifact> --phase <phase> --iteration <n> \
  --output <artifact>/run-state.json

node <SKILL_DIR>/scripts/build-context-packet.mjs \
  <artifact>/run-state.json \
  --output <artifact>/context-packet.json
```

后续仅把 `context-packet.json` 及其中列出的证据图交给当前阶段。修复阶段如需指定目标，使用 `--target <id>`；默认上限为 1，只有目标强耦合且证据明确时才显式提高，绝不超过 3。

## 1. Contract：固定基准并测量

登记参考图尺寸、crop、目标 viewport、DPR、可见状态和滚动位置。输出 `01-visual-contract.json`，至少包含稳定 ID、父子关系、bbox、布局、间距、排版、表面样式、静态内容、evidence、confidence 和 tolerance。

无法确认 viewport 时，不把图片像素直接宣称为 CSS 像素。契约校验失败时停止，不创建 UI：

```bash
node <SKILL_DIR>/scripts/validate-artifacts.mjs \
  <artifact>/01-visual-contract.json
```

## 2. Generation：创建最小 Visual Lab

```bash
node <SKILL_DIR>/scripts/create-visual-lab.mjs \
  <artifact>/visual-lab --lab-id <task-id>
```

只修改：

- `visual-lab/src/visual-fixture.json`
- `visual-lab/src/generated-ui.js`
- `visual-lab/src/generated-ui.css`

fixture 必须完整写死当前可见状态。每个 contract region/element 使用相同 `data-visual-id`。实现顺序固定为画布与主 region、父子几何与间距、排版与换行、表面样式、资产与细节。

`02-component-adaptation.json` 在本版本是紧凑渲染计划：只记录 native HTML/本地组合结构、样式所有权、显式覆盖、几何/排版容差和不可协商硬门槛，不选择目标项目 UI 库。

```bash
node <SKILL_DIR>/scripts/validate-artifacts.mjs <artifact>/02-component-adaptation.json
node <SKILL_DIR>/scripts/validate-artifacts.mjs <artifact>/visual-acceptance-policy.json
node <SKILL_DIR>/scripts/validate-visual-lab.mjs <artifact>/visual-lab
```

静态门禁必须阻止网络请求、随机/时钟数据、远程资产、逃逸导入、缺失根 ID 和任何目标项目读写声明。

## 3. Capture：构建、封存和作用域对齐

只在复制出的 `<artifact>/visual-lab` 内安装依赖并运行：

```bash
npm install
npm run build

node <SKILL_DIR>/scripts/seal-visual-lab.mjs \
  <artifact>/visual-lab \
  --output <artifact>/visual-lab-lock.json

node <SKILL_DIR>/scripts/validate-artifacts.mjs \
  <artifact>/visual-lab-lock.json

npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

等待 ready marker、字体、本地图片和根节点 bbox 稳定。先截完整 `debug-viewport.png` 用于排查，再按 manifest 根 selector 截取内容区域为 `actual.png`。设计稿只有内容区时，比较对象必须也是该 locator 的内容区；header、菜单和应用壳只存在于 debug 图，不能进入比较画布，也不能通过隐藏它们改变布局。

从浏览器实测生成 `capture-observation.json`，再执行：

```bash
node <SKILL_DIR>/scripts/build-alignment-report.mjs \
  <artifact>/00-source-manifest.json \
  <iteration>/capture-observation.json \
  --output <iteration>/alignment-report.json
```

只有 alignment `status=pass` 才能比较图像。

## 4. Compare：组件感知验收并生成局部证据

```bash
node <SKILL_DIR>/scripts/compare-png.mjs \
  <artifact>/reference.png <iteration>/actual.png \
  --alignment-report <iteration>/alignment-report.json \
  --acceptance-policy <artifact>/visual-acceptance-policy.json \
  --regions <artifact>/01-visual-contract.json \
  --output <iteration>/pixel-report.json \
  --diff <iteration>/diff.png \
  --evidence-dir <iteration>/evidence

node <SKILL_DIR>/scripts/evaluate-visual-acceptance.mjs \
  <artifact>/visual-acceptance-policy.json \
  <artifact>/01-visual-contract.json \
  <artifact>/02-component-adaptation.json \
  <iteration>/alignment-report.json \
  <iteration>/pixel-report.json \
  --output <iteration>/visual-evaluation.json

node <SKILL_DIR>/scripts/validate-artifacts.mjs \
  <iteration>/visual-evaluation.json
```

`component-faithful` 中，作用域、静态 fixture、状态、required element、内容、overflow、occlusion、DOM 几何和关键区域最低分是门槛；全局平均高分不能抵消关键区域失败，UI 组件的合理平台差异也不应被原始像素差单独否决。

## 5. Repair：单目标局部修复

重新生成 repair 阶段 `run-state.json` 和 `context-packet.json`。只查看包内当前目标的 reference/actual/diff 裁图，不重新加载整张参考图、完整 diff 或历史报告。

每轮先写一个可证伪根因，只改与它直接相关的文件和属性；优先顺序为环境、父级几何、间距与 overflow、排版、表面与资产。默认只修 1 个目标，最多 3 个强耦合目标。

完成后从 `assets/iteration-delta.template.json` 生成 `<iteration>/iteration-delta.json`，只记录本轮 changed files、resolved、remaining、regressions 和 next repair：

```bash
node <SKILL_DIR>/scripts/validate-artifacts.mjs \
  <iteration>/iteration-delta.json
```

任何 fixture、JS、CSS、manifest 或 package 变化后，都必须重新静态校验、构建、封存、截图、对齐和验收；不得沿用旧 lock 或旧报告。

## 6. Acceptance：通过并停止

同时满足以下条件才生成 `visual-lab-acceptance.json`：

- Visual Lab lock 与当前文件一致，网络访问 forbidden；
- alignment 和 visual evaluation 均为 `pass`；
- hard gates、critical regions、required elements 全部通过；
- 人工复核未发现测量结果与局部证据冲突；
- sandbox boundary 四项全部为 `false`。

```bash
node <SKILL_DIR>/scripts/validate-artifacts.mjs \
  <artifact>/visual-lab-acceptance.json
```

通过后立即停止。不得读取或修改目标项目、迁移 PageView、接真实接口/Router/Store、执行目标项目构建，或把沙箱结果表述为真实项目完成。达到迭代上限仍未通过时，报告剩余失败目标和证据，不生成 pass acceptance。
