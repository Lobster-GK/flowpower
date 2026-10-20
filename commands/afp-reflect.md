# 流程复盘与资产沉淀

只使用 `frontend-flow-reflection` skill，对一次前端 AI 开发任务、一次 `/afp-scene` 流程、一个 artifact 目录，或当前对话中的开发过程做复盘。

这个命令用于沉淀经验，不用于继续生码、修复错误、执行 lint、启动项目或运行浏览器检查。

## 默认行为

默认只生成复盘报告和可执行建议，不修改任何文件。

必须遵守：

1. 先调用 `afp_get_project_config`，读取项目资产索引和 subagent 模型配置。
2. 根据用户指定的 `artifact`、`scene`、文件路径、最近对话结果或当前变更范围，收集最小必要证据。
3. 生成或更新 `04-reflection-report.md`。
4. 输出建议清单，区分 `assets`、`scene-template`、`skill`、`agent`、`quality`、`process`。
5. 没有用户明确授权时，不要修改 `config.yaml`、scene template、项目资产文档、skill、agent prompt 或业务代码。

## 参数约定

用户可以自然语言指定，也可以使用这些参数：

- `artifact=<path>`：复盘指定 artifact 目录。
- `scene=<id>`：复盘指定场景模板。
- `apply=true`：允许在用户确认的范围内落地建议。
- `target=<path>`：指定复盘报告输出路径。

如果用户没有指定 `target`，默认写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/04-reflection-report.md
```

## apply 模式

只有用户明确使用 `apply=true`、说“落地这些建议”、或明确要求“写入资产/模板/配置”时，才进入 apply 模式。

apply 模式也必须先输出待应用清单，并等待用户确认具体范围；不要一次性改动所有建议。

允许落地的内容仅限：

- 更新或新增项目资产 Markdown。
- 更新 `.opencode/apollo-flowpower/config.yaml` 的 `assets` 声明。
- 修改 `.opencode/apollo-flowpower/scene-template/*.yaml` 中用户确认的字段。
- 对命令、skill 或 agent 的改进建议，默认只写进报告；除非用户明确要求修改插件源码。

禁止：

- 借复盘继续实现功能。
- 借复盘修复未验证的代码问题。
- 因为建议存在就自动修改模板或资产。
- 把一次偶发现象直接沉淀成强规则；必须标注证据强弱。
