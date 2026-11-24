# Gemini Nano Banana 2.1 接口约定

## 来源与服务

依据用户提供的《Gemini Nano Banana 2.1 Image Generation》，来源附件 `pasted-1795523701700.txt`。本文件记录接入约定，尚未发起真实生成验证。

- 服务商：ToAPIs，模型固定为 `gemini-nano-banana-2.1`（Standard）。
- 创建任务：`POST /v1/images/generations`。与 GPT Image2 共用 `TOAPIS_BASE_URL` 和服务端 `TOAPIS_API_KEY`；大陆 Base URL 为 `https://toapis.cn`。
- 请求头：`Authorization: Bearer <服务端密钥>`、`Content-Type: application/json`。

## 请求与界面映射

| 参数 | 约定 |
| --- | --- |
| `model` | 必填，`gemini-nano-banana-2.1`。 |
| `prompt` | 必填，生成或编辑描述；文档未给最大字符数，不套用 GPT Image2 的上游长度限制。 |
| `size` | 宽高比，支持 `1:1`、`3:2`、`2:3`、`4:3`、`3:4`、`16:9`、`9:16`、`5:4`、`4:5`、`21:9`、`1:4`、`4:1`、`1:8`、`8:1`；未列出 `auto`。 |
| `n` | 固定为数字 `1`，不能传字符串 `"1"`，不提供多张生成选项。 |
| `image_urls` | 可选图片 URL 数组。上游支持最多 14 张，产品最多一张；无参考图时省略。 |
| `metadata.resolution` | `1K`、`2K`、`4K`，默认 `1K`，必须大写 `K`，嵌套在 `metadata` 中。 |

- 本产品初始 `size=1:1`、`metadata.resolution=1K`，数量固定 1。输入区配置摘要为“分辨率 · 比例”。
- 参考图的 `512` 分辨率不受本接口支持，实际配置卡片移除该选项，不将其映射为其他档位。
- 图片必须是供应商可读取的 HTTP(S) URL，不支持 base64。本地图片先上传现有 S3，画布选图复用资源并按需重新签名。
- 参考图片支持 JPEG/JPG、PNG、WebP，单张最多 10MB。本项目按 **10,000,000 字节**保守校验，避免此前 10 MiB 上限超出供应商限制；从画布选择图片时同样检查其格式与大小，不绕过此限制。

## 与 GPT Image2 的差异

| 项目 | GPT Image2 | Nano Banana 2.1 |
| --- | --- | --- |
| 模型 | `gpt-image-2` | `gemini-nano-banana-2.1` |
| 分辨率字段 | 顶层 `resolution` | 嵌套 `metadata.resolution` |
| 分辨率取值 | `1k`、`2k`、`4k` | `1K`、`2K`、`4K` |
| 参考图字段 | 优先 `reference_images` | `image_urls` |
| 生成数量 | 文档未给上限，联调前只启用 1 张 | 明确固定数字 1 |

模型适配层分别构建请求，禁止直接复用一份供应商请求体或通过字段大小写猜测转换。

## 异步结果

创建响应返回 `id`、`object=generation.task`、`model`、`status`、`progress`、`created_at` 和 `metadata`。状态为 `queued`、`in_progress`、`completed`、`failed`，进度为 0–100，时间戳单位为秒。

用户提供的文档指向通用图片任务查询 API，复用项目已核对的 `GET /v1/images/generations/{task_id}` 和结果解析约定，见 [GPT Image2 文档](gpt-image-2.md)。创建返回任务 ID 不代表图片已生成完成。前后端状态、S3 转存、幂等与重试按 [技术设计](../technical-design.md) 执行。

## 请求体示例

```json
{
  "model": "gemini-nano-banana-2.1",
  "prompt": "将参考照片转换为水彩画",
  "size": "16:9",
  "n": 1,
  "image_urls": ["https://example.com/reference.png"],
  "metadata": {
    "resolution": "2K"
  }
}
```

签名地址可用性、实际账号模型权限、完成结果与失败响应仍需联调，不能因密钥有值就认定接口已验证成功。
