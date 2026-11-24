# Pi Agent 验收记录

更新：2026-11-25。证据区分真实供应商验证、真实 API 验证与 Chrome 界面验证。

## 需求与证据

| 需求 | 实现及已验证证据 |
| --- | --- |
| 同一右侧输入框底部 Agent / 生图菜单 | 本机 Chrome + Playwright：向上展开、键盘选择、Esc、外部关闭、切换后模型参数、上传与 Agent 工作期间禁用、390px 下发送按钮在框内。 |
| 统一图片 / Markdown 附件 | Chrome 真实文件上传、Markdown 文件粘贴、图片拖入、缩略图、240px 长文件名省略、原文安全预览和下载。使用现有私有 S3 兼容 Bucket（遵循项目已确认存储方案）。 |
| 画布有序素材与编辑 | Chrome：图一/图二、竖图紧贴宽高、拖动、等比缩放、复制粘贴、Delete/Backspace、编辑文字不删节点、刷新恢复；真实 API 确认删除只移除节点、保留素材。EXIF 旋转 JPEG 尺寸另有真实图片单测。 |
| 流式对话与附件消息 | Chrome：真实 DeepSeek 思考和回复、工具参数/结果/实际错误展开、刷新恢复、立即清空草稿与附件。消息按时间混排，Agent 生图记录不重复显示用户提示词；双方模式共用消息区。Markdown 服务端渲染检查覆盖粗体、列表、分隔线、表格、代码与恶意 HTML/链接阻断。 |
| GPT Image 2.5 生图与重试 | 真实 ToAPIs Sunburst 文生图/图生图各一张 1K 均成功，查询原任务直到结果转存私有存储。图生图先通过 Pi 工具读取真实像素。真实重试/重新生成 API 检查模型、有序参考、附件及幂等保持；队列锁住，契约测试不触发额外生图。普通模式保持原模型。 |
| 认证与配置 | 跨用户/跨项目的项目、附件、素材、节点、任务、Agent 接口拒绝访问；服务端读取 DEEPSEEK_API_KEY 并覆盖模型 baseUrl。未输出、修改或提交真实密钥。 |

## 验证命令

- pnpm test:agent：真实 API、私有存储、DeepSeek 工具、历史和上下文。
- pnpm test:agent -- --queue 或直接给 tests/agent-api.ts 传 --queue：先停止 worker，测试持有队列锁，验证重试/重新生成/普通模式参数，不提交供应商生成。
- tests/agent-api.ts --generate：会产生真实 GPT Image 2.5 生图费用；此前已完成文生图与图生图各一张，不作为普通回归默认步骤。
- pnpm test:agent:ui：按用户明确授权，以 Playwright 的 Chrome channel 验收真实界面；使用独立随机测试账号并清理。
- pnpm test:markdown、pnpm test:image-bounds：已通过。
- pnpm typecheck、pnpm lint、pnpm build：当前代码已通过。

## 原功能回归与限制

- 原注册/预览回归 tests/registration-ui.ts 已适配底部模式菜单和上传后自动落点。旧预览夹具原来与新增上传节点重叠，已隔离其测试节点；最终重跑已通过，包含四角缩放跨轮询、图片预览、移动端、注册登录、非法项目和退出重登。
- 原生 CUA 返回的窗口截图与 Chrome 控件树不一致，故经用户明确授权改用本机 Playwright + Chrome；不将原生工具失败当成产品通过证据。
- 新 Agent Chrome 套件已全部通过，包括真实工具错误与历史恢复。截图保存在 test-results/agent/，该目录不提交。
- 最终核对：Agent Chrome 套件、原注册/预览回归、类型检查、Lint 和生产构建均以退出码 0 完成；真实供应商验证范围见上表。

## Skill 验收（2026-11-25）

- 已应用 004-skills.sql。Skill 独立按 owner_id 与 project_id 保存完整 source/body；技能名称限制为最多 64 字符的小写字母、数字、单连字符，不作为文件路径使用。
- 实际 SKILL.md 上传、完整正文读回、路径穿越、跨项目读取/移除/使用及跨用户读取/移除校验已覆盖真实接口。解析测试覆盖多行 YAML、缺失/异常字段、重复键、别名及路径名拒绝。
- Chrome + Playwright 已验证附件旁 Skill 入口、上传与列表、名称与两行简介、本次选择、发送时立即清空文字/文件/技能、消息中技能名、刷新保留、移除技能后历史名称仍在，以及窄屏菜单。
- wechat-cover 的完整可上传文件位于 docs/skills/wechat-cover/SKILL.md；独立只读技能演练确认首次不生图、数字选择续接及一次四条不同构图提示词。
- 真实 DeepSeek 读取文章并先询问全部五种风格，首轮任务数为零；后续不再次选择 Skill，仅回复风格，真实创建同一批次四个 GPT Image 2.5 Sunburst / 21:9 / 1K 任务。四张均完成并转存私有存储、保存至画布，测试账号和结果随后清理。没有新增生图供应商或伪造结果。
- 批量复用 generate_image 的 prompts 参数与既有 enqueue/worker；批次事务原子落库，每图独立任务。普通请求仍不能绕过同项目并发约束；用户并发按不同项目计数。
- 验证命令：pnpm test:skills、pnpm test:skills:ui、pnpm test:skills:parser。真实四图验证使用 tests/skills-api.ts --generate，产生真实生图费用，非默认回归步骤。
- 类型检查、Lint、生产构建已通过。Skill 入口不需要额外密钥，不执行技能里的 HTML、脚本或文件路径；技能作为用户主动选择的模型规则输入，工具继续限制当前用户和项目。

- Skill 最终验收：原 Agent Chrome 套件再次全部通过，附件、画布和流式交互未回归；本次目标完成。

## 首页入口补齐（2026-11-25）

- 修正 CreativeHome 仍使用旧生图 Composer 的遗漏：首页现在与项目对话共享 Agent/生图、附件和 Skill。
- 项目在首次上传/打开技能列表/发送时延迟创建；所有技能与附件写入这个项目。首页发送后将本次文字、附件、技能交接给画布，自动发起一次真实 Agent 对话。
- Chrome tests/home-agent-ui.ts 已通过首页 Skill 与 Markdown 上传、项目创建、发送跳转、技能消息、真实风格询问、清空选择、历史与删除。
- 修复历史读取覆盖刚自动发出的消息的竞争；通过读取版本检查与进行中请求保护避免覆盖。
- 类型检查、Lint、生产构建通过；原注册、配置、预览、四角缩放等回归通过。
