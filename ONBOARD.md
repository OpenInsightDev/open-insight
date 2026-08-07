# Onboard

## Grade

- 支持 sandboxed grader
  - transfer 默认先下载到宿主机然后上传到 grader sandbox 里面；对于支持容器网络的 provider 应当提供优化路径，在网络内部进行传输，避免与宿主机之间的下载上传开销；

## Eval

- 强制要求必须在一个 git 仓库中进行评测。
- 支持清理策略：如果没能得到最终 result 而退出则不清理任何中间缓存；得到 result 后根据用户要求决定是否清理。

### Result

- 把目前在 runTrail 里面手动 gather result 替换成通过 event 流来 stream result；

### Persist

- 把 sqlite persist 机制接入到 schedule 运行流程中；

### Trail

- 重新设计 runTrail，不再直接返回 Result 而应该返回 event stream，由外层通过 stream 来构建 result；这样的话可以做到 trail caching 的重放；

## Agent

- 梳理 harness engineering 目前公认的几大模块，将其建模为 effect service；
- 把每个 service 建模为 agent 主循环流程中的 hooks，或者将其视为功能的一部分，从而利用 layer 机制实现功能组装；

## RL

- 应当集成一个 LLM 网关，用于：
    - 统一向用户 agent 提供端点；
    - 用于 intercept 用户 agent 与端点之间的通信，就无须用户编写逻辑提供 trajectory 了；
    - 可以考虑 https://github.com/portkey-ai/gateway
    - 这个概念现在已经有了，叫 realtime RL，可以从这方面入手；
 