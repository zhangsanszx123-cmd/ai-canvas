# 环境变量与配置检查

## 生产数据库 TLS 身份

生产容器通过 Docker 网络内的 `postgresql` 别名连接数据库，证书 SAN 为服务器公网 IP。`DB_CA_CERT` 指定只读挂载的 CA；`DB_TLS_SERVERNAME` 指定需要验证的证书身份。连接始终保留证书链校验，并使用 Node TLS 的 `checkServerIdentity` 校验该身份，不关闭证书验证。未设置 `DB_TLS_SERVERNAME` 时沿用驱动默认身份校验。

生产配置保存于服务器 `/opt/projects/ai-canvas/deploy/runtime.env`，权限为 600。生产使用独立受限数据库账号，本地 `.env` 保持原值。部署记录和完整操作说明见 [生产部署](production-deployment.md)。

## 检查结果

本次只检查变量名及是否有值，不记录实际值。最新读取的 `.env` 已包含数据库、S3 和 ToAPIs 必需配置；`.env.local` 的两个旧 Supabase 变量为空。此前“S3 尚未读到”的检查结果已被本次检查更新，配置存在不等于接口已联调成功。

以下变量已按当前代码接入；模型和 Base URL 有默认值。配置有值不代表服务一定可用，测试范围见运行维护文档。

| 变量 | 当前状态 | 用途与范围 |
| --- | --- | --- |
| `DATABASE_URL` | 已设置，此前只读连接验证成功 | 服务端 PostgreSQL 连接，继续使用现有配置。 |
| `DB_CA_CERT` | 已接入并通过数据库验证 | 服务端读取 CA 文件，启用 TLS 证书校验。 |
| `NEXT_PUBLIC_SUPABASE_URL` | 当前为空，新认证流程不需要 | 遗留模板变量，无需补填。 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 当前为空，新认证流程不需要 | 遗留模板变量，无需补填。 |
| `BETTER_AUTH_SECRET` | 已在本地安全生成 | 认证密钥，生产使用独立高熵值，不输出或提交。 |
| `TOAPIS_BASE_URL` | 缺失 | 服务端 API origin，初始采用所给文档的大陆地址 `https://toapis.cn`，调用时拼接 `/v1/...`。 |
| `TOAPIS_API_KEY` | 已设置 | 服务端 Bearer Token，不使用 `NEXT_PUBLIC_` 前缀。 |
| `TOAPIS_GPT_IMAGE_MODEL` | 缺失，可用代码默认值 | 初始 `gpt-image-2`，不擅自换成其他版本。 |
| `TOAPIS_NANO_BANANA_MODEL` | 未单独配置，可用代码默认值 | 已确定 `gemini-nano-banana-2.1`，与 GPT Image2 共用 ToAPIs 密钥，无需额外模型密钥。 |
| `STORAGE_PROVIDER` | 已确定为 S3 | 当前只实现 S3 适配器，该项为说明性配置，不控制其他存储切换。 |
| `S3_BUCKET` | 已设置 | 实际 bucket 名称，沿用现有变量，无需 `STORAGE_BUCKET`。 |
| `S3_ENDPOINT` | 已设置 | S3 兼容服务 endpoint。 |
| `S3_REGION` | 已设置 | 签名所需 region，以现有服务商为准。 |
| `S3_ACCESS_KEY` | 已设置 | 服务端访问 ID，映射为 SDK 的 `accessKeyId`。 |
| `S3_SECRET_KEY` | 已设置 | 服务端访问密钥，映射为 SDK 的 `secretAccessKey`。 |
| `APP_URL` | 缺失，本地可用默认值 | 应用 origin，初始 `http://localhost:3000`；显式传给 Better Auth 的 `baseURL` 并配置可信来源，不重复要求 `BETTER_AUTH_URL`。 |

## 已确定方案与条件配置

- 使用现有 S3 兼容存储，直接读取上述已有变量，无需再填 `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 或 `STORAGE_BUCKET` 等别名，不擅自改动真实 `.env`。
- 可选 `S3_FORCE_PATH_STYLE` 默认 `false`，仅服务商要求 path-style 时启用；临时凭据才需要 `S3_SESSION_TOKEN`。这些不是所有 S3 服务都必须填写的缺失项。
- 不需要 `SUPABASE_SERVICE_ROLE_KEY`，新方案也不需要 Supabase 项目 URL 和公开 key。
- 已确认自主注册无需邮件验证，注册自动登录。SMTP 仅用于可选的找回密码功能：`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM`、`SMTP_SECURE`；缺少这些配置不影响注册、登录、上传和生图。
- `.env` 已有 `CRON_SECRET` 和 `NEXT_PUBLIC_DEFAULT_LOCALE`，本次不改名、不删除。后续若启用受保护调度接口，可复用 `CRON_SECRET`；仅配置该变量不会自动启动后台任务。
- Better Auth 选择与密钥要求依据：[安装文档](https://better-auth.com/docs/installation)。数据库连接继续复用 `DATABASE_URL`，无需第二个数据库。

## 加载规则与配置安全

- 私密值保存在被忽略的 `.env` 或部署环境变量中，不更改为可提交文件。`.env.example` 只包含占位符或非敏感默认值。
- Next.js 中 `.env.local` 优先于 `.env`；同名空值也可能遮盖 `.env` 的设置，避免将同一个变量分散到多个文件。
- 当前 `pnpm db:check` 显式读取 `.env`，Next.js 按自身优先级加载；数据库连接配置统一放在 `.env`，避免两种检查读到不同目标。
- 除明确公开的 Supabase URL 和 publishable key 外，本文变量均按服务端变量使用。无需为 `@xyflow/react`、图标、UUID 或 SQL 迁移添加密钥。
- 常规 UI 参数、默认宽度、分页大小、上传限制和轮询间隔放在类型化配置中，避免无必要增加环境变量。
- `TOAPIS_IMAGE_HOSTS` 为可选的额外可信结果图片主机列表，用逗号分隔；默认允许 ToAPIs 域名，按真实供应商响应补充准确 CDN 主机。
- 实施时增加配置校验：缺少必需配置时返回明确服务不可用提示，不跳过鉴权，也不使用假的生成结果冒充接入成功。

## Pi Agent

- 服务端读取 `DEEPSEEK_API_KEY`；不使用 `NEXT_PUBLIC_` 前缀。
- `DEEPSEEK_BASE_URL` 可选，默认覆盖实际模型地址为 `https://api.deepseek.com`；`DEEPSEEK_MODEL` 可选，默认使用安装包目录中的支持视觉的 `deepseek-flash`。如覆盖模型，需保留图片输入和工具调用能力。
- Agent 生图固定为 `gpt-image-2.5-sunburst`，复用 `TOAPIS_API_KEY`、`TOAPIS_BASE_URL` 和现有任务工作进程；不受普通生图 `TOAPIS_GPT_IMAGE_MODEL` 覆盖影响。
- 运行增量迁移 `pnpm db:migrate` 后重启生图工作进程以加载多参考图实现；现有私有 Bucket 和认证不变。
