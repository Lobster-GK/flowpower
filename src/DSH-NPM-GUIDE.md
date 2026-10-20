# 从零安装 DeepSeek Harness 并使用 AFP npm 插件

适用：Windows PowerShell、本地前端项目、当前 AFP 双入口实现。
版本基线：DSH / SDK `0.1.5-rc.2`。2026-09-16 查询时 DSH 的 npm `latest` 仍为 `0.1.5-rc.1`，因此安装命令显式指定 rc.2。

源码中的包名是 `apollo-flowpower`，但该名称在 npm 公共源查询返回 404。
下面使用 `$afpPackage` 变量代表实际发布的完整 npm 包名；请填写真实包名（含 scope）。
私有源还需配置正确的 registry 并在本机登录，不能把 token 写进本指南或聊天。

## 1. 安装 Node.js

从 [Node.js 官网](https://nodejs.org/en/download) 安装最新 Node 24 LTS，安装后重新打开 PowerShell：

```powershell
node --version
npm --version
```

Node 24.x 请至少使用 24.15，以满足本次安装遇到的传递依赖 engine 要求。

## 2. 安装 DSH 和 pnpm

```powershell
npm install -g pnpm @deepseek-ai/dsh@0.1.5-rc.2
pnpm --version
dsh --version
```

预期 DSH 版本为 `0.1.5-rc.2`。如果找不到命令，重新打开终端，检查 npm 全局可执行目录是否在 PATH 中。
pnpm 用于管理 DSH profile 的插件依赖，必须能直接在 PATH 中找到。

## 3. 从 npm 安装 AFP

填写发布后的包名，先确认元数据，再安装到 web profile：

```powershell
$afpPackage = '@你的scope/实际包名'
npm view $afpPackage version dsh exports peerDependencies --json
dsh plugin --profile web add $afpPackage
```

如需锁定插件版本，最后一行改为 `dsh plugin --profile web add "${afpPackage}@具体版本"`。
此操作将包安装到 DSH 的 web profile，不要求前端项目安装 AFP，也不需要克隆插件源码或执行插件的 build。

确认发布包包含 `dsh.bundle.patch` 和 `exports["./dsh"]`：

```powershell
dsh --profile web --dump-config | Select-String -Pattern 'apollo-flowpower' -Context 2,5
```

当前实现应显示 `id: apollo-flowpower` 和指向实际包 DSH 子路径的 `name`。
注意：如果发布时修改了 npm 包名，发布包内 `src/cordis.patch.yml` 的 name 也必须改成
`实际完整包名/dsh`。例如 `@team/afp/dsh`。只改 package.json 的 name 会导致模块解析失败。
没有 bundle 声明的包可能安装成功，但不会自动启用插件。

## 4. 从前端项目目录启动

```powershell
cd 'D:\work\my-frontend-project'
dsh web
```

把路径替换为要开发的项目。通常会自动打开 [本地 Web UI](http://127.0.0.1:3080)。
若浏览器没有自动打开，使用终端打印的地址。保持该 PowerShell 窗口运行。

安装、更新或卸载插件后，停止并重启 DSH，才能应用新的 bundle 列表。

## 5. 配置模型、工作区和会话

1. 在 Web UI 的“设置 → 模型”填写 DeepSeek API Key 并保存，或添加你已有的模型提供方。
2. 点击“选择工作区”，添加并选中前端项目目录；首次启动不会自动选中工作区。
3. 创建会话并选择可用模型。先使用标准模式，避免仅有 shell 的极简模式。
4. 先发送“请说明这个项目的技术栈”，确认模型和工作区可用。

公司网关可以通过“添加自定义提供方”配置 Provider ID、基础 URL、协议、密钥和模型。
截图任务需要实际支持图片的模型；手动添加模型时，还需在模型设置中声明 image 输入能力。
具体配置见 [官方模型指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.zh.md)。

## 6. 在 DSH 聊天框使用 AFP

以下命令在聊天框输入，不是在 PowerShell 中执行。

先检查 AFP 项目数据：

```text
/afp-doctor
```

根据文字生成页面：

```text
/afp-scene scene=text-to-page 创建用户管理页面，包含搜索、用户表格、新增用户弹窗，优先复用现有组件。
```

根据截图生成页面：在同一次消息中添加全部截图，再输入：

```text
/afp-scene scene=screenshot-to-page 按截图实现页面，这些图片是同一页面的不同状态。
```

修改已有功能：

```text
/afp-scene scene=feature-change 为用户列表增加状态筛选和批量禁用。
```

单项能力可分别调用：

| 命令 | 用途 |
|---|---|
| `/afp-ui-spec` | UI 布局与组件映射规格 |
| `/afp-codegen-plan` | 生成实现计划 |
| `/afp-ui-codegen` | 按计划实现 UI |
| `/afp-api-integration` | 接入接口 |
| `/afp-lint-check` | 代码规范检查 |
| `/afp-boot-check` | 启动检查 |
| `/afp-runtime-check` | 运行时检查 |
| `/afp-ui-review` | UI 审查 |
| `/afp-reflect` | 总结和改进 |

完整场景由 `/afp-scene` 触发；普通聊天和单能力命令不会自动升级为完整编排。
`afp_run_subagent` 是模型使用的委派工具，无需用户手动调用。

## 7. 项目资产和子 agent 模型

首次调用后，项目中会补齐 `.opencode/apollo-flowpower/config.yaml` 和 `scene-template/`。
这个名字是为了与 OpenCode 共用项目数据，在 DSH 中仍保留。
可以编辑 config.yaml 的 assets，保留文件原有其它字段：

```yaml
assets:
  - description: 项目组件库使用说明
    path: docs/components.md
  - description: 前端开发规范
    path: docs/frontend-rules.md
```

默认将各 subagent 的 `model` 留空，继承当前会话模型，最容易先跑通。
已有指定模型时，需要配置精确的 Harness provider/model 映射，见 [适配说明](DSH.md#子-agent-与模型)。
默认 profile patch 在 Windows 用户目录的 `.dsh/profiles/web/cordis.patch.yml`；
若设置了 DSH_HOME，则位于该目录下的 `profiles/web/cordis.patch.yml`。

## 更新与卸载

```powershell
dsh plugin --profile web update $afpPackage
# 需要卸载时再执行：
dsh plugin --profile web remove $afpPackage
```

执行相应操作后重启 DSH。

## 常见问题

| 现象 | 检查项 |
|---|---|
| npm 404 | 完整包名、scope、registry、私有源登录状态 |
| 安装成功但无 AFP 命令 | 发布包是否包含 bundle patch、安装和启动是否同为 web profile、是否已重启 |
| 找不到 `apollo-flowpower/dsh` | npm 包改名后，patch 的 name 是否同步修改；发布包是否包含 dist/dsh.js |
| 输入框不可用 | 是否选中工作区及有效模型 |
| modelRoutes 报错 | 将 AFP 指定模型映射到有效 provider/model，或清空指定模型以继承会话模型 |
| 缺少 read/write/edit、spawn、skill | 检查实际 profile/preset 的能力；当前适配要求完整文件工具和 spawn provider |
| 图片输入报错 | 模型是否实际支持图片，Harness 路由是否声明 image 输入能力 |

`--dump-config` 验证配置已加入，`/afp-doctor` 验证项目数据；二者都不能单独证明完整模型执行链已跑通。
发布版本还应实际执行一次文本场景和一次所需的图片场景。

## 官方参考

- [DSH CLI 与插件管理](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [Web UI 入门](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.zh.md)
- [发布与安装 bundle](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
