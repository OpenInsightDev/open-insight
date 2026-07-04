# sandbox-smolmachines

参考 packages/core/src/sandbox/provider/builtin/docker 的实现方式，在当前项目中实现基于 https://www.npmjs.com/package/smolmachines 库的 sandbox provider。

- 对 sandbox 的操作全部使用该库提供的 API 来实现。
- 由于该库的设计基本上没有原生的 snapshot 概念，因此必须采用 启动 machine -> 执行 snapshot 命令 -> 停止 machine 的方式来近似实现 snapshot 的效果。
  - 该库提供了 `fork` API 可用于从一个 forkable 的 machine 衍生出一个新的 machine 实例（参考 https://smolmachines.com/docs/machine），因此可做到类似于 snapshot 的效果。
- 端口映射采用和 Docker 一样的预先映射配置。

详细文档在 https://smolmachines.com/docs/machine。
