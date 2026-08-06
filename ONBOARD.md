# Onboard

## Fix

- 在 harness service 里面把镜像构建阶段暴露出来；
- 在 Task.make 里面把 stage options 添加进去；

## Harness

- 把现在的 agent/ 直接改名叫 harness/；
- Sandbox 不应该独立提供，而应该由 harness/ 来决定如何提供。
  - 对于一个通用 harness 可以要求由用户来提供 sandbox layer；
  - 对于一个对环境有要求的 harness 则应当在内部提供 layer，而要求用户在外部提供构建专用 sandbox 所需的参数/layer等；
  - eval 层反而不用动，由 harness 层统一提供对 Agent 和 Sandbox 的 layer。对于这种需求可以使用 `Layer.provideMerge`。

## Agent

- 梳理 harness engineering 目前公认的几大模块，将其建模为 effect service；
- 把每个 service 建模为 agent 主循环流程中的 hooks，或者将其视为功能的一部分，从而利用 layer 机制实现功能组装；

## RL

- 应当集成一个 LLM 网关，用于：
    - 统一向用户 agent 提供端点；
    - 用于 intercept 用户 agent 与端点之间的通信，就无须用户编写逻辑提供 trajectory 了；
    - 可以考虑 https://github.com/portkey-ai/gateway
    - 这个概念现在已经有了，叫 realtime RL，可以从这方面入手；
 