"use client";
import { imageDisplayUrl } from "@/lib/image-display";
/* eslint-disable @next/next/no-img-element -- The reference thumbnail uses the authenticated asset URL. */
import { useLayoutEffect, useRef, useState } from "react";
import { NodeToolbar, Position, useViewport } from "@xyflow/react";
import {
  MessageSquarePlus,
  ScanLine,
  Layers,
  ImageMinus,
  WandSparkles,
  Expand,
  Download,
  ImagePlus,
  MoreHorizontal,
  Trash2,
  ChevronDown,
  X,
  LoaderCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Asset } from "@/lib/client-api";

import { imageActionSchema, type ImageActionInput } from "@/lib/image-actions";

type Props = {
  node: {
    id: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
  };
  asset: Asset;
  sourcePrompt?: string;
  onRequireLogin?: () => void;
  downloadUrl?: string;
  busy: boolean;
  onRun: (input: ImageActionInput) => Promise<void>;
  onReference: () => void;
  onPreview: () => void;
  onDelete: () => void;
};
export function ImageToolbar({
  node,
  asset,
  sourcePrompt,
  onRequireLogin,
  downloadUrl,
  busy,
  onRun,
  onReference,
  onPreview,
  onDelete,
}: Props) {
  const viewport = useViewport();
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<"edit" | "extract" | "variant" | null>(
    null,
  );
  const [instruction, setInstruction] = useState("");
  const [variantPrompt, setVariantPrompt] = useState("");
  const [elements, setElements] = useState("");
  const [resolution, setResolution] = useState<"1k" | "2k" | "4k">("1k");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function run(action: ImageActionInput["action"]) {
    if (onRequireLogin) {
      onRequireLogin();
      return;
    }
    if (busy || inFlight.current) return;
    const parsed = imageActionSchema.safeParse({
      sourceNodeId: node.id,
      action,
      instruction:
        action === "edit"
          ? instruction
          : action === "variant"
            ? variantPrompt
            : "",
      elements:
        action === "extract"
          ? elements
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
      resolution:
        action === "edit" || action === "extract" || action === "variant"
          ? resolution
          : "1k",
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      await onRun(parsed.data);
      setEditing(null);
      setResolution("1k");
      setInstruction("");
      setVariantPrompt("");
      setElements("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }
  function append(text: string) {
    setInstruction((old) => (old.trim() ? old + "；" + text : text));
  }
  const blocked = busy || submitting;
  useLayoutEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const element of [root.current, editor.current]) {
      const canvas = element?.closest(".react-flow");
      if (!element || !canvas) continue;
      let dx = 0,
        dy = 0;
      const place = () => {
        const bounds = canvas.getBoundingClientRect();
        element.style.maxWidth = `${Math.max(160, bounds.width - 24)}px`;
        const rect = element.getBoundingClientRect();
        const left = rect.left - dx,
          top = rect.top - dy;
        dx =
          Math.max(
            bounds.left + 12,
            Math.min(left, bounds.right - rect.width - 12),
          ) - left;
        dy =
          Math.max(
            bounds.top + 64,
            Math.min(top, bounds.bottom - rect.height - 12),
          ) - top;
        element.style.transform = `translate(${dx}px,${dy}px)`;
      };
      place();
      const observer = new ResizeObserver(place);
      observer.observe(canvas);
      observer.observe(element);
      cleanups.push(() => {
        observer.disconnect();
        element.style.transform = "";
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [
    editing,
    viewport.x,
    viewport.y,
    viewport.zoom,
    node.id,
    node.position.x,
    node.position.y,
    node.width,
    node.height,
  ]);
  return (
    <>
      <NodeToolbar
        nodeId={node.id}
        isVisible
        position={Position.Top}
        offset={30}
        style={{ zIndex: 40 }}
      >
        <div
          ref={root}
          className="image-selection-toolbar nodrag nopan nowheel"
          role="toolbar"
          aria-label="图片操作"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            disabled={blocked}
            onClick={() => {
              if (onRequireLogin) {
                onRequireLogin();
                return;
              }
              setEditing(editing === "edit" ? null : "edit");
              setError("");
            }}
          >
            <MessageSquarePlus size={16} />
            快捷编辑
          </button>
          <button
            disabled={blocked}
            title="点击直接优化清晰度，默认 1K"
            onClick={() => void run("enhance")}
          >
            <ScanLine size={16} />
            变清晰
          </button>
          <button
            disabled={blocked}
            title="直接替换为纯白背景，默认 1K"
            onClick={() => void run("background")}
          >
            <ImageMinus size={16} />
            换背景
          </button>
          <button
            disabled={blocked}
            onClick={() => {
              if (onRequireLogin) {
                onRequireLogin();
                return;
              }
              setEditing(editing === "extract" ? null : "extract");
              setError("");
            }}
          >
            <Layers size={16} />
            拆分元素
          </button>
          <span className="image-toolbar-divider" aria-hidden="true" />
          <button
            disabled={blocked}
            title="编辑同款提示词后生成新图片"
            onClick={() => {
              if (editing === "variant") {
                setEditing(null);
                return;
              }
              if (onRequireLogin) {
                onRequireLogin();
                return;
              }
              if (!variantPrompt.trim())
                setVariantPrompt(
                  sourcePrompt ||
                    "参考这张图片的视觉风格、主体特点和配色，创作一张同风格的新构图，保留需要准确呈现的文字。",
                );
              setEditing("variant");
              setResolution("1k");
              setError("");
            }}
          >
            <WandSparkles size={16} />
            画同款
          </button>
          <button
            aria-label="放大画布图片"
            title="预览图片"
            onClick={onPreview}
          >
            <Expand size={16} />
          </button>
          <a
            aria-label="下载图片"
            title="下载原图"
            href={downloadUrl || `/api/assets/${asset.id}/content?download=1`}
          >
            <Download size={16} />
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="更多图片操作" title="更多操作">
                <MoreHorizontal size={18} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={blocked} onSelect={onReference}>
                <ImagePlus size={15} />
                设为参考图
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete}>
                <Trash2 size={15} />
                从画布移除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {submitting && (
            <span className="image-action-status" role="status">
              <LoaderCircle size={14} className="spin" />
              正在提交…
            </span>
          )}
          {error && !editing && (
            <p role="alert" className="image-action-error">
              {error}
            </p>
          )}
          <div className="image-toolbar-meta">
            <span>{asset.filename || "画布图片"}</span>
            <span>
              {asset.width} × {asset.height}
            </span>
          </div>
        </div>
      </NodeToolbar>
      {editing && (
        <NodeToolbar
          nodeId={node.id}
          isVisible
          position={Position.Bottom}
          offset={14}
          style={{ zIndex: 45 }}
        >
          <div
            ref={editor}
            className="image-inline-editor nodrag nopan nowheel"
            role="region"
            aria-label={
              editing === "edit"
                ? "图片快捷编辑"
                : editing === "variant"
                  ? "画同款编辑"
                  : "拆分图片元素"
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="image-editor-card">
              <header>
                <span>
                  {editing === "edit"
                    ? "快捷编辑"
                    : editing === "variant"
                      ? "画同款"
                      : "拆分元素"}
                </span>
                <button
                  aria-label="关闭图片编辑"
                  disabled={submitting}
                  onClick={() => setEditing(null)}
                >
                  <X size={15} />
                </button>
              </header>
              {editing === "variant" && (
                <div className="variant-reference">
                  <img
                    src={imageDisplayUrl(asset.url)}
                    decoding="async"
                    alt="画同款参考图"
                  />
                  <span>参考图</span>
                </div>
              )}
              <textarea
                autoFocus
                aria-label={
                  editing === "edit"
                    ? "图片编辑要求"
                    : editing === "variant"
                      ? "同款图片提示词"
                      : "需要拆分的元素"
                }
                placeholder={
                  editing === "variant"
                    ? "描述想生成的同款图片，可修改原提示词…"
                    : editing === "edit"
                      ? "描述你想要的编辑…"
                      : "每行填写一个元素，最多 4 个，例如：\n品牌标志\n产品主体\n装饰图案"
                }
                maxLength={editing === "variant" ? 31000 : 4000}
                value={
                  editing === "edit"
                    ? instruction
                    : editing === "variant"
                      ? variantPrompt
                      : elements
                }
                disabled={submitting}
                onChange={(e) =>
                  editing === "variant"
                    ? setVariantPrompt(e.target.value)
                    : editing === "edit"
                      ? setInstruction(e.target.value)
                      : setElements(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setEditing(null);
                  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void run(editing);
                  }
                }}
              />
              {error && (
                <p role="alert" className="image-action-error">
                  {error}
                </p>
              )}
              <footer>
                {editing === "variant" ? (
                  <div className="variant-settings">
                    <label className="image-editor-resolution">
                      分辨率
                      <select
                        aria-label="图片处理分辨率"
                        value={resolution}
                        disabled={blocked}
                        onChange={(e) =>
                          setResolution(e.target.value as typeof resolution)
                        }
                      >
                        <option value="1k">1K</option>
                        <option value="2k">2K</option>
                        <option value="4k">4K</option>
                      </select>
                    </label>
                    <small>1 张 · GPT Image 2.5</small>
                  </div>
                ) : (
                  <small>
                    {editing === "extract"
                      ? "独立素材图 · 原图保留"
                      : "结果作为新图片 · 原图保留"}
                  </small>
                )}
                <button
                  className="primary-button"
                  disabled={
                    blocked ||
                    !(
                      editing === "edit"
                        ? instruction
                        : editing === "variant"
                          ? variantPrompt
                          : elements
                    ).trim()
                  }
                  onClick={() => void run(editing)}
                >
                  {submitting ? "正在提交…" : "生成新图片"}
                </button>
              </footer>
            </div>
            <div className="image-editor-options">
              {editing === "edit" &&
                (
                  [
                    [
                      "配色方案",
                      ["使用温暖的配色", "使用冷色调配色", "改为黑白配色"],
                    ],
                    [
                      "文字质感",
                      [
                        "将文字改为金属质感",
                        "将文字改为浮雕质感",
                        "将文字改为印刷质感",
                      ],
                    ],
                    [
                      "背景环境",
                      [
                        "背景改为摄影棚",
                        "背景改为夏日草坪",
                        "背景改为城市街景",
                      ],
                    ],
                  ] as const
                ).map(([label, items]) => (
                  <DropdownMenu key={label}>
                    <DropdownMenuTrigger asChild>
                      <button disabled={blocked}>
                        {label}
                        <ChevronDown size={12} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {items.map((item) => (
                        <DropdownMenuItem
                          key={item}
                          onSelect={() => append(item)}
                        >
                          {item}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
              {editing !== "variant" && (
                <label className="image-editor-resolution">
                  分辨率
                  <select
                    aria-label="图片处理分辨率"
                    value={resolution}
                    disabled={blocked}
                    onChange={(e) =>
                      setResolution(e.target.value as typeof resolution)
                    }
                  >
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                  </select>
                </label>
              )}
            </div>
          </div>
        </NodeToolbar>
      )}
    </>
  );
}
