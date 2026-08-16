# AGENTS.md

## 存储

持久化存储以 trail 作为基本单位，一个被持久化存储的 trail stream 总是完整成功结束的 stream。

在此基础上，task 存储包含 start 和 end 两个存储，以及指向若干 trails 的外键。
若 start 存在则说明该 task 已经开始执行；
若 end 存在则说明该 task 已经执行完成，此时则可以按照 start -> ...trails -> end 的顺序来重放该 task 的执行过程。
因此，一个 task 是否可以完全重放取决于其 end 是否已经存在；若存在则完全无须实际运行即可完整重放，否则则应当实际运行，但运行过程中可以加载之前存储过的成功 trails。

对于 bench 也是类似，根据 end 决定是否可以完全重放，若不能则实际运行并在过程中加载成功 tasks。

## Result 构造
