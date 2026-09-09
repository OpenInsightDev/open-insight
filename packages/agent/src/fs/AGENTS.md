# WebDAV 能力边界

## 标准 WebDAV 可覆盖

- `GET` 可读取文件内容，对应 `readFile`、`readFileString`。
- `PROPFIND` 可读取 collection 成员及资源属性，对应 `readDirectory` 和有限的 `stat`。
- `PUT` 可整体替换或创建非 collection 资源，对应有限的 `writeFile`、`writeFileString`。
- `MKCOL` 可创建 collection，对应有限的 `makeDirectory`。
- `DELETE` 可删除资源和 collection，对应 `remove`。
- `COPY` 可复制文件和 collection，对应 `copy`、`copyFile`。
- `MOVE` 可移动或重命名文件和 collection，对应 `rename`。
- `HEAD`、`GET` 或 `PROPFIND Depth: 0` 可用于实现有限的 `exists`。
- `PROPFIND` 的 `DAV:resourcetype` 可区分 collection；不能据此得到完整 POSIX 文件类型。
- `DAV:getcontentlength`、`DAV:getetag`、`DAV:getlastmodified`、`DAV:creationdate`、`DAV:getcontenttype` 可提供部分文件元数据。
- `COPY`、`MOVE` 的 `Overwrite` 请求头可表达目标覆盖或不覆盖。
- `LOCK`、`UNLOCK` 是可选能力，不属于所有 WebDAV 资源的必备能力。

## 仅部分覆盖

- `stream` 可通过 HTTP `Range` 读取部分内容；Range 支持不是 WebDAV 核心能力，读取区间不等于文件句柄或 cursor。
- `glob` 可通过 `PROPFIND` 枚举后在客户端匹配；这是客户端组合操作，不是 WebDAV 原生操作。
- `makeDirectory({ recursive: true })` 需要客户端逐级发送 `MKCOL`；`MKCOL` 不会自动创建中间 collection。
- `readDirectory({ recursive: true })` 不能依赖 `Depth: infinity`；服务器只被要求支持 `Depth: 0` 和 `Depth: 1`。
- 递归 `COPY`、`MOVE`、`DELETE` 可能返回 `207 Multi-Status`，并允许部分失败；不能默认视为本地文件系统的原子操作。
- `access` 只能依据 HTTP 身份认证和 WebDAV ACL/服务器授权结果近似实现；WebDAV ACL 不是 POSIX access 检查。
- `stat` 只能映射有限字段。核心 WebDAV 没有统一的 `dev`、`ino`、`nlink`、`uid`、`gid`、`rdev`、`blksize`、`blocks`、`atime`、`birthtime`、POSIX `mode` 语义。
- `File.Info.type` 至少只能可靠区分 collection 与非 collection；不能从核心 WebDAV 得到 block device、character device、FIFO、socket 或 Unix symbolic link 类型。
- RFC 6578 WebDAV Sync 可通过 sync token 获取新增、修改和删除的成员；它是一次请求一次响应的增量同步，不是实时 `watch` 事件流。
- RFC 5842 Binding Extensions 的多个 URI 到同一 WebDAV resource 与 POSIX hard link 相似，但该 RFC 为 Experimental，且不等价于 POSIX inode、`nlink` 或 hard link 语义。

## 标准 WebDAV 不提供

- `open` 返回的有状态远端文件句柄。
- 文件句柄的 `seek`、`read`、`write`、`readAlloc`、`writeAll`、cursor、句柄生命周期和句柄级并发语义。
- `File.sync` 或 POSIX `fsync` 的稳定存储保证。
- 随机写、原地写和追加写。
- `truncate`。
- `OpenFlag` 的完整语义：`r+`、`wx`、`wx+`、`a`、`ax`、`a+`、`ax+` 不能由标准 `PUT` 无
  损表达。
- POSIX `chmod`。
- POSIX `chown` 及 UID/GID 所有权修改。
- POSIX hard link 的完整语义。
- `symlink` 和 `readLink`。
- 服务端 canonical filesystem path，因此不能实现 POSIX `realPath`。
- 远端 `makeTempFile`、`makeTempDirectory` 的原子独占创建语义。
- `makeTempFileScoped`、`makeTempDirectoryScoped` 的服务端资源生命周期和自动清理语义。
- `utimes` 对 `atime`、`mtime` 的标准修改语义。
- 文件或目录的实时变更通知、订阅、事件顺序、断线续传和递归 `watch`。

## 非标准扩展

- 某些服务器提供 HTTP `PATCH` 部分更新或 append 扩展，例如 SabreDAV 的 `application/x-sabredav-partialupdate` 和 `X-Update-Range`；该能力不是 WebDAV 核心标准，必须单独探测并协商。
- 服务器私有属性可以存储 mode、owner、timestamps 等数据，但 dead property 不等于服务器操作系统上的实际文件属性。
- WebDAV Sync、Binding、ACL 等扩展必须通过服务器 capability discovery 确认，不能因服务器支持 WebDAV 就假设支持这些扩展。

## 实现约束

- WebDAV 适配器不能将不支持的语义静默实现为成功。
- 不支持的操作必须返回明确错误，至少包括：文件句柄、`sync`、`truncate`、POSIX 权限/所有权、symbolic link、canonical path 和实时 `watch`。
- 使用本地缓存下载、修改后整体 `PUT` 只能作为明确的弱化语义；它不等价于远端随机写、append、句柄写入或原子更新。
- 使用 `LOCK` 和 `ETag` 只能提供协作锁或乐观并发控制，不能等价于 POSIX 文件锁或文件描述符锁。
