import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMessages } from "../components/canvas/agent-messages";
import {
  AGENT_IMAGE_MODEL,
  agentImageSizeSchema,
  agentResolutionForPrompt,
  generationSchema,
  providerPayload,
} from "../lib/models";

for (const [input, expected] of [
  ["1024x1024", "1:1"],
  ["2048×2048", "1:1"],
  ["1536x1024", "3:2"],
  ["1024x1536", "2:3"],
  ["2048x1360", "3:2"],
  ["2520x1080", "21:9"],
  ["1920x1080", "16:9"],
  [" 16 : 9 ", "16:9"],
  ["auto", "auto"],
])
  assert.equal(agentImageSizeSchema.parse(input), expected);
for (const invalid of ["0x1024", "123x456", "nonsense"])
  assert.equal(agentImageSizeSchema.safeParse(invalid).success, false);

for (const [prompt, resolution] of [
  ["生成四张夏日饮品广告", "1k"],
  ["生成高清精致图片，2048x2048", "1k"],
  ["生成1K图片", "1k"],
  ["使用2K生成四张", "2k"],
  ["我要 4 K 分辨率", "4k"],
]) {
  const config = generationSchema.parse({
    prompt,
    config: {
      model: AGENT_IMAGE_MODEL,
      size: agentImageSizeSchema.parse("1024x1024"),
      resolution: agentResolutionForPrompt(prompt),
      n: 1,
    },
  });
  assert.equal(config.config.resolution, resolution);
  const payload = providerPayload(config);
  assert("resolution" in payload);
  assert.equal(payload.resolution, resolution.toUpperCase());
  assert.equal(payload.size, "1:1");
}

const events = [
  {
    type: "tool_execution_start",
    toolCallId: "first",
    toolName: "generate_image",
  },
  {
    type: "tool_execution_end",
    toolCallId: "first",
    isError: true,
    error: "不支持的图片比例",
  },
  {
    type: "tool_execution_start",
    toolCallId: "retry",
    toolName: "generate_image",
  },
  {
    type: "tool_execution_end",
    toolCallId: "retry",
    result: { taskId: "one", taskIds: ["one", "two", "three", "four"] },
  },
];
function render(runEvents: typeof events) {
  return renderToStaticMarkup(
    <AgentMessages
      assets={[]}
      projectId="test"
      runs={[
        {
          id: "test",
          createdAt: "2026-11-25T00:00:00Z",
          prompt: "生成图片",
          attachmentIds: [],
          events: runEvents,
        },
      ]}
    />,
  );
}
assert(render(events).includes("参数未通过，后续重试已提交"));
assert(render(events).includes("已提交 4 张"));
assert(render(events.slice(0, 2)).includes("参数未通过（未提交生图）"));
console.log(
  "Agent image parameters and retry status passed (no provider requests).",
);
