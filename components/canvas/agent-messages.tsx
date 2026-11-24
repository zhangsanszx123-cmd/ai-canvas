"use client";
import { Attachment } from "./attachment";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Asset, type Skill } from "@/lib/client-api";

type Event = {
  type: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  error?: string;
  message?: string;
};
type Run = {
  skillNames?: string[];
  createdAt: string;
  id: string;
  prompt: string;
  attachmentIds: string[];
  events: Event[];
};
export function useAgentConversation(
  projectId: string,
  refresh: () => Promise<void>,
) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const inFlight = useRef(false);
  const historyVersion = useRef(0);
  const reload = useCallback(async () => {
    const version = ++historyVersion.current;
    setHistoryError("");
    try {
      const data = await api<{ messages: Run[] }>(
        `projects/${projectId}/agent`,
      );
      if (version !== historyVersion.current || inFlight.current) return;
      setRuns(data.messages);
      setReady(true);
    } catch {
      setHistoryError("对话历史读取失败，请重试。");
    }
  }, [projectId]);
  useEffect(() => {
    setReady(false);
    void reload();
  }, [reload]);
  async function send(
    prompt: string,
    attachments: Asset[],
    skill?: Skill | null,
  ) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    const run: Run = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      prompt,
      attachmentIds: attachments.map((a) => a.id),
      skillNames: skill ? [skill.name] : [],
      events: [],
    };
    setRuns((old) => [...old, run]);
    try {
      const response = await fetch(`/api/projects/${projectId}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          attachmentIds: run.attachmentIds,
          skillId: skill?.id,
        }),
      });
      if (!response.ok || !response.body) throw new Error("Agent 请求失败");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      for (;;) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as Event;
          run.events = [...run.events, event];
          setRuns((old) =>
            old.map((item) => (item.id === run.id ? { ...run } : item)),
          );
          if (event.type === "tool_execution_end") void refresh();
        }
        if (done) break;
      }
    } catch {
      run.events = [
        ...run.events,
        {
          type: "error",
          message: "连接中断，请刷新确认任务状态，避免重复提交。",
        },
      ];
      setRuns((old) =>
        old.map((item) => (item.id === run.id ? { ...run } : item)),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      await refresh();
    }
  }
  return { runs, busy, ready, historyError, reload, send };
}
export function Markdown({ children }: { children: string }) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) =>
          /^(https?:\/\/|\/[^/]|#)/i.test(url) ? url : ""
        }
        components={{
          img: () => null,
          a: (props) => (
            <a href={props.href} target="_blank" rel="noopener noreferrer">
              {props.children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
export function AgentMessages({
  runs,
  assets,
  projectId,
}: {
  runs: Run[];
  assets: Asset[];
  projectId: string;
}) {
  return runs.map((run) => {
    const blocks: { type: string; text?: string; event?: Event }[] = [];
    for (const event of run.events) {
      if (event.type === "text_delta" || event.type === "thinking_delta") {
        const last = blocks.at(-1);
        if (last?.type === event.type) last.text += event.delta || "";
        else blocks.push({ type: event.type, text: event.delta || "" });
      } else if (
        event.type === "tool_execution_start" ||
        event.type === "error"
      )
        blocks.push({ type: event.type, event });
    }
    return (
      <article className="agent-run" key={run.id}>
        <div className="agent-user-message">
          {run.skillNames?.map((name) => (
            <span className="sent-skill" key={name}>
              Skill · {name}
            </span>
          ))}
          {run.attachmentIds.map((id) => {
            const asset = assets.find((a) => a.id === id);
            return (
              <Attachment
                key={id}
                projectId={projectId}
                asset={
                  asset || {
                    id,
                    url: `/api/assets/${id}/content`,
                    width: 0,
                    height: 0,
                    bytes: 0,
                  }
                }
              />
            );
          })}
          <p>{run.prompt}</p>
        </div>
        {blocks.map((block, i) =>
          block.type === "text_delta" ? (
            <Markdown key={i}>{block.text || ""}</Markdown>
          ) : block.type === "thinking_delta" ? (
            <details className="agent-thinking" key={i}>
              <summary>思考过程</summary>
              <Markdown>{block.text || ""}</Markdown>
            </details>
          ) : block.type === "error" ? (
            <p className="inline-error" role="alert" key={i}>
              {block.event?.message}
            </p>
          ) : (
            <details className="agent-tool" key={i}>
              <summary>
                {(
                  {
                    list_assets: "列出素材",
                    view_image: "查看图片",
                    generate_image: "生成图片",
                    place_asset: "放置素材",
                    read_canvas: "读取画布",
                  } as Record<string, string>
                )[block.event?.toolName || ""] || block.event?.toolName}{" "}
                ·{" "}
                {run.events.find(
                  (e) =>
                    e.type === "tool_execution_end" &&
                    e.toolCallId === block.event?.toolCallId,
                )?.isError
                  ? "失败"
                  : run.events.some(
                        (e) =>
                          e.type === "tool_execution_end" &&
                          e.toolCallId === block.event?.toolCallId,
                      )
                    ? "完成"
                    : "执行中"}
              </summary>
              <pre>
                {JSON.stringify(
                  {
                    parameters: block.event?.args,
                    ...run.events.find(
                      (e) =>
                        e.type === "tool_execution_end" &&
                        e.toolCallId === block.event?.toolCallId,
                    ),
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          ),
        )}
      </article>
    );
  });
}
