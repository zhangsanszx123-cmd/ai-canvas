"use client";
import { useRef, useState } from "react";
import { Composer } from "./composer";
import { Brand } from "./brand";
import { ProjectGrid } from "./project-grid";
import { api, type Asset, type Skill } from "@/lib/client-api";
import type { GenerationInput } from "@/lib/models";
export function CreativeHome() {
  const pending = useRef<{ payload: string; key: string } | null>(null);
  const projectRequest = useRef<Promise<string> | null>(null);
  const [projectId, setProjectId] = useState<string>();
  function ensureProject() {
    if (!projectRequest.current)
      projectRequest.current = api<{ id: string }>("projects", {
        method: "POST",
        body: "{}",
      })
        .then((project) => {
          setProjectId(project.id);
          return project.id;
        })
        .catch((error) => {
          projectRequest.current = null;
          throw error;
        });
    return projectRequest.current;
  }
  async function sendAgent(
    prompt: string,
    attachments: Asset[],
    skill?: Skill | null,
  ) {
    const id = await ensureProject();
    await api(`projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: prompt.slice(0, 20) }),
    });
    sessionStorage.setItem(
      `agent-start:${id}`,
      JSON.stringify({ prompt, attachments, skill }),
    );
    window.location.assign(`/canvas?projectId=${id}`);
  }
  async function send(input: GenerationInput) {
    const payload = JSON.stringify(input);
    if (pending.current?.payload !== payload)
      pending.current = { payload, key: crypto.randomUUID() };
    const id = await ensureProject();
    await api(`projects/${id}/generations`, {
      method: "POST",
      headers: { "Idempotency-Key": pending.current!.key },
      body: payload,
    });
    await api(`projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: input.prompt.slice(0, 20) }),
    });
    window.location.assign(`/canvas?projectId=${id}`);
  }
  return (
    <>
      <section className="home-hero">
        <h1>
          <Brand />
          让创作更简单
        </h1>
        <p>你的想法，从这里变成画面</p>
        <div className="home-composer">
          <Composer
            projectId={projectId}
            ensureProject={ensureProject}
            onSend={send}
            onAgentSend={sendAgent}
          />
        </div>
        <span className="keyboard-hint">⌘ / Ctrl + Enter 发送</span>
      </section>
      <ProjectGrid recent />
    </>
  );
}
