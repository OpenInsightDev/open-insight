# @open-insight/rl Dev Documentation

## 项目目标

目前基本上所有 Python RL 框架都有一套自行实现的（非常不成熟的）agent harness 对接接口，这些接口的对接和使用都比较困难。

本项目可以作为一套统一的 agent harness 底座，用于向 RL 框架提供 rollout 和评估功能。

为了实现最大的通用性和跨语言兼容性，本项目预期采用 C/S 架构，服务端（本项目）作为一个本地的 harness server，用于对接 RL 框架的模型推理接口然后向外提供 rollout API，reward API，评估 API 等；
具体的 Python 框架对接则通过为不同的框架编写专门的客户端插件来实现。
