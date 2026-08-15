import { pipe, Effect } from "effect"

// 构造一个 Effect，用两种形式做完全相同的变换
const f = (n: number) => n + 1
const g = (n: number) => n * 2
const h = (n: number) => n - 3

// 形式 A：方法链式 .pipe
const viaMethod = Effect.succeed(5).pipe(Effect.map(f), Effect.map(g), Effect.map(h))

// 形式 B：独立函数 pipe(effect, ...)
const viaFunction = pipe(
  Effect.succeed(5),
  Effect.map(f),
  Effect.map(g),
  Effect.map(h)
)

const a = Effect.runSync(viaMethod)
const b = Effect.runSync(viaFunction)

console.log("viaMethod.pipe  :", a)
console.log("pipe(effect,...) :", b)
console.log("相等 ?", a === b)

// 再验证普通数值 + 纯函数
const numA = pipe(5, f, g, h)
const numB = (5 as number).pipe ? (5 as unknown as { pipe(...args: any[]): number }).pipe(f, g, h) : NaN
console.log("\n纯函数 pipe(5,f,g,h):", numA)
console.log("预期等价结果      :", h(g(f(5))))

// 反面：直接把值去掉，写成 pipe(f,g,h)，f 会被当成"值"
console.log("\n[反面示例] pipe(f,g,h)，其中 f 是函数:")
const wrong = pipe(f, g, h) // f 作为初始值，g 应用在 f 上 => g(f)= (5+1)*2? 不，是 f 被 g 调用
console.log("结果:", wrong, " 类型:", typeof wrong)
