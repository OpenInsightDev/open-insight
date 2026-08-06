# Harbor 任务表达能力与 `packages/eval/src/task/` 的覆盖分析

> 记录时间：参考 harbor-framework/harbor（`docs/tasks` 与 `src/harbor/models/task/`）
> 对照对象：`packages/eval/src/task/`（及其依赖的 `Resource` / `Snapshot` / `Grade` / `trail`）

## 结论

`packages/eval/src/task/` **不能完全覆盖** Harbor 任务表达式能力（除 Windows 支持外）。

Harbor 的核心模型——**单容器、共享 sandbox、一条指令 + 任意结构化 reward（含 LLM judge、多阶段、resume）**——大部分轴向可以覆盖，部分轴向甚至更强。但存在**一类结构性缺口**（独立 verifier 环境、多容器/sidecar、分阶段网络策略、TPU/gpu_types、`min_reward` 早停与 reward 汇总、healthcheck、MCP/skills 等）在当前模块内无法等价表达。

本模块特有的能力（typed grade、`Grade.retry`、task/traj metric、`verif`/`expect` 验证模式）超出 Harbor task 规格所需，属于"增强侧"，不计入缺口。

---

## 覆盖良好 / 更强

| Harbor 表达                                               | 本地 task 模块                                                                           | 结论                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 静态 `instruction.md`                                     | `prompt`（静态字符串 / 多消息 / 动态 `PromptFn` / `{init, followUp}` 异步生成器）        | **更强**：支持多轮、按 trajectory 动态生成、模拟用户等多阶段输入 |
| `task.*`（name/description/authors/keywords）             | `Task.make` 对应字段                                                                     | ✅ 基本覆盖（缺 `version` 与任意 `extras`）                      |
| 环境 `Dockerfile` / `docker_image`                        | `Snapshot.build(Containerfile)` / `Snapshot.make(image)` / `Snapshot.makeWith`（指令集） | ✅ 覆盖；指令集额外提供跨 provider 可移植性                      |
| `reward.txt`（标量）/ `reward.json`（多维）               | grade schema 任意 JSON（typed、校验）                                                    | **更强**：任意结构化、强类型、可校验                             |
| RewardKit：LLM/agent judge、criteria、权重、加权/全过聚合 | grader 为任意 async TS，可调 LLM、自行聚合                                               | ✅ 表达能力覆盖（作者自行实现；无内建 rewardkit 库）             |
| 多阶段（`[[steps]]`）                                     | `Task.stage` 顺序管道 + `prevResults`                                                    | ✅ 覆盖（共享同一 sandbox）                                      |
| 每步 `workdir/setup.sh`                                   | `stage.init`                                                                             | ✅ 覆盖                                                          |
| 跨步 resume agent context                                 | `stage.resume` + run 级配置                                                              | ✅ 覆盖                                                          |
| trajectory 型 verifier                                    | grader ctx 携带 `trajectory`                                                             | ✅ 覆盖                                                          |
| —                                                         | `Grade.retry`、`verif`/`expect`、task/traj metric                                        | 本地增强（类比 Harbor 的 solution/Oracle 校验与更高层指标）      |

---

## 未覆盖 / 存在缺口

按严重程度排序：

1. **独立 verifier 环境**（`verifier.environment_mode="separate"`、`[verifier.environment]`、每步 verifier env、agent 与 verifier 的 user/env 隔离）
   - 本模块 grader 始终运行在 **agent 同一个 sandbox**（`trail.ts` 的 `execGrader` 直接使用 `ctx`），无"专用评分容器"概念。
   - 无法表达"评分代码对 agent 不可见 / 换 OS 评分 / 独立基线网络"等场景。

2. **多容器 / Compose 与 sidecar**（`docker-compose.yaml`、多服务、sidecar artifacts、`[[verifier.collect]]`）
   - `Snapshot` 只有单容器模型；无 compose，也无"从某个服务拉取评分证据"的抽象。

3. **分阶段网络策略**（`[agent]` / `[verifier]` phase override、`dynamic_network_policy`、运行期 allow flags）
   - `Resource.network` 是**整个 sandbox 生命周期的一条静态策略**，无法在 agent 运行阶段与验证阶段之间切换（如 agent 阶段放行 API、verifier 阶段断网）。
   - 本地等价物只有 Harbor 的 `[environment]` 基线。

4. **资源字段缺失**
   - `Resource` 仅含 `numCPUs / numGPUs / memoryMiB / storageMiB / network / buildTimeoutSec / runTimeoutSec`。
   - 无 `gpu_types`、无 TPU（`type`+`topology`），也无 Harbor 的 enforcement policy（limit/request/guarantee）语义。

5. **`min_reward` 早停 + `multi_step_reward_strategy`（mean/final 汇总）**
   - `trail.ts` 的 `runFoldEffect` **无条件跑完所有 stage**，无 early-stop 门控。
   - 无自动汇总策略；作者可在末级 grader 用 `prevResults` 手算 mean，但非内建。

6. **healthcheck（环境级 + 每步）** — task 模块无任何 healthcheck 抽象。

7. **MCP servers、`skills_dir`** — 属于 agent 运行环境配置，task 模块不表达（本地对应 agent/harness 层）。

8. **分阶段 timeout / env / user**
   - Harbor 区分 `agent.timeout` 与 `verifier.timeout`、`[agent.env]` / `[verifier.env]` / `[solution.env]`。
   - 本地 `Resource.runTimeoutSec` 是单一 sandbox 超时；env 靠 `Snapshot.env` 静态注入或 `init` 手动设置，且无宿主 `${VAR}` 模板解析。属部分覆盖。

9. **artifacts 声明式收集**（`artifacts =`、sidecar artifacts、collect hooks）
   - 本地 sandbox 有 `download/upload/expose` 原语，但 task 模块无"收集路径清单"的声明式配置，属 trial/harness 职责。

---

## 边界与口径

- 本分析以 **`packages/eval/src/task/` 单一模块**为界。
- 若把 core 的 `Resource` 一并计入，则网络**模式**本身已覆盖，但**分阶段策略、独立 verifier 环境、Compose/sidecar** 仍不是 task 模块的表达能力。
- 本地独有增强（typed grade、`Grade.retry`、task/traj metric）超出"完全覆盖"所需，不计入缺口。

## 一句话总结

单步、单容器、共享 sandbox 的 Harbor 任务（指令 + 任意结构化 reward + LLM judge + 多阶段 + resume）基本可被覆盖，甚至更强；但涉及**独立评分环境、多容器/sidecar、分阶段网络、TPU/GPU 类型、早停与 reward 汇总、healthcheck、MCP/skills** 的 Harbor 任务无法在 `packages/eval/src/task/` 内完全等价表达。
