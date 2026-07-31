---
name: open-insight-eval
description: Use when working with the @open-insight/eval package — creating evaluation harnesses, benchmarks, tasks, metrics, and grades for Open Insight agents, and integrating them with Harbor and CI.
---

# @open-insight/eval guidelines

安装 Deno:

```bash
curl -fsSL https://deno.land/install.sh | sh
```

新建项目，安装必要依赖，并将 `benchmarks/` 添加为工作区目录：

```bash
deno init my-harness && cd my-harness
mkdir -p benchmarks
deno add effect@beta @open-insight/core @open-insight/eval
# 可选：常用的辅助库
deno add @std/path @std/fs @effect/platform-node@beta
```

## Resources

项目主页：<https://github.com/OpenInsightDev>
