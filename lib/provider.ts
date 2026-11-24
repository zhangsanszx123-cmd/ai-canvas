import "server-only";
import { lookup } from "node:dns/promises";
import { providerPayload, type GenerationInput } from "./models";
import { HttpError } from "./http";
import { providerFailureMessage } from "./provider-errors";

function endpoint(path: string) {
  const base = new URL(process.env.TOAPIS_BASE_URL || "https://toapis.cn");
  if (base.protocol !== "https:")
    throw new HttpError(503, "生图服务必须使用 HTTPS");
  return new URL(path, base);
}
function headers() {
  if (!process.env.TOAPIS_API_KEY) throw new HttpError(503, "生图密钥尚未配置");
  return {
    Authorization: `Bearer ${process.env.TOAPIS_API_KEY}`,
    "Content-Type": "application/json",
  };
}
export async function submit(
  input: GenerationInput,
  referenceUrl?: string | string[],
) {
  const response = await fetch(endpoint("/v1/images/generations"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(
      providerPayload(input, referenceUrl, {
        gpt: process.env.TOAPIS_GPT_IMAGE_MODEL,
        nano: process.env.TOAPIS_NANO_BANANA_MODEL,
      }),
    ),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body: unknown =
      response.status < 500 ? await response.json().catch(() => null) : null;
    const details =
      body && typeof body === "object" && "error" in body ? body.error : body;
    const error = new Error(
      response.status >= 500
        ? "供应商受理状态未知"
        : providerFailureMessage(details, response.status),
    );
    Object.assign(error, { uncertain: response.status >= 500 });
    throw error;
  }
  const task = await response.json().catch(() => {
    throw Object.assign(new Error("供应商响应无法解析，受理状态待核对"), {
      uncertain: true,
    });
  });
  if (typeof task.id !== "string" || !task.id)
    throw Object.assign(new Error("供应商未返回任务标识"), { uncertain: true });
  return task.id as string;
}
export async function queryProvider(id: string) {
  const response = await fetch(
    endpoint(`/v1/images/generations/${encodeURIComponent(id)}`),
    {
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw Object.assign(new Error("任务查询暂时失败"), {
      retryAfter: Number(response.headers.get("retry-after")) || 10,
    });
  return response.json() as Promise<{
    status: string;
    progress?: number;
    result?: { data?: { url: string }[] };
    error?: { code?: string; message?: string };
  }>;
}
export async function downloadResult(source: string) {
  let url = new URL(source);
  for (let redirects = 0; redirects < 4; redirects++) {
    const host = url.hostname.toLowerCase();
    const allowed = [
      "toapis.com",
      "toapis.cn",
      ...(process.env.TOAPIS_IMAGE_HOSTS || "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    ];
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !allowed.some((h) => host === h || host.endsWith(`.${h}`))
    )
      throw new Error("图片来源主机尚未授权，请配置 TOAPIS_IMAGE_HOSTS");
    const addresses = await lookup(host, { all: true });
    if (
      !addresses.length ||
      addresses.some(({ address: a }) =>
        /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::$|f[cd]|fe[89ab]|::ffff:)/i.test(
          a,
        ),
      )
    )
      throw new Error("图片地址不可访问");
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("图片重定向无效");
      url = new URL(next, url);
      continue;
    }
    if (!response.ok || !response.body) throw new Error("生成图片下载失败");
    if (Number(response.headers.get("content-length")) > 50_000_000)
      throw new Error("生成图片过大");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      length += chunk.length;
      if (length > 50_000_000) {
        await response.body.cancel().catch(() => {});
        throw new Error("生成图片过大");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("生成图片重定向次数过多");
}
