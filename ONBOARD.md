# Onboard

## Agent

- 应当集成一个 LLM 网关，用于：
    - 统一向用户 agent 提供端点；
    - 用于 intercept 用户 agent 与端点之间的通信，就无须用户编写逻辑提供 trajectory 了；
    - 可以考虑 https://github.com/portkey-ai/gateway
    - 这个概念现在已经有了，叫 async RL，可以从这方面入手；
