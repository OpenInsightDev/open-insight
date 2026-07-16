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

- 支持多 graders 的 task
    - 如果已经有多 graders task 的话是不是就不用设计流式 grader 了，而是按照阶段来触发 grading？
    - 即使是多阶段，如何自动出发 graders 仍然是个问题。但好在框架把 sandbox 的交互限制在了一个固定的工具集之内，所以可以通过拦截 $, cmd 和 writeFile 这几个工具来触发 grading，比如：要求所有 graders 都必须提供一个触发条件（执行某个命令成功、某个文件被更新等）；然后每次 sandbox 执行 mutation 操作的时候都全部执行一遍这些条件来判断此时该触发哪些 graders 了。
- 支持多阶段 task
    - 按照目前 harbor 的设计，多 grader 和多 grading 似乎是不同的概念，因为多阶段可以每个阶段对应不同的环境。

### Renew

- 多 grader task 这个思路从一开始就是错的：
    - 最终的 grader 无论如何都会拿到完整的 trajectory，其中包含了整个步骤的所有所需信息，根本就没有必要 on the fly 的去触发 grading；
    - 在运行过程中实时 grading 的需求是确实存在的，但其实不应该被归纳到 grading 的范畴（也即，得到最终评估结果），而应该是一种 metrics 才对；
    - 不同 task 的 on the fly grading 需求可能是不同的，所以应当允许在定义 task 的时候给出 task specific 的 metrics；

## Agent

- 应当集成一个 LLM 网关，用于：
    - 统一向用户 agent 提供端点；
    - 用于 intercept 用户 agent 与端点之间的通信，就无须用户编写逻辑提供 trajectory 了；
    - 可以考虑 https://github.com/portkey-ai/gateway