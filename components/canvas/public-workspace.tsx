"use client";
import { imageDisplayUrl } from "@/lib/image-display";
/* eslint-disable @next/next/no-img-element -- Public image URLs redirect to signed storage URLs. */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  useNodesState,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  ChevronDown,
  Home,
  FolderOpen,
  MousePointer2,
  Hand,
  Minus,
  Plus,
  Maximize,
  Download,
  Expand,
  RefreshCw,
  ImagePlus,
} from "lucide-react";
import type { PublicProject } from "@/lib/public-projects";
import type { Asset } from "@/lib/client-api";
import { summary } from "@/lib/models";
import { ImagePreview } from "./image-preview";
import { ImageToolbar } from "./image-toolbar";
import { Composer, ModelIcon } from "./composer";
import { Brand } from "./brand";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type PublicImage = Node<{ asset: Asset }, "publicImage">;
function CanvasImage({ data, selected }: NodeProps<PublicImage>) {
  return (
    <div className={"image-node" + (selected ? " selected" : "")}>
      <img
        className="node-image"
        src={imageDisplayUrl(data.asset.url)}
        decoding="async"
        alt="项目画布图片"
        draggable={false}
      />
    </div>
  );
}
const nodeTypes = { publicImage: CanvasImage };
export function PublicWorkspace({
  data,
  authenticated = false,
}: {
  data: PublicProject;
  authenticated?: boolean;
}) {
  const [preview, setPreview] = useState<Asset | null>(null);
  const [tab, setTab] = useState<"canvas" | "chat">("canvas");
  const [pan, setPan] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [notice, setNotice] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<PublicImage>>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<PublicImage>([]);
  const requireEdit = useCallback(() => {
    if (authenticated) {
      setNotice("这是其他用户的项目，只有项目创建者可以编辑。");
      return;
    }
    window.location.assign(
      "/auth/login?next=" +
        encodeURIComponent("/canvas?projectId=" + data.project.id),
    );
  }, [authenticated, data.project.id]);
  useEffect(() => {
    setNodes((old) =>
      data.images.map((image) => ({
        id: image.id,
        type: "publicImage",
        position: { x: image.x, y: image.y },
        width: image.width,
        height: image.height,
        selected: old.find((node) => node.id === image.id)?.selected,
        data: { asset: image.asset },
      })),
    );
  }, [data, setNodes]);
  useEffect(() => {
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (container.current?.clientWidth)
          void flow.current?.fitView({ padding: 0.2, maxZoom: 1 });
      });
    });
    observer.observe(container.current!);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  const selected = nodes.filter((node) => node.selected);
  const image = selected.length === 1 ? selected[0] : null;
  return (
    <main
      className="workspace guest-workspace"
      style={{ "--panel-width": "360px" } as React.CSSProperties}
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
        ref={container}
        className={"canvas-area " + (tab === "canvas" ? "mobile-active" : "")}
        aria-label="公开项目画布"
        tabIndex={0}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) requireEdit();
        }}
        onPaste={(e) => {
          if (
            e.clipboardData.files.length ||
            e.clipboardData.getData("application/x-ai-canvas")
          ) {
            e.preventDefault();
            requireEdit();
          }
        }}
        onKeyDown={(e) => {
          if (
            (e.key === "Delete" || e.key === "Backspace") &&
            !(e.target as Element).closest("textarea,input")
          ) {
            e.preventDefault();
            requireEdit();
          }
        }}
      >
        <ReactFlow<PublicImage>
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          onInit={(instance) => {
            flow.current = instance;
            setZoom(Math.round(instance.getViewport().zoom * 100));
          }}
          onMoveEnd={(_, viewport) => setZoom(Math.round(viewport.zoom * 100))}
          onNodeDoubleClick={(_, node) => setPreview(node.data.asset)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          panOnDrag={pan ? true : [1, 2]}
          selectionOnDrag={!pan}
          minZoom={0.05}
          maxZoom={5}
        >
          {image && (
            <ImageToolbar
              key={image.id}
              node={image}
              asset={image.data.asset}
              busy={false}
              onRequireLogin={requireEdit}
              onRun={async () => requireEdit()}
              onReference={requireEdit}
              onPreview={() => setPreview(image.data.asset)}
              onDelete={requireEdit}
              downloadUrl={image.data.asset.url + "?download=1"}
            />
          )}
        </ReactFlow>
        <header className="canvas-header">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="canvas-menu-trigger" aria-label="画布菜单">
                <Brand compact />
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild>
                <Link href="/">
                  <Home size={15} />
                  返回首页
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/projects">
                  <FolderOpen size={15} />
                  项目库
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            className="project-title"
            title="登录后编辑项目"
            onClick={requireEdit}
          >
            {data.project.name}
            <ChevronDown size={12} />
          </button>
          <span className="save-state">只读浏览</span>
        </header>
        {!nodes.length && (
          <div className="canvas-empty">这个项目暂时没有画布图片</div>
        )}
        <div className="canvas-tools">
          <button
            aria-label="选择工具"
            aria-pressed={!pan}
            onClick={() => setPan(false)}
          >
            <MousePointer2 size={17} />
          </button>
          <button
            aria-label="平移工具"
            aria-pressed={pan}
            onClick={() => setPan(true)}
          >
            <Hand size={17} />
          </button>
          <span className="tool-divider" />
          <button
            aria-label="缩小"
            onClick={() => void flow.current?.zoomOut()}
          >
            <Minus size={16} />
          </button>
          <span className="zoom-label">{zoom}%</span>
          <button aria-label="放大" onClick={() => void flow.current?.zoomIn()}>
            <Plus size={16} />
          </button>
          <button
            aria-label="适配全部图片"
            onClick={() =>
              void flow.current?.fitView({ padding: 0.2, maxZoom: 1 })
            }
          >
            <Maximize size={16} />
          </button>
        </div>
      </section>
      <div className="guest-panel-divider" />
      <aside
        className={"chat-panel " + (tab === "chat" ? "mobile-active" : "")}
        aria-label="生成对话"
      >
        <header className="chat-header">
          <strong>{data.project.name}</strong>
          <Link href="/projects" title="全部项目" aria-label="全部项目">
            <ArrowLeft size={16} />
          </Link>
        </header>
        <div className="chat-messages">
          {notice && (
            <p className="inline-error" role="alert">
              {notice}
            </p>
          )}
          {data.images.map((entry) => (
            <article className="generation-message" key={entry.id}>
              {entry.actionLabel && (
                <div className="image-action-task-label">
                  图片处理 · {entry.actionLabel}
                </div>
              )}
              <div className="message-meta">
                {entry.config ? (
                  <>
                    <ModelIcon model={entry.config.model} size={12} />
                    <span>{summary(entry.config)}</span>
                  </>
                ) : (
                  <span>
                    {entry.asset.width} × {entry.asset.height}
                  </span>
                )}
              </div>
              <button
                className="guest-result-preview"
                aria-label="预览画布图片"
                onClick={() => setPreview(entry.asset)}
              >
                <img
                  src={imageDisplayUrl(entry.asset.url)}
                  decoding="async"
                  alt="项目结果图片"
                  loading="lazy"
                />
              </button>
              <div className="guest-result-actions">
                <button
                  aria-label="将结果设为参考图"
                  title="设为参考图"
                  onClick={requireEdit}
                >
                  <ImagePlus size={15} />
                </button>
                <a
                  aria-label="下载生成图片"
                  href={entry.asset.url + "?download=1"}
                >
                  <Download size={15} />
                </a>
                <button
                  aria-label="查看大图"
                  onClick={() => setPreview(entry.asset)}
                >
                  <Expand size={15} />
                </button>
                <button aria-label="再次生成" onClick={requireEdit}>
                  <RefreshCw size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="chat-composer">
          <Composer
            onRequireLogin={requireEdit}
            ensureProject={async () => {
              requireEdit();
              throw new Error("请先登录后编辑");
            }}
            onSend={async () => requireEdit()}
            onAgentSend={async () => requireEdit()}
          />
        </div>
      </aside>
      {preview && (
        <ImagePreview
          asset={preview}
          downloadUrl={preview.url + "?download=1"}
          onClose={() => setPreview(null)}
        />
      )}
    </main>
  );
}
