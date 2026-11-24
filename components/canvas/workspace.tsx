"use client";
/* eslint-disable @next/next/no-img-element -- Private image URLs require session cookies and must bypass the public optimizer cache. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ReactFlow,
  NodeResizeControl,
  useNodesState,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Expand,
  Hand,
  ImagePlus,
  LoaderCircle,
  Maximize,
  MessageSquare,
  MousePointer2,
  Plus,
  RefreshCw,
  X,
  Minus,
  Trash2,
} from "lucide-react";
import { Composer, ModelIcon } from "./composer";
import { AgentMessages, useAgentConversation } from "./agent-messages";
import { Attachment } from "./attachment";
import { Brand } from "./brand";
import { ImagePreview } from "./image-preview";
import { api, ApiError, type Asset } from "@/lib/client-api";
import {
  activeStates,
  summary,
  type ModelConfig,
  type GenerationInput,
} from "@/lib/models";

type Task = {
  id: string;
  prompt: string;
  referenceAssetId: string | null;
  referenceAssetIds?: string[];
  attachmentIds?: string[];
  config: ModelConfig;
  status: string;
  progress: number;
  error: string | null;
  createdAt: string;
  results: { assetId: string; url: string }[];
};
type ServerNode = {
  id: string;
  task_id: string;
  asset_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  url: string | null;
  status: string;
  progress: number;
  error: string | null;
};
type Project = {
  agent_lease_until?: string | null;
  id: string;
  name: string;
  config: ModelConfig;
  viewport: Viewport;
  version: number;
};
type Snapshot = {
  project: Project;
  nodes: ServerNode[];
  tasks: Task[];
  assets: Asset[];
  workerOnline: boolean;
};
type ImageNode = Node<
  {
    url: string | null;
    status: string;
    progress: number;
    error: string | null;
    asset: Asset | null;
    onReference: (asset: Asset) => void;
    onPreview: (asset: Asset) => void;
    onDelete: () => Promise<void>;
    onResizeStart: () => void;
    onResizeEnd: () => void;
  },
  "image"
>;
function CanvasImage({ data, selected }: NodeProps<ImageNode>) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div className={`image-node ${selected ? "selected" : ""}`}>
      {selected &&
        data.asset &&
        (["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(
          (position) => (
            <NodeResizeControl
              key={position}
              position={position}
              className="image-resize-handle nodrag nopan"
              minWidth={64}
              minHeight={64}
              maxWidth={8192}
              maxHeight={8192}
              keepAspectRatio
              onResizeStart={data.onResizeStart}
              onResizeEnd={data.onResizeEnd}
            />
          ),
        )}
      {data.url ? (
        <>
          <img
            className="node-image"
            src={data.url}
            alt="生成图片"
            draggable={false}
          />
          <div className="node-actions nodrag nopan">
            <button
              title="放大图片"
              aria-label="放大画布图片"
              onClick={(event) => {
                event.stopPropagation();
                if (data.asset) data.onPreview(data.asset);
              }}
            >
              <Expand size={15} />
            </button>
            <button
              title="设为参考图"
              aria-label="设为参考图"
              onClick={(e) => {
                e.stopPropagation();
                if (data.asset) data.onReference(data.asset);
              }}
            >
              <ImagePlus size={15} />
            </button>
            <a
              aria-label="下载图片"
              title="下载图片"
              href={`/api/assets/${data.asset?.id}/content?download=1`}
            >
              <Download size={15} />
            </a>
          </div>
        </>
      ) : (
        <div
          className={`generation-placeholder ${data.status === "failed" || data.status === "submission_unknown" ? "generation-failed" : ""}`}
        >
          <span>
            {data.status === "failed"
              ? "生成失败"
              : data.status === "submission_unknown"
                ? "受理状态待核对"
                : data.status === "saving"
                  ? "正在保存图片"
                  : "Generating"}
            {!["failed", "submission_unknown"].includes(data.status) && (
              <LoaderCircle size={13} className="spin" />
            )}
          </span>
          {data.error && <small>{data.error}</small>}
          {data.status === "failed" && (
            <div className="node-actions nodrag nopan">
              <button
                title="删除失败占位（Delete / Backspace）"
                aria-label="删除失败占位"
                disabled={deleting}
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleting(true);
                  void data.onDelete().finally(() => setDeleting(false));
                }}
              >
                {deleting ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Trash2 size={15} />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const nodeTypes = { image: CanvasImage };
export function Workspace({ projectId }: { projectId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<ImageNode>([]);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState(false);
  const [saveState, setSaveState] = useState("已保存");
  const [reference, setReference] = useState<Asset | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [panelWidth, setPanelWidth] = useState(360);
  const [tab, setTab] = useState<"canvas" | "chat">("chat");
  const [dragMode, setDragMode] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [lightbox, setLightbox] = useState<Asset | null>(null);
  const flow = useRef<ReactFlowInstance<ImageNode>>(null);
  const version = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const conflict = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messages = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
  const sendKey = useRef<{ body: string; key: string } | null>(null);
  const previousTaskCount = useRef(0);
  const firstFit = useRef(false);
  const fetching = useRef(false);
  const configSave = useRef<Promise<unknown>>(Promise.resolve());
  const resizing = useRef(false);
  const resizeSave = useRef<() => void>(() => {});
  const deletedNodes = useRef(new Set<string>());
  const deletingNodes = useRef(new Set<string>());
  const deleteFailedNode = useCallback(
    async (nodeId: string) => {
      if (deletingNodes.current.has(nodeId) || deletedNodes.current.has(nodeId))
        return;
      deletingNodes.current.add(nodeId);
      try {
        await api(`projects/${projectId}/nodes/${nodeId}`, {
          method: "DELETE",
        });
        deletedNodes.current.add(nodeId);
        setNodes((old) => old.filter((node) => node.id !== nodeId));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        deletingNodes.current.delete(nodeId);
      }
    },
    [projectId, setNodes],
  );
  const chooseReference = useCallback((asset: Asset) => {
    if (asset.bytes > 10000000) {
      setError("这张图片超过 10MB，无法用作参考图");
      return;
    }
    setReference({ ...asset });
    setChoosing(false);
    setTab("chat");
  }, []);
  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const data = await api<Snapshot>(`projects/${projectId}`);
      setSnapshot(data);
      setError("");
      const canSync =
        !dirty.current &&
        !saving.current &&
        !conflict.current &&
        !resizing.current;
      const remoteChanged = canSync && version.current !== data.project.version;
      if (canSync) {
        version.current = data.project.version;
      }
      if (remoteChanged) void flow.current?.setViewport(data.project.viewport);
      setNodes((old) =>
        data.nodes
          .filter((node) => !deletedNodes.current.has(node.id))
          .map((node) => {
            const existing = old.find((n) => n.id === node.id);
            const preserveSize =
              !canSync && existing?.data.asset?.id === node.asset_id;
            return {
              id: node.id,
              type: "image",
              position:
                !remoteChanged && existing
                  ? existing.position
                  : { x: node.x, y: node.y },
              selected: existing?.selected,
              width: preserveSize
                ? (existing?.width ?? node.width)
                : node.width,
              height: preserveSize
                ? (existing?.height ?? node.height)
                : node.height,
              resizing: existing?.resizing,
              data: {
                url: node.url,
                status: node.status,
                progress: node.progress,
                error: node.error,
                asset: data.assets.find((a) => a.id === node.asset_id) || null,
                onReference: chooseReference,
                onPreview: setLightbox,
                onDelete: () => deleteFailedNode(node.id),
                onResizeStart: () => {
                  resizing.current = true;
                  dirty.current = true;
                  setSaveState("待保存");
                },
                onResizeEnd: () => {
                  resizing.current = false;
                  resizeSave.current();
                },
              },
            };
          }),
      );
      if (data.tasks.length !== previousTaskCount.current) {
        messages.current?.scrollTo({
          top: messages.current.scrollHeight,
          behavior: "smooth",
        });
        previousTaskCount.current = data.tasks.length;
      }
      if (
        !firstFit.current &&
        data.nodes.some((n) => n.asset_id) &&
        data.project.version === 0
      ) {
        firstFit.current = true;
        setTimeout(
          () => void flow.current?.fitView({ padding: 0.3, maxZoom: 1 }),
          150,
        );
      }
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 404) setFatal(true);
    } finally {
      fetching.current = false;
    }
  }, [projectId, setNodes, chooseReference, deleteFailedNode]);
  const agent = useAgentConversation(projectId, load);
  const startedFromHome = useRef(false);
  useEffect(() => {
    if (!agent.ready || startedFromHome.current) return;
    startedFromHome.current = true;
    const key = `agent-start:${projectId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    sessionStorage.removeItem(key);
    try {
      const input = JSON.parse(raw);
      void agent.send(input.prompt, input.attachments, input.skill);
    } catch {
      setError("首页草稿读取失败，请重新发送");
    }
  }, [agent, projectId]);
  useLayoutEffect(() => {
    const element = messages.current;
    if (element && followConversation.current)
      element.scrollTop = element.scrollHeight;
  }, [agent.runs]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    messages.current?.scrollTo({
      top: messages.current.scrollHeight,
      behavior: "smooth",
    });
  }, [snapshot?.tasks.length]);
  useEffect(() => {
    const width = Number(localStorage.getItem("canvas-panel-width"));
    if (width >= 320 && width <= 620) setPanelWidth(width);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChoosing(false);
        setLightbox(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);
  async function save() {
    if (!flow.current || !dirty.current || conflict.current || resizing.current)
      return;
    if (saving.current) {
      saveTimer.current = setTimeout(() => void save(), 600);
      return;
    }
    saving.current = true;
    dirty.current = false;
    setSaveState("正在保存…");
    try {
      const result = await api<{ version: number }>(
        `projects/${projectId}/canvas`,
        {
          method: "PUT",
          body: JSON.stringify({
            version: version.current,
            viewport: flow.current.getViewport(),
            nodes: flow.current.getNodes().map((n) => ({
              id: n.id,
              x: n.position.x,
              y: n.position.y,
              ...(n.data.asset ? { width: n.width, height: n.height } : {}),
            })),
          }),
        },
      );
      version.current = result.version;
      setSaveState("已保存");
    } catch (e) {
      dirty.current = true;
      setSaveState("未保存");
      if (e instanceof ApiError && e.status === 409) conflict.current = true;
      setError((e as Error).message);
    } finally {
      saving.current = false;
      if (dirty.current && !conflict.current && saveState !== "未保存")
        saveTimer.current = setTimeout(() => void save(), 1500);
    }
  }
  function scheduleSave() {
    dirty.current = true;
    setSaveState("待保存");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 600);
  }
  resizeSave.current = scheduleSave;
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  function resize(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget;
    const move = (event: PointerEvent) => {
      const width = Math.max(
        320,
        Math.min(620, window.innerWidth - event.clientX),
      );
      setPanelWidth(width);
      localStorage.setItem("canvas-panel-width", String(width));
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }
  async function send(input: GenerationInput) {
    const body = JSON.stringify(input);
    if (sendKey.current?.body !== body)
      sendKey.current = { body, key: crypto.randomUUID() };
    await api(`projects/${projectId}/generations`, {
      method: "POST",
      headers: { "Idempotency-Key": sendKey.current!.key },
      body,
    });
    sendKey.current = null;
    await load();
  }
  function saveConfig(config: ModelConfig) {
    configSave.current = configSave.current
      .catch(() => {})
      .then(() =>
        api(`projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify({ config }),
        }),
      )
      .catch((e) => setError((e as Error).message));
  }
  async function rename() {
    if (!snapshot) return;
    const name = window.prompt("项目名称", snapshot.project.name)?.trim();
    if (name && name !== snapshot.project.name) {
      try {
        await api(`projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  if (fatal)
    return (
      <main className="workspace-error">
        <h1>项目不存在或无法访问</h1>
        <Link href="/projects">返回项目列表</Link>
      </main>
    );
  if (!snapshot)
    return (
      <main className="workspace-error">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void load()}>重试</button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <span>正在打开画布…</span>
          </>
        )}
      </main>
    );
  const busy =
    agent.busy ||
    !agent.ready ||
    (snapshot.project.agent_lease_until
      ? Date.parse(snapshot.project.agent_lease_until) > Date.now()
      : false) ||
    snapshot.tasks.some((t) => activeStates.includes(t.status));
  return (
    <main
      className="workspace"
      style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
    >
      <div className="mobile-tabs">
        <button
          aria-pressed={tab === "canvas"}
          onClick={() => setTab("canvas")}
        >
          画布
        </button>
        <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>
          对话
        </button>
      </div>
      <section
        className={`canvas-area ${tab === "canvas" ? "mobile-active" : ""}`}
        aria-label="项目画布"
        tabIndex={0}
        onCopy={(event) => {
          if (
            (event.target as Element).closest(
              'input,textarea,[contenteditable="true"]',
            )
          )
            return;
          const copies = nodes
            .filter((n) => n.selected && n.data.asset)
            .map((n) => ({
              assetId: n.data.asset!.id,
              x: n.position.x + 32,
              y: n.position.y + 32,
            }));
          if (copies.length) {
            event.preventDefault();
            event.clipboardData.setData(
              "application/x-ai-canvas",
              JSON.stringify(copies),
            );
          }
        }}
        onPaste={(event) => {
          if (
            (event.target as Element).closest(
              'input,textarea,[contenteditable="true"]',
            )
          )
            return;
          const raw = event.clipboardData.getData("application/x-ai-canvas");
          if (!raw) return;
          event.preventDefault();
          try {
            const copies = JSON.parse(raw) as {
              assetId: string;
              x: number;
              y: number;
            }[];
            if (!Array.isArray(copies) || copies.length > 100) return;
            void Promise.all(
              copies.map((copy) =>
                api(`projects/${projectId}/nodes`, {
                  method: "POST",
                  body: JSON.stringify(copy),
                }),
              ),
            )
              .then(load)
              .catch((e) => setError(e.message));
          } catch {
            setError("无法粘贴画布素材");
          }
        }}
        onKeyDownCapture={(event) => {
          if (
            choosing ||
            event.repeat ||
            event.nativeEvent.isComposing ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            !["Delete", "Backspace"].includes(event.key)
          )
            return;
          if (
            event.target instanceof Element &&
            event.target.closest(
              'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
            )
          )
            return;
          const selected = nodes.filter(
            (node) =>
              node.selected &&
              (node.data.asset || node.data.status === "failed"),
          );
          if (!selected.length) return;
          event.preventDefault();
          selected.forEach((node) => void deleteFailedNode(node.id));
        }}
      >
        <ReactFlow<ImageNode>
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          edgesFocusable={false}
          nodesFocusable={!choosing}
          panOnDrag={dragMode ? true : [1, 2]}
          selectionOnDrag={!dragMode}
          minZoom={0.05}
          maxZoom={5}
          defaultViewport={snapshot.project.viewport}
          onInit={(instance) => {
            flow.current = instance;
            setZoom(Math.round(instance.getViewport().zoom * 100));
          }}
          onNodeDragStop={scheduleSave}
          onMoveEnd={(event, viewport) => {
            setZoom(Math.round(viewport.zoom * 100));
            if (event) scheduleSave();
          }}
          onNodeClick={(_, node) => {
            if (node.data.asset) chooseReference(node.data.asset);
          }}
          onNodeDoubleClick={(_, node) => {
            if (node.data.asset && !choosing) setLightbox(node.data.asset);
          }}
          deleteKeyCode={null}
        ></ReactFlow>
        <header className="canvas-header">
          <Link href="/protected" title="返回首页">
            <Brand compact />
          </Link>
          <button className="project-title" onClick={() => void rename()}>
            {snapshot.project.name}
            <ChevronDown size={12} />
          </button>
          <span className="save-state">
            {saveState === "已保存" ? <Check size={12} /> : null}
            {saveState}
          </span>
        </header>
        {!nodes.length && (
          <div className="canvas-empty">
            输入你的想法开始创作，或在右侧添加参考图
          </div>
        )}
        {choosing && (
          <div className="canvas-selection-banner">
            <MousePointer2 size={16} />
            点击画布中的图片作为参考图
            <button
              className="icon-button"
              aria-label="取消选择"
              onClick={() => setChoosing(false)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="canvas-tools">
          <button
            aria-label="选择工具"
            title="选择工具"
            aria-pressed={!dragMode}
            onClick={() => setDragMode(false)}
          >
            <MousePointer2 size={17} />
          </button>
          <button
            aria-label="平移工具"
            title="平移工具"
            aria-pressed={dragMode}
            onClick={() => setDragMode(true)}
          >
            <Hand size={17} />
          </button>
          <span className="tool-divider" />
          <button
            aria-label="缩小"
            onClick={() => {
              void flow.current?.zoomOut();
              scheduleSave();
            }}
          >
            <Minus size={16} />
          </button>
          <span className="zoom-label">{zoom}%</span>
          <button
            aria-label="放大"
            onClick={() => {
              void flow.current?.zoomIn();
              scheduleSave();
            }}
          >
            <Plus size={16} />
          </button>
          <button
            aria-label="适配全部图片"
            title="适配全部图片"
            onClick={() => {
              void flow.current?.fitView({ padding: 0.2, maxZoom: 1 });
              setTimeout(scheduleSave, 100);
            }}
          >
            <Maximize size={16} />
          </button>
        </div>
      </section>
      <div
        className="panel-resizer"
        role="separator"
        tabIndex={0}
        aria-label="调整对话面板宽度"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={620}
        aria-valuenow={panelWidth}
        onPointerDown={resize}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const width = Math.max(
              320,
              Math.min(620, panelWidth + (e.key === "ArrowLeft" ? 20 : -20)),
            );
            setPanelWidth(width);
            localStorage.setItem("canvas-panel-width", String(width));
          }
        }}
      />
      <aside
        className={`chat-panel ${tab === "chat" ? "mobile-active" : ""}`}
        aria-label="生成对话"
      >
        <header className="chat-header">
          <strong>
            {snapshot.tasks.length
              ? snapshot.tasks.at(-1)?.prompt.slice(0, 18)
              : "新对话"}
          </strong>
          <Link href="/projects" title="全部项目" aria-label="全部项目">
            <ArrowLeft size={16} />
          </Link>
        </header>
        {!snapshot.workerOnline && (
          <div className="worker-notice" role="status">
            生成工作进程未连接，已提交任务会在连接后继续。
          </div>
        )}
        <div
          className="chat-messages"
          ref={messages}
          onScroll={(event) => {
            const element = event.currentTarget;
            followConversation.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              80;
          }}
        >
          {agent.historyError && (
            <p className="inline-error" role="alert">
              {agent.historyError}
              <button onClick={() => void agent.reload()}>重试</button>
            </p>
          )}
          {!snapshot.tasks.length && !agent.runs.length && (
            <div className="chat-empty">
              <MessageSquare size={22} strokeWidth={1} />
              <span>开始创作</span>
            </div>
          )}
          {[
            ...agent.runs.map((run) => ({
              kind: "agent" as const,
              run,
              createdAt: run.createdAt,
            })),
            ...snapshot.tasks.map((task) => ({
              kind: "task" as const,
              task,
              createdAt: task.createdAt,
            })),
          ]
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
            .map((entry) => {
              if (entry.kind === "agent")
                return (
                  <AgentMessages
                    key={entry.run.id}
                    runs={[entry.run]}
                    assets={snapshot.assets}
                    projectId={projectId}
                  />
                );
              const task = entry.task;
              return (
                <article className="generation-message" key={task.id}>
                  {task.config.model !== "gpt-image-2.5-sunburst" && (
                    <div className="agent-user-message">
                      {(task.attachmentIds?.length
                        ? task.attachmentIds
                        : task.referenceAssetIds?.length
                          ? task.referenceAssetIds
                          : task.referenceAssetId
                            ? [task.referenceAssetId]
                            : []
                      ).map((id) => (
                        <Attachment
                          key={id}
                          projectId={projectId}
                          asset={
                            snapshot.assets.find((a) => a.id === id) || {
                              id,
                              url: `/api/assets/${id}/content`,
                              width: 0,
                              height: 0,
                              bytes: 0,
                            }
                          }
                        />
                      ))}
                      <p className="message-prompt">{task.prompt}</p>
                    </div>
                  )}
                  <div className="message-meta">
                    <ModelIcon model={task.config.model} size={12} />
                    <span>
                      {task.config.model === "gpt-image-2.5-sunburst"
                        ? "GPT Image 2.5"
                        : task.config.model === "gpt-image-2"
                          ? "GPT Image2"
                          : "Nano Banana 2.1"}
                    </span>
                    <span>{summary(task.config)}</span>
                  </div>
                  {activeStates.includes(task.status) &&
                    !["submission_unknown"].includes(task.status) && (
                      <div className="message-placeholder skeleton">
                        <LoaderCircle size={17} className="spin" />
                        <small>
                          {task.status === "saving"
                            ? "正在保存"
                            : task.progress
                              ? `${task.progress}%`
                              : "生成中"}
                        </small>
                      </div>
                    )}
                  <div className="message-results">
                    {task.results.map((result) => (
                      <div key={result.assetId}>
                        <button
                          className="result-preview"
                          title="定位到画布"
                          onClick={() => {
                            const node = nodes.find(
                              (n) => n.data.asset?.id === result.assetId,
                            );
                            if (node) {
                              setTab("canvas");
                              void flow.current?.fitView({
                                nodes: [node],
                                padding: 0.5,
                                maxZoom: 1,
                                duration: 300,
                              });
                            }
                          }}
                        >
                          <img src={result.url} alt="生成结果" />
                        </button>
                        <div className="message-actions">
                          <button
                            title="设为参考图"
                            aria-label="将结果设为参考图"
                            onClick={() => {
                              const asset = snapshot.assets.find(
                                (a) => a.id === result.assetId,
                              );
                              if (asset) chooseReference(asset);
                            }}
                          >
                            <ImagePlus size={14} />
                          </button>
                          <a
                            title="下载"
                            aria-label="下载生成图片"
                            href={`/api/assets/${result.assetId}/content?download=1`}
                          >
                            <Download size={14} />
                          </a>
                          <button
                            title="查看大图"
                            aria-label="查看大图"
                            onClick={() => {
                              const asset = snapshot.assets.find(
                                (a) => a.id === result.assetId,
                              );
                              if (asset) setLightbox(asset);
                            }}
                          >
                            <Expand size={14} />
                          </button>
                          <button
                            title="再次生成，会创建新任务"
                            aria-label="再次生成"
                            disabled={busy}
                            onClick={() =>
                              void send({
                                prompt: task.prompt,
                                referenceAssetId: task.referenceAssetId,
                                referenceAssetIds: task.referenceAssetIds,
                                attachmentIds: task.attachmentIds,
                                config: task.config,
                              }).catch((e) => setError(e.message))
                            }
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {task.error && (
                    <p className="task-error" role="status">
                      {task.error}
                    </p>
                  )}
                  {task.status === "failed" && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void api(`generations/${task.id}/retry`, {
                          method: "POST",
                          headers: { "Idempotency-Key": crypto.randomUUID() },
                          body: "{}",
                        })
                          .then(load)
                          .catch((e) => setError(e.message))
                      }
                    >
                      <RefreshCw size={13} />
                      重新生成
                    </button>
                  )}
                </article>
              );
            })}{" "}
        </div>
        <div className="chat-composer">
          {error && (
            <p className="inline-error" role="alert">
              {error}
              {conflict.current ? (
                <button onClick={() => window.location.reload()}>
                  刷新画布
                </button>
              ) : (
                <button onClick={() => setError("")}>关闭</button>
              )}
            </p>
          )}
          <Composer
            projectId={projectId}
            initialConfig={snapshot.project.config}
            selectedReference={reference}
            busy={busy}
            onChooseCanvas={() => {
              if (!nodes.some((node) => node.data.asset)) {
                setError("画布上还没有可选择的图片");
                return;
              }
              setChoosing(true);
              setTab("canvas");
            }}
            onConfig={saveConfig}
            onSend={send}
            onAgentSend={agent.send}
            onUpload={() => void load()}
          />
        </div>
      </aside>
      {lightbox && (
        <ImagePreview
          key={lightbox.id}
          asset={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </main>
  );
}
