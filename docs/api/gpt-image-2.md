# GPT Image2 接口约定

## 来源与范围

依据用户提供的《GPT-Image-2 Image Generation》接口说明整理，来源附件：`pasted-1795522687528.txt`。需求审查时补查了官方任务查询文档，尚未调用真实付费接口验证；未提供的参数不得凭猜测实现。

## 服务与鉴权

- 服务提供方：ToAPIs。
- 创建任务：`POST https://toapis.com/v1/images/generations`。
- 按所提供文档，中国大陆部署使用 `https://toapis.cn` 作为 Base URL，即 `POST https://toapis.cn/v1/images/generations`。
- 请求头：`Authorization: Bearer <服务端 API Key>`、`Content-Type: application/json`。
- API Key 使用服务端变量 `TOAPIS_API_KEY`，不进入客户端代码、公开环境变量、日志或仓库。origin 使用 `TOAPIS_BASE_URL`，本地初始采用 `https://toapis.cn`。

## 创建任务参数

| 字段 | 类型 | 约定 |
| --- | --- | --- |
| `model` | string，必填 | 固定为 `gpt-image-2`。 |
| `prompt` | string，必填 | 生图提示词，最多 32,000 个字符。 |
| `size` | string | 宽高比，接口默认 `1:1`；支持值见下表，也支持 `auto`。 |
| `resolution` | string | `1k`、`2k`、`4k`，接口默认 `1k`；请求使用小写值。 |
| `n` | integer | 生成数量，接口默认 `1`；文档未说明最大值。 |
| `response_format` | string | 接口默认及推荐值为 `url`，返回图片地址。 |
| `reference_images` | string[] | 可选参考图 URL 数组；供应商上限为 14 张，本产品 `/canvas` 仍限制为最多一张。 |
| `image_urls` | string[] | 兼容旧字段，由供应商归一化为 `reference_images`；本项目优先使用 `reference_images`。 |
| `background` | string | 可选；透明背景传 `transparent`，普通生成省略该字段，不传 `auto` 或 `opaque`。透明背景功能尚未纳入已确认的产品界面需求。 |

`reference_images` 和 `image_urls` 不再支持 base64，仅接受供应商可访问的 `http://` 或 `https://` 图片 URL。供应商另有上传图片接口，但本次材料未包含其请求规范；不能据此替代本项目已确认的 bucket 上传方案。

### 宽高比与像素参考

下表来自用户提供的文档。`auto` 由上游决定最终尺寸，不保证宽高比及像素值。这里的档位名称不代表所有图片的长边都等于 1024、2048 或 4096。

| `size` | `1k` | `2k` | `4k` |
| --- | --- | --- | --- |
| `1:1` | 1024×1024 | 2048×2048 | 2880×2880 |
| `3:2` | 1536×1024 | 2048×1360 | 3520×2336 |
| `2:3` | 1024×1536 | 1360×2048 | 2336×3520 |
| `4:3` | 1024×768 | 2048×1536 | 3312×2480 |
| `3:4` | 768×1024 | 1536×2048 | 2480×3312 |
| `5:4` | 1280×1024 | 2560×2048 | 3216×2576 |
| `4:5` | 1024×1280 | 2048×2560 | 2576×3216 |
| `16:9` | 1536×864 | 2048×1152 | 3840×2160 |
| `9:16` | 864×1536 | 1152×2048 | 2160×3840 |
| `2:1` | 2048×1024 | 2688×1344 | 3840×1920 |
| `1:2` | 1024×2048 | 1344×2688 | 1920×3840 |
| `21:9` | 2016×864 | 2688×1152 | 3840×1648 |
| `9:21` | 864×2016 | 1152×2688 | 1648×3840 |

### 界面到请求的映射

- 提示词映射为 `prompt`，所选图片数量映射为 `n`。
- 界面中图片比例与分辨率独立选择，分别映射为 `size` 和 `resolution`，例如比例 `16:9`、分辨率 `2K` 对应 `size: "16:9"`、`resolution: "2k"`。切换任一项不重置另一项。
- 已上传到 bucket 的参考图地址或画布图片的远程地址，作为单元素 `reference_images` 数组；无参考图时省略该字段。
- bucket 图片通过签名 URL 供供应商读取，持久化对象 key 而非过期地址；有效期初始 24 小时，受实际凭据和服务商策略约束，需联调验证。
- 当前文档没有定义 `quality`、`width` 或 `height` 参数，不能直接假定界面中的质量及自定义宽高可原样提交；也不能擅自用分辨率替代质量。
- 界面 `auto` 映射为 `size: "auto"`，分辨率仍按所选档位发送，但不承诺固定像素。初始分辨率为 `1k`。
- 文档额外比例不自动成为新增界面选项；当前产品初始值已选定为 `1k`、`1:1`、1 张。

## 异步任务与响应

创建接口返回任务，而非直接返回最终图片：

```json
{
  "id": "task_img_example",
  "object": "generation.task",
  "model": "gpt-image-2",
  "status": "queued",
  "progress": 0,
  "created_at": 1703884800
}
```

- `id`：供应商任务 ID，用于查询任务；与项目的 `projectId` 区分。
- `object`：固定为 `generation.task`。
- `status`：`queued`、`in_progress`、`completed`、`failed`。
- `progress`：0–100 的任务进度。
- `created_at`：Unix 时间戳。
- `queued` 和 `in_progress` 对应生成中状态；生成完成并取得结果 URL 后，才将画布及对话中的占位更新为结果图片。
- 最初附件未提供查询接口；现已从[官方查询文档](https://docs.toapis.cn/docs/en/api-reference/tasks/image-status)补全：使用同一 Base URL 和 Bearer Token 调用 `GET /v1/images/generations/{task_id}`，成功图片从 `result.data[].url` 读取，失败读取 `error.code` 和 `error.message`，记录可选的 `expires_at`。文档部分代码示例使用顶层 `url`，与正式字段说明不一致，实施按结构化结果解析并通过联调确认。
- 查询按 5–10 秒并加入抖动，429 遵循 `Retry-After`；创建响应不能直接当成最终结果。以上是官方文档约定，尚未经实际任务联调。

## 请求体示例

```json
{
  "model": "gpt-image-2",
  "prompt": "生成一张未来城市夜景海报",
  "size": "16:9",
  "resolution": "2k",
  "n": 1,
  "response_format": "url"
}
```

## 待补充与待确认

- 验证官方查询返回字段与实际 GPT Image2 任务一致，超时和重试按项目技术设计执行。
- 质量暂标不可配置，宽高按预设只读展示；将来取得真实支持说明后再开放对应编辑。
- `n` 的最大值及是否支持界面的 1–10 张，部分成功的响应形式。
- 生成结果需要转存现有 S3，实际 URL 有效期按供应商响应处理，存储权限见存储文档。
- 配置真实 API Key、验证所选 Base URL 和账号模型权限。
