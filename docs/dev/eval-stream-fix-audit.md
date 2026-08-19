# Eval Stream 修复审计记录

## 1. 审计结论

> **当前版本复核（2026-08-19）**：以下结论以当前工作树和重新运行的测试为准，
> 不再沿用 2026-08-18 的失败快照。定向命令
> `cd packages/eval && vp test src/eval/stream.test.ts tests/stream.e2e.test.ts --run`
> 结果为 **2 个文件、31 个测试全部通过**。

当前复核确认：

- 结果聚合、独立 metric fan-out、稳定排序、FiberSet 取消、配置校验和持久化终止路径均已由实现与测试覆盖。
- response parts 在响应流完成前即可通过 `Eval.stream` 观察到；新增阻塞 response 回归测试保护这一实时性契约。
- 当前事件 schema 将 usage 保留在 `SessionEndEvent`、`SessionResult` 和公开结果中，`TrailEndEvent` 本身没有 usage 字段；这与当前 schema 设计一致，不能把 TrailEndEvent 当作 usage 载体。
- `packages/eval/tests/verilog-eval.test.ts` 仍是用户整文件注释的空测试文件，因此全包 Vitest 若包含它会报告 `No test suite found`；它不属于本次定向验证范围。

本次审计以 `packages/eval/src/eval/stream.ts` 为核心，覆盖公开 API、结果聚合、事件生命周期、重试、metric 广播、并发、取消、持久化和边界输入。

最终结果：

- 新增 27 条单元测试和 4 条公开 API 端到端测试，定向测试 `31/31` 通过。
- F01-F16 的主路径均已解决或由当前 schema/公开 API 契约明确绕过；`stream.ts` 没有剩余的已知行为缺口。
- `vp check --no-fmt --no-lint` 在 `packages/eval` 为 `0 errors`，但保留 8 条既有 lint/type warnings；完整 `vp check` 和 `packages/core` 检查仍受仓库其他未改模块的既有问题影响。
- 包构建和全包测试结果以本次复核命令输出为准，未将基线失败伪装成通过；`git diff --check` 通过。
- 全包测试唯一失败来自用户已整文件注释的 `packages/eval/tests/verilog-eval.test.ts`，Vitest 报告 `No test suite found`。该文件不属于本次修复，也未被恢复或改写。

审计日期：2026-08-19。

## 2. 范围与边界

### 2.1 本次修改文件

| 文件 | 审计用途 |
| --- | --- |
| `packages/eval/src/eval/stream.ts` | 核心 stream 生命周期、并发、聚合、metric 和持久化修复 |
| `packages/eval/src/eval/index.ts` | 公开 `Eval.make`、`Eval.stream`、`Eval.result` 的终止信号和结果类型 |
| `packages/eval/src/event/result.ts` | 新增专用 `ResultDone<A>` 终止信号 |
| `packages/eval/src/event/persist/service.ts` | 持久化 replay stream 的结果信号类型同步 |
| `packages/eval/src/grade/index.ts` | 强制执行 grader schema decode effect |
| `packages/eval/src/metric/bench/index.ts` | bench metric 使用包含当前 delta 的累计结果和正确的 task-result 类型 |
| `packages/eval/src/task/build.ts` | 新增 `Task.GradeTypeOf<T>`，区分 Schema 与解码后的值类型 |
| `packages/eval/src/eval/stream.test.ts` | 27 条单元测试 |
| `packages/eval/tests/stream.e2e.test.ts` | 4 条基于 `@open-insight/eval` 导出的端到端测试 |
| `packages/eval/src/metric/task/index.ts` | task metric 使用聚合 TrailResult 类型 |
| `packages/eval/src/event/schema.ts` | 移除未使用的 Chart 依赖 |
| `packages/core/src/agent/service.ts` | 多轮 trajectory 保留历史响应 |
| `skills/open-insight-eval/references/run-eval.md` | 同步当前公开 API 文档 |

### 2.2 明确未修改的范围

- `packages/acp-agent` 是用户已有工作区改动，不属于本次任务。
- `packages/eval/tests/verilog-eval.test.ts` 是用户已有改动，当前整文件被注释；本次没有恢复、删除或编辑该文件。
- 本次没有修改持久化数据库 schema 或 Harness 实现；Agent service 仅补充多轮 trajectory 的历史累积，保持现有 provider 契约不变。

## 3. 预期行为契约

修复后的评估流遵循以下契约：

1. 每一级生命周期都按 `Start -> active events/metrics -> End -> internal result` 完成。
2. `EndEvent` 表示该层所有正常工作和 metric 已成功完成；metric 失败时不能先发出对应的 `EndEvent`。
3. 内部聚合结果通过专用的 `ResultDone<A>` 传递，不与 Effect 或 Stream 自身的终止语义混用。
4. `Eval.stream` 返回完整事件序列并隐藏内部结果信号；`Eval.result` 返回类型正确的 `BenchResult`，并保留真实评估错误。
5. `continue` retry 复用同一个 Agent session；`restart` retry 创建新 Agent session。两者都创建新的逻辑 `sessionIdx`，并聚合所有 session 结果。
6. 每个 metric 必须看到自己的完整输入副本；metric 之间不能竞争消费 Queue 或 PubSub 中的单份结果。
7. 并发完成顺序只影响实时事件到达顺序，不影响最终 `TaskResult.trails` 的 `trailIdx` 顺序。
8. 动态 prompt 的下一次计算必须看到上一轮响应已提交后的最新 trajectory。
9. 取消评估必须中断仍在运行的 trail，不得因 finalizer 等待活动 fiber 而永久挂起。
10. 持久化 sink 在成功和失败路径都必须收到明确终止信号；调用方在返回结果或错误前必须等待 sink 完成。
11. `trailConcurrency` 和 `snapshotConcurrency` 只接受正的安全整数；`trailCount` 接受安全整数，零或负数表示空 trail 集合，非整数、非有限数和超出安全整数范围的值产生 `BenchErrorEvent`。
12. 空 benchmark 和零 trail task 都必须正常完成，不能制造虚假的 task/trail 结果或使用非法的 merge concurrency。

## 4. 修复明细

### F01. 独立结果终止信号

原问题：聚合结果使用 `Cause.Done<A>` 通过 stream error channel 传递。`Cause.Done` 同时是 Effect 内部终止概念，把它放进 `Stream.fromEffect` 会与 Stream 的终止处理发生语义冲突，结果 payload 可能被当作普通流结束而被吞掉。

修复：

- 在 `packages/eval/src/event/result.ts:6` 新增 `ResultDone<A>` tagged error 和 `resultDone(value)` 构造器。
- Session、Trail、Task、Bench 都改用 `Event.resultDone(...)` 发出内部结果。
- 所有聚合层改用 `Stream.catchTag("ResultDone", ...)` 捕获并向上聚合。
- `packages/eval/src/event/persist/service.ts:6` 同步 replay stream 的结果信号类型。

影响：结果 payload 不再依赖 Effect 内部 `Cause.Done` 的特殊语义，`Eval.result` 能稳定取得完整 `BenchResult`。

测试证据：

- `stream.test.ts:145` 验证完整生命周期和四级结果聚合。
- `stream.e2e.test.ts:89` 从公开 API 验证 `Eval.run`、`Eval.stream` 和 `Eval.result`。

### F02. 公开 API 和结果泛型修正

原问题：`Eval.result` 的返回泛型使用 `Task.GradeOf<T>`，该类型是 grade Schema，而实际结果应携带 Schema 解码后的 `Type`。公开 API 同时仍捕获旧的 `Done` 信号。

修复：

- `packages/eval/src/task/build.ts:42` 新增 `Task.GradeTypeOf<T> = GradeOf<T>["Type"]`。
- `packages/eval/src/eval/index.ts:10` 的 `EventStream`、`make` 和 `result` 改为 `ResultDone<BenchResult<GradeTypeOf<T>>>`。
- `Eval.stream` 仅过滤 `ResultDone`，其他错误仍转换成相应事件。
- `Eval.result` 捕获 `ResultDone` 返回值，并将评估失败映射回 `EvalError`。

影响：公开 API 的运行时行为和 TypeScript 类型一致。

测试证据：4 条 E2E 都只通过 `@open-insight/eval` 公开导出构建和消费评估。

### F03. Session/Trail 生命周期和 usage/finish reason

原问题：Trail 缺少 start 事件，Session finish reason 与 usage 没有可靠传播到 SessionEndEvent 和结果，生命周期不完整。

修复：

- `packages/eval/src/eval/stream.ts:40` 用 Ref 记录最后的 response usage 和 finish reason。
- `stream.ts:120` 明确构造 `SessionStartEvent`、`SessionEndEvent` 和 `SessionResult`。
- `stream.ts:217` 保存最后一个成功 session 的 usage。
- `stream.ts:273` 补发 `TrailStartEvent`。
- `stream.ts:300` 在 trail 的 active stream 完成后，根据聚合结果发出 `TrailEndEvent`，随后才发出内部结果。

当前 `TrailEndEvent` schema 没有 usage 字段，因此 usage 的公开事件载体是 `SessionEndEvent`，聚合结果载体是 `SessionResult`；TrailEndEvent 只携带 grade 和生命周期信息。

影响：成功路径的标准事件顺序为：

```text
BenchStart
  TaskStart
    TrailStart
      SessionStart -> Prompt/Stream/Metric -> SessionEnd
    TrailMetric -> TrailEnd
  TaskMetric -> TaskEnd
BenchMetric -> BenchEnd
```

同层 metric 可以与 active events 交错，但不会晚于该层 EndEvent。

测试证据：`stream.test.ts:145` 和 `stream.e2e.test.ts:89` 精确断言事件 tag 顺序、usage、finish reason、grade 和 session 数量。

### F04. `continue` 与 `restart` retry

原问题：retry 分支没有同时保证 Agent session 语义、逻辑 session 编号和多 session 结果聚合。

修复：

- `stream.ts:261` 为 retry 构建独立的下一 attempt。
- `continue` 使用当前 `session`；`restart` 调用 `sbxSession.runAgent()` 创建新 session。
- 每次 retry 都递增 `sessionIdx`，发出 `SessionRetryEvent`，并把每个 `SessionResult` 放入聚合 Queue。
- Trail grade 成功后结束 Queue 并构造包含全部 sessions 的 `TrailResult`。

测试证据：

- `stream.test.ts:230` 验证 continue 的 provider session 序列为 `[0, 0]`，逻辑 `sessionIdx` 为 `[0, 1]`。
- `stream.test.ts:274` 验证 restart 的 provider session 序列为 `[0, 1]`。
- 两个测试都断言最终 trail 含 2 个 session 且 grade 正确。

### F05. 动态 prompt 必须等待上一轮响应提交 trajectory

原问题：旧实现先把 prompt 映射为包含 stream 的普通值，再分别 flatten 事件和 delta。外层 prompt stream 可能在当前响应消费完成前拉取下一 prompt，因此动态 prompt 会读到旧 trajectory，甚至无限生成 turn；另一条回归风险是先 `runCollect` 响应后才发出事件，破坏实时 stream。

修复：

- `stream.ts:60` 逐个消费当前 response stream，同时把原始 parts tap 到事件 Queue；因此首个 response part 可以在 stream 完成前发出。
- 有 trajectory metric 时，响应同时经过 `Response.fold` 生成 metric delta，并复制到每个独立 delta Queue。
- 当前 turn 完整消费并由 Agent finalizer 提交 trajectory 后，才调用下一次 prompt function；不会提前拉取下一轮。

项目源码依据：

- `packages/core/src/prompt/service.ts:36` 明确每次生成 prompt 都读取传入的最新 trajectory。
- `packages/core/src/agent/service.ts:55` 在 response stream 结束时把 prompt + response 提交到 history Ref。

Effect 源码依据：

- `node_modules/effect/src/Stream.ts:2668` 的 `flatMap` 文档说明默认 concurrency 为顺序拼接 inner streams。
- `node_modules/effect/src/Stream.ts:3836` 的 `merge` 文档说明默认在两侧都结束后才结束。

测试证据：

- `stream.test.ts:329` 覆盖多轮 prompt，观察到 trajectory 长度按 `[2, 4]` 增长。
- `stream.test.ts:371` 覆盖 async prompt function，并分别在 0、1、2 个 trajectory metric 下断言下一次 pull 看到 `[0, 2]`，且只产生一轮 prompt。
- `stream.test.ts:215` 让 provider 在首个 response part 后阻塞，断言公开 `Eval.stream` 能先取得首个 `SessionStreamEvent`。

### F06. trajectory metric 广播分支和 fan-out

原问题：固定创建 event 与 metric 两个 turn 广播分支。当 `trajMetrics.length === 0` 时，metric 分支无人消费；unbounded broadcast 会持续保留上游数据。多个 metric 也没有各自独立的完整输入分支。

修复：

- `stream.ts:43` 为每个 trajectory metric 创建独立 delta Queue；响应 parts 先进入事件 Queue，再把折叠后的 delta 复制给所有 metric Queue。
- 零 metric 时直接消费 response stream，不创建无人消费的 metric 分支。

Effect 源码中的 `broadcastN` 订阅语义仍作为历史风险依据，但当前实现不再依赖它来完成 trajectory fan-out。

测试证据：

- `stream.test.ts:371` 同时覆盖 0、1、2 个 metric。
- `stream.test.ts:425` 断言两个 metric 都收到完整的 `["prompt", "response"]` delta 序列。

### F07. Task/Bench metric 独立 Queue fan-out

原问题：Task 和 Bench 的多个 metric 共享单一消费源，可能竞争消费完成结果；订阅建立时序也可能让较晚的消费者丢失结果。

修复：

- `stream.ts:367` 为 Task 结果收集器和每个 task metric 各建一个 Queue。
- 每个完成的 trail 被复制到全部 Queue；所有 trail fiber 完成后统一 end Queue。
- `stream.ts:493` 对 Bench 采用同样的独立 Queue 结构，每个完成 task 被复制给结果收集器和每个 bench metric。
- Queue 在 producer 完成后才 end，消费者可以先排空缓冲结果再正常结束。

影响：任何数量的 metric 都能看到相同的完整结果集合，不受启动时序和其他 metric 消费速度影响。

测试证据：

- `stream.test.ts:830` 覆盖 3 个并发 trail、task metric 和 bench metric 的完整聚合。
- `stream.test.ts:876` 覆盖多个 task/bench metric，断言每个 metric 都得到全部结果。
- `stream.e2e.test.ts:118` 覆盖 2 tasks x 2 trails 的公开 API 聚合。

### F08. Bench metric 累计状态包含当前 delta

原问题：`Metric.Bench.makeStream` 调用 metric exec 时传入旧 `results`，当前 task delta 只在下一轮才可见，导致首次结果缺失和累计值滞后一项。

修复：`packages/eval/src/metric/bench/index.ts:58` 先构造 `nextResults`，再把它传入 `exec` 并保存为下一状态。

测试证据：`stream.test.ts:830` 和 `stream.test.ts:876` 断言 bench metric 首次及最终累计 task 数量正确。

### F09. 并发 trail 的最终顺序稳定

原问题：结果按并发完成顺序写入，慢速低 index trail 可能出现在快速高 index trail 之后，最终结果不确定。

修复：

- 每个结果以 `[trailIdx, TrailResult]` 入 Queue。
- `stream.ts:450` 在构造 `TaskResult` 前按 `trailIdx` 升序排序并移除 index。

测试证据：`stream.test.ts:917` 人为让 trail 1 先完成，仍断言最终结果按 trail 0、trail 1 排列。

### F10. 取消 active trail 不再挂起

原问题：`FiberSet.make()` 已经注册 scope-close 中断 finalizer，旧代码又用 `Effect.acquireRelease(..., FiberSet.awaitEmpty)` 包裹它。由于 finalizer 后进先出，外层 `awaitEmpty` 可能先等待永不自行结束的 fiber，导致真正负责中断的 FiberSet finalizer无法执行。

修复：

- `stream.ts:394` 直接使用 `FiberSet.make()`。
- `stream.ts:434` 仅 fork 一个正常完成路径的 watcher：等待全部 trail fiber 后关闭事件和结果 Queue。
- scope 被取消时仍由 FiberSet 自身 finalizer 中断活动 fibers，不再用 finalizer 等待它们自然结束。

Effect 源码依据：

- `node_modules/effect/src/FiberSet.ts:154` 到 `167` 显示 `FiberSet.make` 已通过 `acquireRelease` 在 scope close 时调用 `Fiber.interruptAll`。
- `node_modules/effect/src/FiberSet.ts:920` 到 `925` 显示 `awaitEmpty` 在 set 仍 open 且有活动 fiber 时持续等待。

测试证据：`stream.test.ts:185` 启动一个不会自行完成的 response，随后取消评估，并要求 interrupt、fiber 结束和 response finalizer 都在 timeout 内完成。该竞态测试曾连续重复 10 轮通过。

### F11. Metric 必须在对应 EndEvent 前完成

原问题：Session、Task、Bench 的旧结构先把 EndEvent 拼到主分支，再与 metric stream merge；慢速或失败 metric 因此可能在 EndEvent 之后产生值或错误。Trail scheduler metric 也存在同类问题。持久化层把 EndEvent 视为“已完整完成”，所以这种顺序会把最终失败短暂或永久标记成成功。

修复：

- Session 在 `stream.ts:151` 合并 turn events 与 trajectory metrics，active stream 完成后才 concat `SessionEndEvent`。
- Trail 在 `stream.ts:305` 合并 attempts 与 scheduler metrics，完成后才构造 `TrailEndEvent`。
- Task 在 `stream.ts:473` 合并 trail events 与 task metrics，完成后才 concat `TaskEndEvent`。
- Bench 在 `stream.ts:609` 合并 task events 与 bench metrics，完成后才 concat `BenchEndEvent`。
- metric 失败会在 EndEvent 前终止该层并映射为相应错误事件。

持久化契约依据：`packages/eval/src/event/persist/builtin/sqlite/schema.ts:34` 和 `:44` 明确 `endedAt` 存在代表 fully completed。

测试证据：

- `stream.test.ts:410` 为四级 metric 加入延迟，逐级断言 metric event 位于对应 EndEvent 之前。
- `stream.test.ts:485`、`:515`、`:540`、`:562` 断言 scheduler/task/trajectory/bench metric 失败产生正确的 typed error，且不会先出现对应 EndEvent。
- 延迟 metric 与取消竞态用例曾连续重复 10 轮通过。

### F12. Scheduler metric 错误映射

原问题：scheduler metric 的 `MetricError` 没有稳定穿过 Trail 层的 `EvalError.metric` 映射，可能逃逸为错误类型不一致的 stream failure。

修复：`stream.ts:201` 对每个 scheduler metric stream 统一 `Stream.mapError(EvalError.metric)`；Trail 外层再把 `EvalError` 转成 `TrailErrorEvent`。

测试证据：

- `stream.test.ts:467` 验证 scheduler metric 在 active trail 期间运行并发出事件。
- `stream.test.ts:485` 验证失败映射为 `TrailErrorEvent`/`MetricError`，并且没有 `TrailEndEvent`。

### F13. 边界配置和空输入

原问题：

- 非法 concurrency 可能让 Semaphore 卡死或行为未定义。
- fractional、`NaN`、`Infinity` 或超大 `trailCount` 可能被截断、静默变零或触发未映射的 `RangeError`。
- `Array.range` 不适合表达负数/零 trail 语义。
- 空 benchmark 使用 `Stream.mergeAll(..., { concurrency: 0 })` 有 defect 风险。

修复：

- `stream.ts:495` 校验两个 concurrency 必须是大于等于 1 的安全整数。
- `stream.ts:505` 校验 `trailCount` 必须是安全整数；零和负数保留为空集合语义。
- `stream.ts:406` 使用普通 `for` 循环，`trailCount <= 0` 自然启动零个 trail。
- `stream.ts:549` 对空 tasks 直接使用 `Stream.empty`，不调用零 concurrency 的 `mergeAll`。
- 初始化失败统一映射为 `BenchErrorEvent`，reason 为 `InitFailed`。

测试证据：

- `stream.test.ts:919` 验证 `trailCount: 0`。
- `stream.test.ts:931` 验证负数 trail count。
- `stream.test.ts:942` 覆盖 0/负 concurrency、fractional、`NaN`、`Infinity` 和超出 safe integer 范围的输入，并用 timeout 防止挂起。
- `stream.test.ts:972` 验证空 benchmark 只发 `BenchStartEvent`、`BenchEndEvent`，结果为 `{ tasks: {} }`。

### F14. 持久化 replay、tee 和 sink 完成语义

原问题：

- replay 路径和新 `ResultDone` 类型不一致。
- 使用 broadcast 同时驱动主消费者和持久化 sink 时，error-channel 终止信号可能形成循环等待。
- sink 失败可能未映射为 `BenchErrorEvent`，或主结果在 sink 完成前返回。
- 评估本身失败时，也必须等待 sink 处理终止信号，不能提前退出。

修复：

- Bench/Task/Trail 开始执行前先查找可 replay 的已持久化 stream，并统一映射 `EventError`。
- `stream.ts:617` 使用独立 Queue tee：主 stream 的每个事件先 offer 给 sink Queue。
- 成功路径 `Queue.end` 后 join sink fiber；失败路径 `Queue.fail` 后同样 join sink fiber，再传播原错误。
- sink 自身的 `EventError` 映射为 eval event error，最终形成 `BenchErrorEvent`。

测试证据：

- `stream.test.ts:608` 验证完整 bench replay 不启动 worker。
- `stream.test.ts:637` 验证已持久化 trail replay 仍参与 task/bench 聚合。
- `stream.test.ts:697` 验证 sink 失败产生 bench error。
- `stream.test.ts:724` 验证所有事件被持久化，且 `Eval.result` 等待 sink 完成。
- `stream.test.ts:760` 验证评估失败时仍等待持久化失败处理完成。

### F15. Grader schema decode 必须真正执行

原问题：三个 grader variant 返回 `decodeResult(schema, result)`，但在 generator 中没有 `yield*`，因此返回的是未执行的 Effect；无效 payload 不会在期望位置被 schema 拒绝。

修复：`packages/eval/src/grade/index.ts:91`、`:112`、`:136` 均改为 `return yield* decodeResult(schema, result)`。

测试证据：`stream.e2e.test.ts:171` 从公开 API 输入 `{ score: "not-a-number" }`，断言得到 `TrailErrorEvent -> GradeError -> InvalidResult`。

### F16. 对外运行文档同步

原问题：skill 文档仍描述旧的 `Eval.make(...).pipe(Eval.run)` 和 `Cause.Done` 语义，与当前 API 不一致。

修复：`skills/open-insight-eval/references/run-eval.md` 更新为：

```ts
const result = yield* Eval.run(bench).pipe(Eval.result)
const events = yield* Eval.run(bench).pipe(Eval.stream, Stream.runCollect)
```

并说明内部终止信号为 `ResultDone<BenchResult>`。

## 5. 测试计划与覆盖结果

### 5.1 单元测试矩阵

| 类别 | 用例数 | 已验证行为 |
| --- | ---: | --- |
| 成功生命周期与聚合 | 1 | 全事件顺序、usage、finish reason、四级结果 |
| 取消与资源释放 | 1 | 活动 response/trail 被及时中断，无 finalizer deadlock |
| response 实时性 | 1 | 首个 response part 在完整 response 结束前可见 |
| retry | 2 | continue 复用 session、restart 新建 session、session 聚合 |
| prompt/trajectory | 3 | multi-turn、最新 trajectory、0/1/2 metric、完整 fan-out |
| metric 时序与正常执行 | 2 | 四级延迟 metric 均早于 EndEvent，scheduler active execution |
| typed error 映射 | 5 | scheduler/task/trajectory/bench metric 与 prompt generation 错误 |
| 持久化 | 5 | bench replay、trail replay、sink 失败、成功等待、失败等待 |
| 并发聚合与 metric fan-out | 3 | 多 trail、多个 metric、结果不丢失、trail 顺序稳定 |
| 边界输入 | 4 | 零/负 trail、非法数字、空 benchmark |
| 合计 | 27 | 全部通过 |

### 5.2 端到端测试矩阵

| 用例 | 验证内容 |
| --- | --- |
| 完整公开 API 运行 | `Eval.run`、`Eval.stream`、`Eval.result` 的事件与结果 |
| 多 task、多 trail | 2 tasks x 2 trails 的事件数量、ID 和结果聚合 |
| grader 执行失败 | 公开 API 中 typed failure event 和 `Eval.result` failure |
| grader schema 无效 | 不可信 payload 被声明的 Schema 拒绝 |

### 5.3 验证命令与结果

所有 `vp test` 命令均从 `packages/eval` 目录运行。

```bash
vp test --run src/eval/stream.test.ts tests/stream.e2e.test.ts
```

结果：2 个 test files 通过，31/31 tests 通过。

```bash
vp check --no-fmt src/eval/stream.ts src/eval/stream.test.ts tests/stream.e2e.test.ts
```

结果：0 errors，7 warnings。warnings 为 `stream.ts` 中的 `no-misused-spread`/`unbound-method` 以及 SSE encoder 的既有提示，不影响本次行为验证。

```bash
vp check --no-fmt
```

结果：91 个文件检查完成，0 errors，23 warnings。warnings 来自空占位模块、未实现的既有模块和用户已注释文件等基线项。

```bash
cd packages/eval && vp run build
```

结果：通过。`packages/core` 的 `vp run build` 仍因其既有 `agent/export.ts` 引用未导出的 `makeAsync`/`layerFromAsync` 失败，与本次 trajectory 修复无关。

```bash
git diff --check
```

结果：通过，没有 whitespace error。

完整包测试：

```bash
vp test --run
```

目标新增测试全部通过；唯一失败为：

```text
packages/eval/tests/verilog-eval.test.ts
No test suite found
```

该文件在任务开始前已被用户整文件注释，因此这不是 `stream.ts` 修复引入的回归。本次按照工作区保护规则保留原状。

## 6. 源码依据索引

所有 Effect 行为结论均来自当前工作区安装版本 `effect@4.0.0-rc.110` 的本地源码，而非凭记忆推断。

| 结论 | 源码落点 |
| --- | --- |
| `Stream.flatMap` 默认顺序执行 inner streams | `node_modules/effect/src/Stream.ts:2644`, `:2668` |
| `Stream.merge` 默认等待两侧结束 | `node_modules/effect/src/Stream.ts:3814`, `:3836` |
| `broadcastN` 创建全部订阅并立即 fork producer | `node_modules/effect/src/Stream.ts:15096` 到 `:15110` |
| `FiberSet.make` 自带 scope-close interrupt finalizer | `node_modules/effect/src/FiberSet.ts:154` 到 `:167` |
| `FiberSet.awaitEmpty` 在 open 且非空时等待 | `node_modules/effect/src/FiberSet.ts:920` 到 `:925` |
| 每次 prompt pull 读取最新 trajectory | `packages/core/src/prompt/service.ts:36` 到 `:43` |
| Agent 在 response stream 结束时提交 trajectory | `packages/core/src/agent/service.ts:55` 到 `:64` |
| 持久化 End 状态代表 fully completed | `packages/eval/src/event/persist/builtin/sqlite/schema.ts:34`, `:44` |

## 7. 剩余风险

当前没有已知的目标行为失败。剩余风险主要来自测试环境边界：

- 单元和 E2E 使用内存中的 fake Harness、Agent、Sandbox；真实 provider 的网络、进程和外部存储故障不在本文件测试范围内。
- unbounded Queue 是现有吞吐策略。本次消除了无人消费分支和竞争消费，但没有引入全局背压或内存上限；极端生产负载的容量策略需要单独的性能/压力测试。
- `packages/eval` 包级 23 个 warnings 仍存在，但检查结果为 0 errors；warnings 不属于本次 stream 行为修复范围。
- `packages/core` 的静态检查和构建仍受既有 Agent API 导出不一致影响；core 的 32 条既有测试仍全部通过。
- 完整包测试在用户注释的 `verilog-eval.test.ts` 上无法达到全绿。恢复该用户文件或调整其测试发现策略后，才能把“全包测试全部通过”作为独立结论。

## 8. 审计判定

依据 31 条定向自动化测试、实时性回归验证、类型/静态检查、eval 包构建和本地 Effect 源码核对，本次列出的 16 组修复均有对应实现与回归测试。除明确记录的工作区基线问题外，`packages/eval/src/eval/stream.ts` 的预期行为已满足本次测试计划。
