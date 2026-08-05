# Harbor 数据结构参考

本文记录 Harbor 对外使用的数据结构、文件协议以及对应的源码路径。

本文以仓库中的上游 Harbor 实现为准：

- 上游源码根目录：`.repos/harbor/`
- 本包源码根目录：`packages/harbor/src/`
- 本包已开始使用 Effect Schema 复刻上游 Harbor 的公开数据模型；当前已完成 Job/Trial、ATIF 轨迹和 Dataset Manifest / Registry 结构。
- 因此，本文中的源码路径主要指向 `.repos/harbor/src/harbor/`；这些路径是协议来源，不代表它们已经存在于本包中。

## 实现进度

当前已完成：

- Job/Trial 输入配置：`JobConfig`、`TrialConfig`、`TrialTaskConfig`、`DatasetConfig`、`RetryConfig`、Source 配置，以及 Agent、Environment、Verifier、Artifact 和 TaskConfig 嵌套结构。
- Job/Trial 输出结果：`JobResult`、`JobStats`、`AgentDatasetStats`、`TrialResult`、`AgentInfo`、`ModelInfo`、`TimingInfo`、`ExceptionInfo`、`StepResult`、`AgentContext` 和 `VerifierResult`。
- Artifact 输出清单：`ArtifactManifest` 和 `ArtifactManifestEntry`。
- 基础任务 ID 联合：`LocalTaskId`、`GitTaskId`、`PackageTaskId`。
- ATIF 轨迹：`Trajectory`、`Agent`、`Step`、`ToolCall`、`Observation`、`ObservationResult`、`Metrics`、`FinalMetrics`、`ContentPart`、`ImageSource` 和 `SubagentTrajectoryRef`。
- Dataset Manifest / Registry：`DatasetManifest`、`DatasetInfo`、`DatasetTaskRef`、`DatasetFileRef`、`DatasetSummary`、`DatasetFileInfo`、`DatasetMetadata`、`LocalRegistryInfo`、`RemoteRegistryInfo`、`RegistryTaskId`、`DatasetSpec` 和 `Registry`。
- Package Reference：`PackageReference`、`VersionRef` 和 `RefType`。
- Schema 默认值、日期字符串、UUID、枚举、联合结构及 JSON 环境变量边界验证。

实现位置为 `packages/harbor/src/common/`、`task/`、`job/`、`trial/`、`trajectory/`、`dataset/` 和 `package/`，统一从 `packages/harbor/src/index.ts` 导出。`EnvironmentType` 的 provider 列表易于变化，本包暂不将其具体值固化为枚举，相关字段按字符串处理。

尚未实现的结构包括 Compile/Exec、Analyze、RewardKit、Viewer、Hub 及其他上传下载 DTO。

## 范围与约定

本文只记录以下结构：

- 用户可以提交的任务、数据集、Job 或 Trial 配置；
- Harbor 会写出的 Job、Trial、轨迹、奖励和分析结果；
- Harbor 的公开 Registry、Viewer、Hub、上传下载接口 DTO；
- RewardKit 的公开配置和评分结果。

不记录以下内部结构：

- `lock.json` 使用的 `JobLock`、`TrialLock` 等复现锁；
- `db/types.py` 中自动生成的 Supabase 数据库 row 类型；
- 各 Agent 或 Sandbox Provider 私有的请求响应模型；
- 缓存、认证、遥测和任务调度内部结构。

字段记号：`?` 表示可选或可为 `null`；`[]` 表示默认空数组；`{}` 表示默认空对象。

## 任务包输入

任务包由以下文件组成：

| 文件             | 作用                               | 结构类型       |
| ---------------- | ---------------------------------- | -------------- |
| `task.toml`      | 任务配置和元数据                   | `TaskConfig`   |
| `instruction.md` | 交给 Agent 的任务指令              | Markdown 文本  |
| `environment/`   | Dockerfile、Compose 或其他环境定义 | 文件目录协议   |
| `tests/`         | 验证逻辑                           | 脚本和测试资源 |
| `solution/`      | 可选参考解法                       | 文件目录协议   |

核心模型路径：`.repos/harbor/src/harbor/models/task/config.py`。

### `TaskConfig`

| 字段                         | 类型                          | 说明                   |
| ---------------------------- | ----------------------------- | ---------------------- |
| `schema_version`             | `str`，默认 `"1.4"`           | 任务配置格式版本       |
| `task`                       | `PackageInfo?`                | 任务包身份信息         |
| `metadata`                   | `dict[str, Any]`              | 任务作者自定义元数据   |
| `verifier`                   | 任务级 `VerifierConfig`       | 验证器设置             |
| `agent`                      | 任务级 `AgentConfig`          | Agent 阶段覆盖设置     |
| `environment`                | 任务级 `EnvironmentConfig`    | 容器和网络基线         |
| `solution`                   | `SolutionConfig`              | 参考解法环境变量       |
| `source`                     | `str?`                        | 任务来源               |
| `multi_step_reward_strategy` | `"mean" \| "final"?`          | 多步骤 reward 聚合策略 |
| `steps`                      | `list[StepConfig]?`           | 多步骤任务定义         |
| `artifacts`                  | `list[str \| ArtifactConfig]` | 需要收集的产物         |

### 任务元数据

`PackageInfo` 位于 `models/task/config.py`：

| 字段          | 类型                     |
| ------------- | ------------------------ |
| `name`        | `str`，格式为 `org/name` |
| `version`     | `str?`                   |
| `description` | `str`                    |
| `authors`     | `list[Author]`           |
| `keywords`    | `list[str]`              |

`Author` 字段为 `name: str` 和 `email: str?`。

### 任务环境

任务级 `EnvironmentConfig` 位于 `models/task/config.py`，与 Job 配置中的同名类型不同。

| 字段                | 类型                                      | 说明                          |
| ------------------- | ----------------------------------------- | ----------------------------- |
| `network_mode`      | `"public" \| "no-network" \| "allowlist"` | 网络基线，默认 public         |
| `allowed_hosts`     | `list[str]?`                              | 主机名、IP、CIDR 或前导通配符 |
| `build_timeout_sec` | `float`，默认 `600.0`                     | 构建超时                      |
| `docker_image`      | `str?`                                    | 预构建镜像                    |
| `os`                | `"linux" \| "windows"`                    | 目标容器系统，默认 linux      |
| `cpus`              | `int?`                                    | CPU 数量                      |
| `memory_mb`         | `int?`                                    | 内存大小                      |
| `storage_mb`        | `int?`                                    | 存储大小                      |
| `gpus`              | `int?`                                    | GPU 数量                      |
| `gpu_types`         | `list[str]?`                              | 可接受的 GPU 类型             |
| `tpu`               | `TpuSpec?`                                | TPU 类型和拓扑                |
| `mcp_servers`       | `list[MCPServerConfig]`                   | Agent 可用 MCP 服务           |
| `env`               | `dict[str, str]`                          | 运行时环境变量                |
| `skills_dir`        | `str?`                                    | 环境内 Skills 目录            |
| `healthcheck`       | `HealthcheckConfig?`                      | 启动健康检查                  |
| `workdir`           | `str?`                                    | 默认工作目录                  |
| `allow_internet`    | `bool?`                                   | 已废弃的兼容字段              |

相关嵌套结构也定义在 `models/task/config.py`：

- `TpuSpec`：`type: str`、`topology: str`；芯片数量由拓扑乘积推导。
- `HealthcheckConfig`：`command`、`interval_sec`、`timeout_sec`、`start_period_sec`、`start_interval_sec`、`retries`。
- `MCPServerConfig`：`name`、`transport`、`url?`、`command?`、`args`。传输类型为 `stdio`、`sse` 或 `streamable-http`。
- 任务级 `AgentConfig`：`timeout_sec?`、`user?`、`network_mode?`、`allowed_hosts?`。
- `SolutionConfig`：`env: dict[str, str]`。

### 验证器和步骤

任务级 `VerifierConfig` 字段为：

| 字段               | 类型                                       |
| ------------------ | ------------------------------------------ |
| `timeout_sec`      | `float`，默认 `600.0`                      |
| `env`              | `dict[str, str]`                           |
| `user`             | `str \| int?`                              |
| `network_mode`     | `"public" \| "no-network" \| "allowlist"?` |
| `allowed_hosts`    | `list[str]?`                               |
| `environment_mode` | `"shared" \| "separate"?`                  |
| `environment`      | `EnvironmentConfig?`                       |
| `collect`          | `list[VerifierCollectConfig]`              |

`VerifierCollectConfig` 表示在 Compose 服务中执行的快照命令：
`command`、`service`（默认 `main`）、`timeout_sec`（默认 `60.0`）和 `user?`。

`StepConfig` 位于同一文件，字段为：

- `name: str`
- `agent: AgentConfig`
- `verifier: VerifierConfig`
- `min_reward: float \| dict[str, float]?`
- `healthcheck: HealthcheckConfig?`
- `artifacts: list[str \| ArtifactConfig]`

### Artifact 配置

`ArtifactConfig` 位于 `models/task/config.py`：

| 字段          | 类型        | 约束                                                                      |
| ------------- | ----------- | ------------------------------------------------------------------------- |
| `source`      | `str`       | 容器内路径，不允许 `..`                                                   |
| `destination` | `str?`      | trial artifacts 下的相对路径，不允许绝对路径、`..` 或覆盖 `manifest.json` |
| `exclude`     | `list[str]` | 目录收集时的排除模式                                                      |
| `service`     | `str?`      | Compose 服务名；sidecar 时 source 必须是绝对路径                          |

## Job 和 Trial 输入

Job 和 Trial 的持久化配置通常是 JSON，也可由 YAML 或 Python 模型构造。

主要路径：

- Job：`.repos/harbor/src/harbor/models/job/config.py`
- Trial：`.repos/harbor/src/harbor/models/trial/config.py`

### `JobConfig`

| 字段                                   | 类型                          |
| -------------------------------------- | ----------------------------- |
| `job_name`                             | `str`                         |
| `jobs_dir`                             | `Path`，默认 `jobs`           |
| `n_attempts`                           | `int`                         |
| `install_only`                         | `bool`                        |
| `timeout_multiplier`                   | `float`                       |
| `agent_timeout_multiplier`             | `float?`                      |
| `verifier_timeout_multiplier`          | `float?`                      |
| `agent_setup_timeout_multiplier`       | `float?`                      |
| `environment_build_timeout_multiplier` | `float?`                      |
| `debug`                                | `bool`                        |
| `n_concurrent_trials`                  | `int`，默认 `4`               |
| `quiet`                                | `bool`                        |
| `retry`                                | `RetryConfig`                 |
| `environment`                          | Job 级 `EnvironmentConfig`    |
| `verifier`                             | Job 级 `VerifierConfig`       |
| `metrics`                              | `list[MetricConfig]`          |
| `agents`                               | `list[AgentConfig]`           |
| `datasets`                             | `list[DatasetConfig]`         |
| `tasks`                                | `list[TrialTaskConfig]`       |
| `artifacts`                            | `list[str \| ArtifactConfig]` |
| `extra_instruction_paths`              | `list[Path]`                  |
| `source_jobs`                          | `list[SourceJobConfig]`       |

Job 级 `AgentConfig` 包含任务级 Agent 设置之外的运行字段：
`name?`、`import_path?`、`model_name?`、`n_concurrent?`、`concurrency_group?`、`skills`、`override_timeout_sec?`、`override_setup_timeout_sec?`、`max_timeout_sec?`、`resume_trajectory`、`load_trajectory?`、`extra_allowed_hosts`、`include_logs`、`exclude_logs`、`kwargs`、`env` 和 `mcp_servers`。

Job 级 `EnvironmentConfig` 还包含：
`type?`、`import_path?`、`force_build`、`delete`、CPU/内存 enforcement policy、资源 override、`mounts`、`extra_docker_compose`、`env`、`kwargs` 和 `extra_allowed_hosts`。

Job 级 `VerifierConfig` 包含：
`override_timeout_sec?`、`max_timeout_sec?`、`include_logs`、`exclude_logs`、`env`、`import_path?`、`kwargs` 和 `disable`。

### Dataset 选择

`DatasetConfig` 位于 `models/job/config.py`：

`path?`、`name?`、`version?`、`ref?`、`registry_url?`、`registry_path?`、`repo?`、`overwrite`、`download_dir?`、`task_names?`、`exclude_task_names?` 和 `n_tasks?`。

`version` 与 `ref` 不能同时设置；本地路径与名称也不能同时设置。

### Trial 配置

`TrialConfig` 位于 `models/trial/config.py`：

`task`、`trial_name`、`trials_dir`、`install_only`、各类 timeout multiplier、`agent`、`environment`、`verifier`、`artifacts`、`extra_instruction_paths`、`job_id?` 和 `source_trial?`。

Trial 任务定位结构在上游源码中名为 `TaskConfig`，本包为避免与 `task.toml` 的完整 `TaskConfig` 冲突，命名为 `TrialTaskConfig`（别名 `TaskReferenceConfig`），字段是：

`path?`、`git_url?`、`git_commit_id?`、`name?`（`org/name`）、`ref?`、`overwrite`、`download_dir?` 和 `source?`。

### Retry 和 Regrade

`RetryConfig` 位于 `models/job/config.py`：

`max_retries`、`include_exceptions?`、`exclude_exceptions?`、`wait_multiplier`、`min_wait_sec`、`max_wait_sec`。

`SourceJobConfig` 和 `SourceTrialConfig` 的字段分别为：

- `action: "regrade"`
- `type: "local" | "hub"`
- Job 使用 `job_id?`，Trial 使用 `trial_id?`
- 本地来源使用 `path?`

### 公共枚举和基础类型

| 类型              | 值或字段路径                                                 |
| ----------------- | ------------------------------------------------------------ |
| `EnvironmentType` | 上游 provider 类型；本包不固化具体值，Schema 中按 `str` 处理 |
| `ResourceMode`    | `auto`、`limit`、`request`、`guarantee`、`ignore`            |
| `MetricType`      | `sum`、`min`、`max`、`mean`、`uv-script`                     |
| `MetricConfig`    | `type: MetricType`、`kwargs: dict[str, Any]`                 |

任务来源 ID 位于 `models/task/id.py`：

- `LocalTaskId`：`path`
- `GitTaskId`：`git_url`、`git_commit_id?`、`path`
- `PackageTaskId`：`org`、`name`、`ref?`

## Job 和 Trial 输出

主要路径：

- `.repos/harbor/src/harbor/models/job/result.py`
- `.repos/harbor/src/harbor/models/trial/result.py`
- `.repos/harbor/src/harbor/models/verifier/result.py`

### `JobResult`

字段为：`id`、`started_at`、`updated_at?`、`finished_at?`、`n_total_trials`、`stats` 和 `trial_results`。

`JobStats` 包含完成、错误、运行中、待运行、取消和重试计数，以及 eval 聚合、输入 token、缓存 token、输出 token 和成本。

`AgentDatasetStats` 包含 trial/error 计数、指标数组、`pass_at_k`、按 reward 分组的 trial 名称和按异常类型分组的 trial 名称。

### `TrialResult`

字段为：`id`、`task_name`、`trial_name`、`trial_uri`、`task_id`、`source?`、`task_checksum`、`config`、`agent_info`、`agent_result?`、`verifier_result?`、`verifier_environment_mode?`、`exception_info?`、各阶段时间信息以及 `step_results?`。

嵌套结构：

- `AgentInfo`：`name`、`version`、`model_info?`
- `ModelInfo`：`name`、`provider?`
- `TimingInfo`：`started_at?`、`finished_at?`
- `ExceptionInfo`：异常类型、消息、traceback 和发生时间
- `StepResult`：步骤名、Agent 结果、Verifier 结果、异常和阶段时间
- `AgentContext`：token、成本、rollout 细节和扩展元数据

### Verifier 和 Artifact 输出

`VerifierResult` 只有一个公开字段：
`rewards: dict[str, float | int]?`。

`artifacts/manifest.json` 对应：

- `ArtifactManifestEntry`：`source`、`destination`、`type`（file/directory）、`status`（ok/failed/empty/skipped）、`service?`
- `ArtifactManifest`：`entries: list[ArtifactManifestEntry]`

## ATIF 轨迹

源码路径：`.repos/harbor/src/harbor/models/trajectories/`。

公开模型包括：

| 模型                    | 字段概览                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Trajectory`            | schema 版本、session/trajectory ID、Agent、步骤、备注、最终指标、续接引用、扩展字段、嵌套 subagent 轨迹                  |
| `Agent`                 | name、version、model_name、tool_definitions、extra                                                                       |
| `Step`                  | step_id、timestamp、source、message、model、reasoning、tool calls、observation、metrics、context 标记、LLM 调用数、extra |
| `ToolCall`              | tool_call_id、function_name、arguments、extra                                                                            |
| `Observation`           | results                                                                                                                  |
| `ObservationResult`     | source_call_id、content、subagent 引用、extra                                                                            |
| `Metrics`               | prompt/completion/cache tokens、cost、token IDs、logprobs、extra                                                         |
| `FinalMetrics`          | 总 token、总成本、总步骤数、extra                                                                                        |
| `ContentPart`           | text 或 image 内容                                                                                                       |
| `ImageSource`           | image MIME 类型、文件路径或 URL                                                                                          |
| `SubagentTrajectoryRef` | trajectory_id、session_id、trajectory_path、extra                                                                        |

ATIF 约束包括：步骤编号从 1 连续递增；步骤至少有一项；时间戳必须是 ISO 8601 字符串；`system`/`user` 步骤不能包含 agent-only 字段；`llm_call_count = 0` 的 agent 步骤不能包含 LLM 指标或推理；观察结果引用的 tool call 必须存在；嵌套 subagent 必须拥有唯一 `trajectory_id`；`SubagentTrajectoryRef` 至少提供 `trajectory_id` 或 `trajectory_path`；所有 ATIF 模型拒绝未知字段。当前版本支持 `ATIF-v1.0` 至 `ATIF-v1.7`。

规范文档：`.repos/harbor/rfcs/0001-trajectory-format.md`。

## Dataset Manifest 和 Registry

主要路径：

- `.repos/harbor/src/harbor/models/dataset/manifest.py`
- `.repos/harbor/src/harbor/models/registry.py`
- `.repos/harbor/src/harbor/models/package/reference.py`
- `.repos/harbor/src/harbor/models/package/version_ref.py`

### `DatasetManifest`

| 模型              | 字段                                                     |
| ----------------- | -------------------------------------------------------- |
| `DatasetManifest` | `schema_version`、`dataset`、`tasks`、`files`            |
| `DatasetInfo`     | `name`、`version?`、`description`、`authors`、`keywords` |
| `DatasetTaskRef`  | `name`、`digest`（`sha256:<64 hex>`）                    |
| `DatasetFileRef`  | `path`、`digest?`                                        |

### Legacy Registry

`Registry`：`name?`、`url?`、`path?`、`datasets`。

`DatasetSpec`：`name`、`version`、`description`、`tasks`、`metrics`。

`RegistryTaskId`：`name`、`git_url?`、`git_commit_id?`、`path`。

其他 Registry 返回结构包括 `DatasetSummary`、`DatasetFileInfo`、`DatasetMetadata`、`LocalRegistryInfo` 和 `RemoteRegistryInfo`，均位于 `models/registry.py`。

## Compile 和 Exec

模型路径：`.repos/harbor/src/harbor/models/compile/config.py` 和 `.repos/harbor/src/harbor/models/exec/config.py`。

`CompileConfig`：

`schema_version`、`dataset_name?`、`task_name_prefix?`、`output_dir?`、`instructions`、`task_template?`、`artifacts`、`environments`、`verifiers`。

其嵌套结构：

- `CompileInstruction`：`text?` 与 `path?` 二选一
- `CompileEnvironment`：`path?`、`paths`、`docker_image`、`workdir`
- `CompileVerifier`：`path?` 与 `auto_verifier?` 二选一
- `CompileAutoVerifierConfig`：`required_artifacts?`、`reward_artifact?`、`artifact_json_schemas`

`ExecConfig`：

`schema_version`、`map`、`reduce?`。

Map 和 Reduce 分别由 `ExecMapConfig`、`ExecReduceConfig`、`ExecJobConfig`、`ExecReduceTaskConfig` 和 `ExecReduceEnvironment` 组成。Reduce 任务字段包括 `task_name`、`output_dir`、`task_template?`、`instruction`、`artifacts`、`environment`、`verifier?` 和 `job`。

## Analyze 和 Quality Check

源码路径：

- `.repos/harbor/src/harbor/cli/quality_checker/models.py`
- `.repos/harbor/src/harbor/analyze/models.py`

公开结构：

- `Rubric`：`criteria: list[RubricCriterion]`
- `RubricCriterion`：`name`、`description`、`guidance`
- `QualityCheckModel`：`explanation`、`outcome`（pass/fail/not_applicable）
- `QualityCheckResult`：`checks`、`cost_usd?`、`task_name?`、`error?`
- `CheckReport`：`results`
- `AnalyzeResult`：`trial_name`、`summary`、`checks`、`estimated_cost_usd?`
- `JobAnalyzeResult`：`job_summary`、`trials`、`estimated_total_cost_usd?`
- `AnalyzeReportResult`：`trial_name?`、`summary?`、`checks`、`cost_usd?`、`error?`
- `AnalyzeReport`：`results`

输出位置：

- trial 下的 `analysis.json`：`AnalyzeResult`
- job 下的 `analysis.json`：`AnalyzeReport`

## RewardKit

RewardKit 是独立包，源码路径为 `.repos/harbor/packages/rewardkit/src/rewardkit/`。

主要模型位于 `models.py`：

- `Binary`：无字段，输出 yes/no
- `Likert`：`points`，默认 5
- `Numeric`：`min`、`max`
- `Criterion`：`description`、`output_format`、`name?`、`id?`、`files`、`negate`、`optional`
- `Score`：`name`、`value`、`raw`、`weight`、`reasoning`、`error?`、`description`、`id?`、`negate`、`optional`
- `MCPServerConfig`：`name`、`transport`、`url?`、`command?`、`args`、`allowed_tools`
- `LLMJudge`：`model`、`reasoning_effort`、`timeout`、`files`、`atif_trajectory?`、`reference?`、`mode`
- `AgentJudge`：`agent`、`model?`、`timeout`、`cwd?`、`isolated`、`atif_trajectory?`、`mode`、`mcp_servers`

Judge TOML 的公开结构包括 `[judge]`、多个 `[[criterion]]` 和可选 `[scoring]`；`scoring.aggregation` 支持 `weighted_mean`、`all_pass`、`any_pass`、`threshold`、`required_pass`。

输出文件：

- `reward.json`：`dict[str, float]`
- `reward-details.json`：每个 reward 的 score、criteria、评分类型、judge 信息、原始 judge 输出和 warnings

## Viewer、Hub 和操作结果 DTO

这些结构主要服务于本地 Viewer、Hub RPC 和 CLI 操作，源码路径如下：

| 功能            | 源码路径                                          | 主要结构                                                                                                           |
| --------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 本地 Viewer API | `.repos/harbor/src/harbor/viewer/models.py`       | `PaginatedResponse`、`JobSummary`、`TaskSummary`、`TrialSummary`、`FileInfo`、`FilterOption`、`ComparisonGridData` |
| Viewer 请求体   | `.repos/harbor/src/harbor/viewer/server.py`       | `SummarizeRequest`、`TrialSummarizeRequest`、`UploadJobRequest`                                                    |
| Hub 查询结果    | `.repos/harbor/src/harbor/hub/models.py`          | `JobSummary`、`Page`、`TaskSummary`、`JobOverview`、`TrialSummary`、`TrialDetail`、`JobShares`                     |
| Hub 复制结果    | `.repos/harbor/src/harbor/hub/copy.py`            | `CopyFailure`、`CopyJobResult`                                                                                     |
| 上传结果        | `.repos/harbor/src/harbor/upload/uploader.py`     | `TrialUploadResult`、`JobStartResult`、`JobUploadResult`                                                           |
| 下载结果        | `.repos/harbor/src/harbor/download/downloader.py` | `JobDownloadResult`、`TrialDownloadResult`                                                                         |
| 发布结果        | `.repos/harbor/src/harbor/publisher/publisher.py` | `PublishResult`、`BatchPublishResult`、`DatasetPublishResult`、`FilePublishResult`                                 |

Viewer 和 Hub DTO 主要包含任务/job/trial 身份、状态、时间、reward、token、cost、分页和对比矩阵字段；它们是展示和远程查询模型，不是任务执行的核心输入协议。

## 本包当前文件路径

本包当前的公开入口和实现文件为：

- `packages/harbor/src/index.ts`：当前包实现入口
- `packages/harbor/src/export.ts`：当前包公开导出入口
- `packages/harbor/src/common/config.ts`、`common/result.ts`：共享配置、结果和基础类型
- `packages/harbor/src/task/config.ts`：任务包 `TaskConfig` 及其嵌套结构
- `packages/harbor/src/job/config.ts`、`job/result.ts`：Job 配置和结果 Schema
- `packages/harbor/src/trial/config.ts`、`trial/result.ts`：Trial 配置和结果 Schema
- `packages/harbor/src/trajectory/`：ATIF 轨迹 Schema 和模块导出
- `packages/harbor/src/dataset/`、`package/`：Dataset Manifest、Registry 和 Package Reference Schema
- `packages/harbor/tests/schema.test.ts`：Job/Trial/ATIF Schema 测试
- `packages/harbor/tests/index.test.ts`：包基础测试
- `packages/harbor/docs/data-structures.md`：本文档

后续实现可继续按 `analyze`、`rewardkit`、`viewer` 和 `hub` 等领域拆分，并在各子模块分别维护内部 `index.ts` 与公开 `export.ts`。
