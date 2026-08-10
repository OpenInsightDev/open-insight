# AGENTS.md

## 概念

用于做上下文管理的模块。

上下文管理即为对 agent 已有的历史消息（trajectory），上一轮对话中新生成的消息（responding），以及下一轮对话中即将输入的消息（prompting）进行变换。

这一变换过程总是发生在**即将发生下一轮 prompting 之前**。

变换通过 middleware 的形式进行，每个 middleware 都是一个函数，将上述三元组作为输入并返回一个新的三元组。

全部变换完成后，将会把三元组应用于 agent 循环中用于继续下一轮对话：

- 把原来的 trajectory 替换为新的 trajectory；
- 把新的 responding 拼接到 trajectory 的末尾；
- 使用新的 prompting （如果给出）作为下一轮对话的输入。

## 行为

middleware 被允许访问/变更 agent sandbox 内部。

这一设计将允许 middleware 进行高级操作，比如将工具结果作为文本文件写入到 sandbox 的指定位置中，然后返回该文件的路径作为此轮工具调用的结果。
