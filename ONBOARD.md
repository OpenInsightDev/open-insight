# Onboard

## Grade

- 添加更多内置的 graders；
- 谨慎评审是否有必要支持多 graders；
- 设计流式 grader 该如何支持，包括：
    - 流式 graders 的触发条件（定时触发；用户给定检查命令触发等）；
    - 流式 graders 在事件流中的表达方式；
    - metrics 该如何消费 grading 结果；
    - 流式 graders 真正有价值的使用场景；

## Task

- 支持多阶段 task
    - 如果已经有多阶段 task 的话是不是就不用设计流式 grader 了，而是按照阶段来触发 grading？

## Agent

- 应当集成一个 LLM 网关，用于：
    - 统一向用户 agent 提供端点；
    - 用于 intercept 用户 agent 与端点之间的通信，就无须用户编写逻辑提供 trajectory 了；
    - 可以考虑 https://github.com/portkey-ai/gateway