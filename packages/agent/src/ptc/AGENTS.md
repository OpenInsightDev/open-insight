# Programmic Tool Calling

把所有的外部工具接口都建模为 TypeScript SDK，然后要求通过编写 ts 代码来调用这些工具。

- 把所有外部工具建模为 effect toolkit，然后把其中的 json schema 转换为 TypeScript 类型用于生成 dts 文件；
- 添加一个兼容层，当调用 SDK 中的 API 时将请求路由到实际的工具调用上；
- 将如上二者结合起来形成一个完整可运行的 SDK；

## 工具调用环境

工具调用有一个独立的内存文件系统环境，其中包含工具调用 SDK，其中包含 dts 文件，用于作为 agent 的文档。
agent 可以在其中随便写代码文件和运行命令。

- 当 agent 选择运行其中某个脚本时，该脚本首先会被以字符串形式传给 tsgo 进行类型检查和编译，编译后的 js 代码会被送入 node:vm 运行，运行结果返回给 agent；

## 工具审批

默认不提供单个工具的调用权限审批，而是**把一个 ptc 脚本的权限作为一个整体来管理**，参考 [Deno 的权限模型](https://docs.deno.org.cn/runtime/fundamentals/security/) 来控制这个脚本整体能够获取什么权限。

## MCP

由于 mcp 只能运行在 sandbox 内，所以 sandbox 需要开放一个端口用于做所有 mcp 工具的反代；

## Skill

- 简单的拷贝到 sandbox 的 ~/.agents/skills 里面
