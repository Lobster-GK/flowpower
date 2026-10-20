# 视觉契约规范

## 目录

- 目标
- 坐标与单位
- 字段要求
- 证据与置信度
- 布局约束
- 排版约束
- 覆盖与验收

## 目标

`01-visual-contract.json` 是截图与实现之间的可执行视觉接口。它不描述业务结果，也不替代组件 API 文档。所有关键视觉决策必须能落到 CSS、组件 token、资产或可验证容差。

使用 `assets/visual-contract.template.json` 作为起点，并保持 `kind: visual-contract`、`schemaVersion: 1.0`。

## 坐标与单位

- `bbox` 使用参考图原始像素坐标：`x`、`y`、`width`、`height`。
- `x/y` 以比较裁剪区域左上角为原点。
- `source.viewport` 使用 CSS 像素；`source.dpr` 记录设备像素比。
- 当参考图像素与 CSS 像素不是 1:1 时，记录 `source.pixelToCssScale`，不要混写。
- `padding` 顺序固定为 `[top, right, bottom, left]`。
- 不确定的数字写 `null` 或 `{min,max}`，不能使用形容词。
- 每个测量值可附 `tolerance`。几何默认容差为 2px；抗锯齿颜色不使用 0 容差。

## 字段要求

### source

必须包含：

- `referenceImage`
- `imageWidth`、`imageHeight`
- `viewport.width`、`viewport.height`
- `dpr`
- `state`
- `crop`
- `pixelToCssScale`

如果某项未知，使用 `null` 并写入 `uncertainties`。

### tokens

只归并有证据的重复值：

- `colors`
- `spacing`
- `radii`
- `typography`
- `shadows`

保留原始测量值。不要为了构造漂亮的 token 系统而把相近但不同的颜色强行合并。

### regions

每个 region 至少包含：

- 稳定唯一 `id`
- `parentId`
- `role`
- `bbox`
- `layout`
- `appearance`
- `evidence`
- `confidence`
- `criticality`
- `elements`

`layout` 至少描述：

- `display`
- `direction`
- `sizing`
- `alignItems`
- `justifyContent`
- `padding`
- `gap`
- `overflow`

`sizing` 要区分 `fixed`、`content`、`fill`、`minmax`、`aspect-ratio` 和 `unknown`。bbox 是参考观测值，sizing 才是实现策略。

### elements

每个可见且影响还原的元素至少包含：

- `id`
- `role`
- `bbox`
- `content`
- `appearance`
- `typography`
- `asset`
- `evidence`
- `confidence`
- `required`

非文字元素的 `typography` 可为 `null`；非资产元素的 `asset` 可为 `null`。分隔线、背景块、状态点和图标不能因为没有业务名称而遗漏。

### appearance

根据可见内容记录：

- `background`
- `foreground`
- `border`
- `borderRadius`
- `boxShadow`
- `opacity`
- `objectFit`

边框应包含 width、style 和 color。阴影应记录完整 CSS 参数或 `none`，不能只写“轻微阴影”。

### typography

文字元素尽量记录：

- `fontFamily`
- `fontSize`
- `fontWeight`
- `lineHeight`
- `letterSpacing`
- `textAlign`
- `whiteSpace`
- `color`

字体未知会联动文字宽度、换行和组件高度，应列为阻塞风险，而不是只降低一个字段的置信度。

## 证据与置信度

`evidence` 使用对象：

```json
{
  "source": "reference.png",
  "method": "pixel-sample | edge-measure | crop-inspection | ocr | inferred",
  "detail": "表头上边界到第一条水平分隔线",
  "tolerance": 2
}
```

置信度定义：

- `high`：工具测量或清晰可复核。
- `medium`：视觉估计但边界明确，允许给出容差。
- `low`：遮挡、模糊、压缩或缺少基准；必须进入复核或不确定项。

推断得到的值不能标为 `high`。低置信度关键字段不得被组件默认值静默填充。

## 布局约束

记录 bbox 的同时，必须说明导致 bbox 的约束，避免生成器转写为大量绝对定位：

- 页面画布宽高与背景；
- 主分栏固定/弹性宽度；
- 容器 padding 与兄弟 gap；
- 网格列数、列宽和 gutter；
- 基线、顶部、底部或中心对齐；
- 内容换行、截断和 overflow；
- 固定高度与内容撑开的边界。

绝对定位只用于确实脱离文档流的浮层、徽标或装饰。

## 排版约束

先确认字体是否真实可用，再测量字号和行高。字体不一致时，不要先用 padding 补偿文字宽高差异。

排版修复顺序：

1. font family 和字体加载；
2. font weight；
3. font size 和 line-height；
4. letter-spacing；
5. 容器尺寸、padding 和截断。

## 覆盖与验收

`coverage` 必须包含：

- `allVisibleRegionsCaptured`
- `allRequiredElementsCaptured`
- `allCriticalGeometryMeasured`
- `allTypographyRisksRecorded`
- `unresolvedLowConfidenceCount`

任一布尔值为 false，或存在影响主布局的未解决低置信度字段时，不得把视觉契约标记为可生码。

视觉契约是可迭代的。渲染 diff 证明原测量错误时，更新契约并记录 `changeLog`，不要只在 CSS 中偷偷修正。
