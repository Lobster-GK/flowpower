# 组件感知验收协议

当前 Skill 版本运行在 `sandbox-only` Visual Lab 中，`component` 指原生元素或本地组合结构，不代表目标项目 UI 库。验收算法仍使用 `component-faithful` 作为默认档位，但通过只证明沙箱视觉结果，不证明真实项目组件兼容性。

## 为什么不能让原始像素差异默认否决

UI 组件库会引入可接受的实现差异，例如字体抗锯齿、原生控件字形、图标路径、1px 边框落点、圆角插值和阴影采样。它们会制造大量原始像素差异，但不一定破坏布局、信息层级或交互状态。

因此把证据分成三层：

1. 硬门禁：作用域、fixture、状态、必需元素、内容、overflow 和 occlusion；
2. 主判证据：DOM 几何、排版和关键区域最低分；
3. 图像证据：降采样低通后的感知相似度参与评分，原始像素 diff 默认只用于定位。

全局平均分不能抵消关键区域失败。任何 critical region 或 required element 低于自己的最低分，都必须修复。

## 三种验收档位

- `structure-faithful`：原型或信息架构验证。只要求结构、状态和几何在较宽容差内正确。
- `component-faithful`：默认。适用于 Ant Design、Element Plus、MUI 等组件库项目。
- `pixel-faithful`：仅用于明确要求像素复刻的品牌页、活动页、定制图形或单独区域。

不要因为一个页面里有品牌 Banner，就把整页升级为 `pixel-faithful`。更合理的做法是页面使用 `component-faithful`，再为 Banner mapping 声明更严格的局部容差。

## DOM 测量坐标

浏览器必须把每个 `[data-visual-id]` 的矩形转换到 comparison canvas 的图像像素坐标，而不是保留 viewport CSS 坐标：

```text
imageX = (elementRect.left - captureRect.left + bleed.left - clipInset.left) * dpr
imageY = (elementRect.top  - captureRect.top  + bleed.top  - clipInset.top)  * dpr
imageWidth  = elementRect.width  * dpr
imageHeight = elementRect.height * dpr
```

记录 `measurementSpace.origin=comparison-canvas`、`units=image-px` 和 `dprApplied=true`。测量项还要记录：

- `present`、`visible`、`contentMatched`、`stateMatched` 和当前 `state`；
- bbox；
- 横纵 overflow 和是否被裁切；
- occlusion ratio 与遮挡者；
- 可比较的 computed style：font family/size/weight/line-height 等。

不允许用截图分析结果回填 actual DOM bbox；两者必须是独立证据。

## 组件局部策略

在 `component-adaptation.json` 的 mapping 上声明 `acceptancePolicy`。它可以放宽或收紧该元素的几何与排版容差，并列出允许的组件库差异。

允许差异必须满足：

- 可定位到具体属性；
- 有组件库或平台原因；
- 有数值上限或不变量；
- 不得放宽元素存在性、内容、状态、overflow 或 occlusion 硬门禁。

例如可以允许圆角相差 2px，但不能用“组件库默认样式不同”接受整张表格高度、分页位置或列对齐错误。

## 运行顺序

```bash
node <SKILL_DIR>/scripts/compare-png.mjs \
  reference.png actual.png \
  --alignment-report alignment-report.json \
  --acceptance-policy visual-acceptance-policy.json \
  --regions 01-visual-contract.json \
  --output pixel-report.json \
  --diff diff.png \
  --evidence-dir evidence

node <SKILL_DIR>/scripts/evaluate-visual-acceptance.mjs \
  visual-acceptance-policy.json \
  01-visual-contract.json \
  02-component-adaptation.json \
  alignment-report.json \
  pixel-report.json \
  --output visual-evaluation.json
```

`pixel-report.gate` 只说明图像证据是否达到当前 profile 的要求；最终状态以 `visual-evaluation.status` 为准。
