import { z } from "zod";
export const imageActionLabels = {
  edit: "快捷编辑",
  enhance: "变清晰",
  background: "换背景",
  extract: "拆分元素",
  variant: "画同款",
} as const;
export const imageActionSchema = z
  .object({
    sourceNodeId: z.string().uuid(),
    action: z.enum(["edit", "enhance", "background", "extract", "variant"]),
    instruction: z.string().trim().max(31000).default(""),
    elements: z.array(z.string().trim().min(1).max(200)).max(4).default([]),
    resolution: z.enum(["1k", "2k", "4k"]).default("1k"),
  })
  .superRefine((input, ctx) => {
    if (
      (input.action === "edit" || input.action === "variant") &&
      !input.instruction
    )
      ctx.addIssue({
        code: "custom",
        message:
          input.action === "variant"
            ? "请填写同款图片提示词"
            : "请填写编辑要求",
        path: ["instruction"],
      });
    if (input.action === "edit" && input.instruction.length > 4000)
      ctx.addIssue({
        code: "custom",
        message: "编辑要求最多 4,000 字符",
        path: ["instruction"],
      });
    if (input.action === "extract" && !input.elements.length)
      ctx.addIssue({
        code: "custom",
        message: "请填写 1–4 个需要拆分的元素",
        path: ["elements"],
      });
    if (new Set(input.elements).size !== input.elements.length)
      ctx.addIssue({
        code: "custom",
        message: "拆分元素不能重复",
        path: ["elements"],
      });
  });
export type ImageActionInput = z.infer<typeof imageActionSchema>;
