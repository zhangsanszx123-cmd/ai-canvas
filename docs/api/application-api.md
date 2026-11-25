# 应用服务端接口

本文件为首版实现约定，接口已实现于 Next.js 路由。请求统一使用同源 `/api/`，验证会话与资源所有权，服务端以 Node.js 运行环境访问 `pg`。原始图片通过 `/api/assets/{id}/content` 权限校验后重定向至短时签名 URL，下载使用 `?download=1`。

| 方法与路径 | 用途 |
| --- | --- |
| `GET/POST /api/auth/[...all]` | Better Auth 处理自主注册、登录、会话及密码重置；注册无需邮件验证，自动建立会话。账号和会话存 PostgreSQL，子路径由库管理。 |
| `GET/POST /api/skills` | 需登录，列出当前账号技能或导入 SKILL.md；账号技能跨项目复用，不能读取其他账号技能。 |
| `GET/DELETE /api/skills/{id}` | 需登录，读取当前账号技能完整规则或删除账号技能；已有对话快照保留。 |
| `GET/POST /api/projects/{id}/skills` | 列出本项目及当前账号技能（scope=project/account）；POST 继续导入为本项目技能。 |
| `POST /api/projects/{id}/skills/{skillId}/library` | 将本项目技能复制到账号库，保留原项目记录；已存在同名账号技能返回 409，不覆盖。 |
| `POST /api/projects` | 创建项目，可携带首条提示词和已上传资源 ID；事务内同时创建项目、绑定资源并落库首条内部任务，返回项目 ID。供应商提交由后台处理，跳转后不重复提交。 |
| `GET /api/projects?limit=20&cursor=...` | 按 `updatedAt DESC, id DESC` 游标分页，只返回当前用户有内容的未删除项目，包含封面、名称和更新时间；分页前排除空草稿。 |
| `GET /api/public/projects?limit=20&cursor=...` | 无需登录，分页展示全站有内容且未删除的项目，仅包含名称、时间及画布封面地址，不包含所有者和私密历史。 |
| `GET /api/public/projects/{id}` | 无需登录，只读返回项目名称与画布图片的位置、尺寸、资源、公开图片地址及图片对应的模型配置/操作名称，不返回私密对话、提示词或 Skill。 |
| `GET /api/public/assets/{id}/content` | 当前未删除项目画布中的图片可匿名读取，307 重定向至有效期 300 秒的签名 URL；支持 `?download=1`，不能读取游离附件、Markdown 或 Skill。 |
| `GET /api/projects/{id}` | 读取项目、配置、节点、视口和进行中的任务；大量消息单独分页。 |
| `PATCH /api/projects/{id}` | 更新名称、默认模型配置；同账号多个标签页按最后一次成功保存为准，画布几何信息另用版本号保护。 |
| `PUT /api/projects/{id}/canvas` | 保存画布节点位置、图片展示尺寸和视口，带版本号，冲突返回 409。节点可选 `width`、`height`，必须为有限正数且不超过 20,000；省略时保留原尺寸，空占位不更新尺寸。 |
| `DELETE /api/projects/{id}/nodes/{nodeId}` | 删除当前用户项目中已明确失败、无资源的画布占位，保留任务和右侧生成记录；其他状态返回 409，不存在或无权访问返回 404。删除不改变位置/视口版本号，旧的几何保存不会重建已删除节点。 |
| `GET /api/projects/{id}/messages?cursor=...` | 分页读取历史生成消息及结果。 |
| `POST /api/uploads` | 校验单张图片并上传 bucket，返回资源 ID、缩略图地址；首次输入可先创建归属当前用户的临时资源，在项目创建时事务内绑定。 |
| `POST /api/projects/{id}/generations` | 接收提示词、可选参考图资源 ID、模型和配置；携带 `Idempotency-Key`，落库后返回内部任务 ID，HTTP 202。 |
| `POST /api/projects/{id}/image-actions` | 无 Agent 的直接图片处理。接收 sourceNodeId、action（edit/enhance/background/extract/variant）、instruction?、elements?、resolution?，需 Idempotency-Key，默认 1K，返回 HTTP 202 `{ tasks, nodes }`，便于即时接替客户端处理中占位。来源节点必须在当前用户项目中，edit 需编辑要求、variant 需同款提示词，extract 需 1–4 个不重复元素。 |
| `GET /api/generations/{id}` | 返回本地任务状态、进度、结果资源及错误摘要，浏览器不持有供应商密钥。 |
| `POST /api/generations/{id}/retry` | 已明确失败时，以新的幂等键创建重试任务；受理状态未知时拒绝重新生成。 |
| `GET /api/assets/{id}/url` | 校验权限后为当前资源返回可读地址及过期时间，使用画布图作参考时由服务端重新取得可用地址。 |

## 请求与错误约定

- `projectId`、内部任务 ID 和资源 ID 均为 UUID；供应商任务 ID 不混用。
- 分页返回 `{ items, nextCursor }`，项目列表持续加载直到 `nextCursor` 为空。
- 无节点、任务、素材、Skill、Agent 对话且无运行中 Agent 的项目为临时空草稿，不进入最近项目或我的项目。创建草稿仍返回 ID 供上传和打开画布使用；添加内容后自动进入列表。仅改名、配置、视口不视为内容；不根据封面或项目名称判断是否为空。
- 生图参数：`{ prompt, referenceAssetId?, config: { model, size, resolution, n } }`，所有字段由服务端验证，模型只允许已配置的白名单。
- 成功返回资源对象或集合；错误统一为 `{ error: { code, message }, requestId }`，不回传密钥或供应商完整请求头。
- 401 未登录；404 不存在或无权限；409 版本/幂等冲突或已有进行中任务；413 文件过大；422 参数不合法；429 频率超限；502 上游不可用。
- 上传中不得发送。服务端拒绝无效参考图、空提示词及超过 32,000 字符的 GPT Image2 提示词。
- 账号与项目 Skill 使用同一 UTF-8 / YAML 验证器，文件名为 SKILL.md、最大 128KB、必须含 name/description 和规则正文；同一作用域名称唯一，重复返回 409。项目 Skill 删除接口仅删除本项目记录，账号 Skill 必须使用账号接口。
- 直接图片处理由服务端组装固定操作提示和来源参考图，使用已有 GPT Image 2.5 供应商链路；不写 Agent 对话。批次与普通生图共享并发及幂等约束，同一操作键不能更换参数或拆分清单。task.imageAction 返回类型及来源；原图保留，新节点相邻排布，失败重试保留操作标识。
- 幂等键按用户和操作唯一，同一键只能对应相同请求内容。前端重试网络请求时复用原键，明确创建新生成时才换键。
- 所有权检查适用于项目、上传资源、任务和画布选择。不能只验证路径中的项目而忽略请求体中的参考资源所属项目。

## 实施与联调状态

- 单张上传、10MB 校验、签名读取和生成结果转存已实现并通过真实 S3 验证，详见存储文档。
- Nano Banana 2.1 按 [模型文档](nano-banana-2.1.md) 映射 `image_urls`、大写 `metadata.resolution` 及数字 `n=1`，联调验证账号权限及结果。
- `/protected` 首次发送已实现事务内创建项目、绑定图片和任务入库，并通过浏览器及幂等测试；跳转后不重复发送。

## 删除项目

`DELETE /api/projects/:projectId`：认证、来源及当前用户归属校验后将项目逻辑删除，成功返回 `{ "ok": true }`。不存在、已删除或不属于用户返回 404；项目有进行中的生成任务或 Agent 返回 409。

项目列表、打开项目、任务和素材签名读取均排除已删除项目。删除只更新 `ac_projects.deleted_at`，不物理删除对象存储素材，暂不提供恢复入口。前端在卡片上提供独立按钮和带名称的确认弹窗，删除成功后同步更新列表。

## 图片显示预览

`GET /api/assets/:id/content?preview=1` 与 `GET /api/public/assets/:id/content?preview=1` 返回轻量 WebP 预览的签名跳转；缺失预览时回退原图。私有接口每次校验会话及所有权，公开接口仅允许未删除项目的画布图片。`download=1` 优先于 `preview=1`，始终下载原图。原图及生成参考 URL 不变。跳转不缓存，预览对象可由浏览器缓存；签名短时复用不缓存授权结果。
