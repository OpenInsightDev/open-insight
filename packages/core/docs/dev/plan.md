# Sandbox Dev Plan

## Sandbox Enhancement

对比了 Harbor（`.repos/harbor/environments/`）和现有 sandbox 抽象（`packages/core/src/sandbox/`）之后，发现现有设计缺少两个功能：

- **网络策略控制**：Harbor 的 `BaseEnvironment` 支持 `NetworkMode.PUBLIC / NO_NETWORK / ALLOWLIST`，并且能在运行时切换策略（`_phase_network_policies`）。当前 sandbox 只有容器级别的端口映射（`expose`），没有 egress 控制接口。
- **Compose 多服务支持**：Harbor 通过 `service_exec`、`stop_service` 等方法支持 docker-compose 风格的多容器环境。当前 sandbox 是单容器模型。

## Agent 接口设计

目前的 agent 接口将 harness 和 LLM 绑定在了一起，要求用户自行向 harness 提供 LLM 端点。

然而在 RL 场景中 harness 实际上应当由当前的 rollout model 来驱动，而该 model 的接入方式则应当由框架来提供而非用户自行对接。

因此需要增强 agent 接口，使其支持对接指定的 model。
