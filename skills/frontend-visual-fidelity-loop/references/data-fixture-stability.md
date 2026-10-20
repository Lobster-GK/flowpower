# 动态数据稳定协议

## 目录

- 目标
- Fixture 状态建模
- 请求拦截
- 封存与哈希
- 运行时冻结
- 可见状态断言
- 捕获观测
- 阻塞条件
- Mask 边界

## 目标

在截图前固定接口响应、时间、随机数、用户状态、存储和可见数据形态。不要把动态数据造成的文字、行数、分页、标签、头像或行高差异交给 CSS 修复阶段。

每张参考图状态绑定一个独立 fixture set。默认使用静态 JSON；只有静态 fixture 无法表达请求序列时才使用 record-replay。随机生成器即使带 seed，也不如静态 fixture 稳定。

## Fixture 状态建模

使用 `assets/data-fixture-contract.template.json` 建立 `00-data-fixture-contract.json`。至少固定：

- fixture set ID 和模式；
- 业务请求 method、URL pattern、匹配次数与响应文件；
- 未命中业务请求策略；
- 时间、随机数、locale、timezone 和 storage；
- 可见行数、分页文本、选中/展开等状态断言。

为不同状态创建不同 fixture set，例如：

```text
users-table-default-v1
users-table-empty-v1
users-table-error-v1
users-table-long-text-v1
users-table-last-page-v1
```

不要在同一 fixture set 中按调用顺序随机切换响应。请求序列必须由明确 request ID 和匹配次数描述。

## 请求拦截

在打开页面或触发业务请求前安装 route。返回 fixture 文件的原始字节，记录实际响应 SHA-256：

```js
const body = await fs.promises.readFile(fixturePath);
await page.route('**/api/users?page=1&pageSize=10', async route => {
  requestLog.push({
    requestId: 'users-list',
    responseSha256: sha256(body)
  });
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body
  });
});
```

对 `businessUrlPatterns` 范围内没有匹配契约的请求直接记录到 `unmatchedBusinessRequests`，默认中止视觉比较。静态 JS、CSS、字体等资源只有在 `allowUnmockedUrlPatterns` 中才允许真实加载。

不要让一个请求某轮走 fixture、下一轮逃逸到真实后端。

## 封存与哈希

创建或修改 fixture contract/response 后运行：

```bash
node <SKILL_DIR>/scripts/seal-data-fixtures.mjs \
  <artifact>/00-data-fixture-contract.json \
  --output <artifact>/00-data-fixture-lock.json
```

lock 固定 contract 原始字节哈希、每个 response fixture 哈希、请求约束和 fixture set digest。每次迭代只能读取同一 lock；contract 或 response 文件变化但没有重新封存时必须阻塞。

`00-source-manifest.json` 同时记录 contract、lock、expected fixture set ID 和 digest。重新封存是显式基线变更，必须同步 manifest 并重新确认参考状态，不能在修复 CSS 时顺手更新。

## 运行时冻结

根据 contract 固定：

- `Date.now()`、`new Date()` 和相对时间基准；
- `Math.random()` 或项目随机源；
- timezone 和 locale；
- localStorage、sessionStorage、cookie 和当前用户；
- 默认排序、分页页码和虚拟列表滚动位置。

浏览器观测必须记录实际值，不能只记录“已调用冻结脚本”。若页面从服务端生成时间或随机值，必须在 fixture 响应中固定。

## 可见状态断言

在截图前执行 contract 中全部 `visibleAssertions`。支持：

- `count`：行、卡片、分页项数量；
- `text`：规范化后的完整可见文本；
- `attribute`：状态属性或 data attribute；
- `value`：输入值；
- `checked`：选中状态。

表格和列表至少断言可见条目数以及分页或总数状态。断言必须等待真实条件成立，不能用固定 sleep 替代。

长文本、空值、状态标签和换行会改变布局。参考图可识别时使用原文；无法识别时使用经过确认、视觉长度接近的固定文本，并把内容非等价记录为验收限制。

## 捕获观测

在 `capture-observation.dataReadiness` 中记录：

- fixture set ID 和 digest；
- 每个 request ID 的实际匹配次数和响应 SHA-256；
- 未匹配业务请求；
- runtime 实测值；
- visible assertion 实际值；
- network/data 是否 settled。

`build-alignment-report.mjs` 会重新验证 lock 和 fixture 文件、请求次数、响应哈希、运行时冻结和可见断言。浏览器观察者不能自行把数据状态宣布为 pass。

## 阻塞条件

以下任一情况阻塞 PNG diff：

- fixture contract 或 response 与 lock 哈希不一致；
- manifest 期望的 fixture ID/digest 与 lock 不一致；
- 预期请求缺失、重复或响应哈希不一致；
- 出现未拦截业务请求；
- 时间、随机数、timezone、locale 或 storage 未按契约固定；
- visible assertion 不匹配；
- network/data 尚未 settled；
- fixture 在迭代之间被重新封存但参考状态没有重新确认。

## Mask 边界

不要 mask 整个表格、列表或 cell 内容来规避动态数据。这样会失去行高、padding、基线、标签尺寸、换行和分隔线的验证。

只有不会改变布局的极小动态字段，例如单个实时计数或时间戳，在确实无法固定且用户接受时才可 mask。mask 规则仍受比较作用域协议的面积门禁约束。
