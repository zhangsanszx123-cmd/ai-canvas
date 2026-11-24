# AI Canvas

基于 Next.js、PostgreSQL、Better Auth、React Flow 和 S3 兼容存储的多用户画布生图应用。支持 GPT Image2 与 Gemini Nano Banana 2.1。

## 本地运行

需要 Node.js 24、pnpm、PostgreSQL 及 S3 存储。

1. 参考 `.env.example` 填写 `.env`。已有数据库、S3、ToAPIs 配置可以继续使用。
2. `pnpm install`
3. `pnpm db:migrate`
4. `pnpm dev:all` 同时启动网页和生成工作进程。
5. 打开 http://localhost:3000 。

也可以在两个终端分别运行 `pnpm dev` 和 `pnpm worker`。工作进程必须持续运行，页面会展示它的连接状态。开发服务使用其他端口时，请同时设置 `APP_URL`。

## 账号与邮件

自主注册采用邮箱密码，注册成功直接登录，无需邮件验证即可创作。SMTP 只用于找回密码，可在 `.env` 配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` 后启用；未配置时只提示找回密码暂不可用，不影响注册、登录和生图。

本地 `BETTER_AUTH_SECRET` 已在首次实施时安全生成，部署时使用自己的高熵密钥。无需 Supabase 环境变量。所有密钥只保存在本地或部署配置中。

## 页面与功能

- `/protected`：提示词、单张参考图上传、最近项目。
- `/projects`：当前用户全部项目、分页、创建项目。
- `/canvas?projectId=...`：可保存的画布、可调宽度对话面板、模型配置、生成状态、下载、参考图复用。
- `/auth/login`、`/auth/sign-up`：登录和自主注册。

两种模型当前启用单张生成。Nano Banana 使用 `metadata.resolution` 和 `image_urls`；GPT Image2 使用 `resolution` 和 `reference_images`。没有接口支持的质量及自由宽高不作为有效参数提交。

## 检查

```bash
pnpm db:check
pnpm typecheck
pnpm lint
pnpm build
```

执行 `pnpm test:integration` 前先停止工作进程，保留网页服务运行。测试使用真实数据库、S3 和本机 Chrome，创建临时用户和资源，结束后清理；生图供应商响应采用模拟，不产生生图费用。测试与工作进程使用数据库互斥锁，防止测试任务被真实供应商受理。截图保存在被忽略的 `test-results/`。

`pnpm test:registration` 验证浏览器注册自动登录、新建空项目、单张上传、无图提示、非法项目 ID、退出及重新登录。它不提交生图任务，可以在工作进程运行时执行。两个测试命令均可追加本地预览地址参数。

## 生产部署

运行 `pnpm build` 后，以两个受进程管理器管理的服务分别运行 `pnpm start` 与 `pnpm worker`，配置相同的环境变量、数据库和存储。生产设置 HTTPS `APP_URL`，配置邮件域名和 SMTP。数据库迁移应先于服务启动。

`DB_CA_CERT` 为 CA 文件路径，设置后启用证书校验。不要用关闭 TLS 验证代替正确证书。供应商结果默认只允许 ToAPIs 域名，如供应商返回其他可信 CDN 域名，将准确域名加入 `TOAPIS_IMAGE_HOSTS`。

用户额度、收费及正式公开上线仍需单独确定，本项目未实现支付或积分扣费。未确认受理结果的任务不会自动重复提交，处理方式见运行文档。

## 文档

- [产品需求](docs/prd.md)
- [技术设计](docs/technical-design.md)
- [应用接口](docs/api/application-api.md)
- [模型接口](docs/api/gpt-image-2.md) / [Nano Banana 2.1](docs/api/nano-banana-2.1.md)
- [存储](docs/api/storage.md)、[环境变量](docs/environment.md)、[运行维护](docs/operations.md)
