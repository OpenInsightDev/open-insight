# Onboard

## Grade

- 添加更多内置的 graders；
- 谨慎评审是否有必要支持多 graders；
- 设计流式 grader 该如何支持，包括：
    - 流式 graders 的触发条件（定时触发；用户给定检查命令触发等）；
    - 流式 graders 在事件流中的表达方式；
    - metrics 该如何消费 grading 结果；
    - 流式 graders 真正有价值的使用场景；