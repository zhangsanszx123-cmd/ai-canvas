import { z } from "zod";

export const GPT_MODEL = "gpt-image-2";
export const AGENT_IMAGE_MODEL = "gpt-image-2.5-sunburst";
export const NANO_MODEL = "gemini-nano-banana-2.1";
export const ratios = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "5:4",
  "4:5",
  "21:9",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
];
export const gptPresets = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "9:16",
  "16:9",
  "auto",
];
export type ModelConfig = {
  model: typeof GPT_MODEL | typeof NANO_MODEL | typeof AGENT_IMAGE_MODEL;
  size: string;
  resolution: "1k" | "2k" | "4k";
  n: 1;
};
export const defaultConfig: ModelConfig = {
  model: GPT_MODEL,
  size: "1:1",
  resolution: "1k",
  n: 1,
};
export const configSchema = z
  .object({
    model: z.enum([GPT_MODEL, NANO_MODEL, AGENT_IMAGE_MODEL]),
    size: z.string(),
    resolution: z.enum(["1k", "2k", "4k"]),
    n: z.literal(1),
  })
  .refine(
    (c) =>
      (c.model === NANO_MODEL
        ? ratios
        : [...ratios, "2:1", "1:2", "9:21", "auto"]
      ).includes(c.size),
    "不支持的图片比例",
  );
export const generationSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "请输入提示词")
    .max(32000, "提示词最多 32,000 字符"),
  referenceAssetId: z.string().uuid().nullable().optional(),
  referenceAssetIds: z.array(z.string().uuid()).max(10).optional(),
  attachmentIds: z.array(z.string().uuid()).max(15).optional(),
  config: configSchema,
});
export type GenerationInput = z.infer<typeof generationSchema>;
export function providerPayload(
  input: GenerationInput,
  referenceUrl?: string | string[],
  models?: { gpt?: string; nano?: string },
) {
  const { config, prompt } = input;
  const references =
    typeof referenceUrl === "string" ? [referenceUrl] : referenceUrl;
  if (config.model === AGENT_IMAGE_MODEL)
    return {
      model: AGENT_IMAGE_MODEL,
      prompt,
      size: config.size,
      resolution: config.resolution.toUpperCase(),
      quality: "high",
      n: 1,
      ...(references?.length ? { reference_images: references } : {}),
    };
  if (config.model === NANO_MODEL)
    return {
      model: models?.nano || NANO_MODEL,
      prompt,
      size: config.size,
      n: 1,
      metadata: { resolution: config.resolution.toUpperCase() },
      ...(references?.length ? { image_urls: references } : {}),
    };
  return {
    model: models?.gpt || GPT_MODEL,
    prompt,
    size: config.size,
    resolution: config.resolution,
    n: 1,
    response_format: "url",
    ...(references?.length ? { reference_images: references } : {}),
  };
}
export function summary(c: ModelConfig) {
  return c.model === NANO_MODEL
    ? `${c.resolution.toUpperCase()} · ${c.size}`
    : `${c.size} · ${c.resolution.toUpperCase()} · ${c.n}张`;
}
const pixels: Record<string, [number, number][]> = {
  "1:1": [
    [1024, 1024],
    [2048, 2048],
    [2880, 2880],
  ],
  "3:2": [
    [1536, 1024],
    [2048, 1360],
    [3520, 2336],
  ],
  "2:3": [
    [1024, 1536],
    [1360, 2048],
    [2336, 3520],
  ],
  "4:3": [
    [1024, 768],
    [2048, 1536],
    [3312, 2480],
  ],
  "3:4": [
    [768, 1024],
    [1536, 2048],
    [2480, 3312],
  ],
  "16:9": [
    [1536, 864],
    [2048, 1152],
    [3840, 2160],
  ],
  "9:16": [
    [864, 1536],
    [1152, 2048],
    [2160, 3840],
  ],
};
export function dimensions(c: ModelConfig) {
  return pixels[c.size]?.[["1k", "2k", "4k"].indexOf(c.resolution)] ?? null;
}
export const activeStates = [
  "submitting",
  "queued",
  "in_progress",
  "saving",
  "submission_unknown",
];
