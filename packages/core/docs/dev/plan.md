# Sandbox: 下一步 — 网络策略控制与 Compose 支持

## 起因

对比了 Harbor（`.repos/harbor/environments/`）和现有 sandbox 抽象（`packages/core/src/sandbox/`）之后，发现现有设计缺少两个功能：

- **网络策略控制**：Harbor 的 `BaseEnvironment` 支持 `NetworkMode.PUBLIC / NO_NETWORK / ALLOWLIST`，并且能在运行时切换策略（`_phase_network_policies`）。当前 sandbox 只有容器级别的端口映射（`expose`），没有 egress 控制接口。
- **Compose 多服务支持**：Harbor 通过 `service_exec`、`stop_service` 等方法支持 docker-compose 风格的多容器环境。当前 sandbox 是单容器模型。
