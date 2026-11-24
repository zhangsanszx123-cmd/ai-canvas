"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Plus,
  ImagePlus,
  Image as ImageIcon,
  X,
  ChevronDown,
  Upload,
  MousePointer2,
  LoaderCircle,
} from "lucide-react";
import OpenAI from "@lobehub/icons/es/OpenAI";
import { Attachment } from "./attachment";
import { SkillPicker } from "./skill-picker";
import type { Skill } from "@/lib/client-api";
import NanoBanana from "@lobehub/icons/es/NanoBanana";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { api, type Asset } from "@/lib/client-api";
import {
  defaultConfig,
  AGENT_IMAGE_MODEL,
  GPT_MODEL,
  NANO_MODEL,
  ratios,
  gptPresets,
  dimensions,
  summary,
  type ModelConfig,
  type GenerationInput,
} from "@/lib/models";

export function ModelIcon({
  model,
  size = 17,
}: {
  model: string;
  size?: number;
}) {
  return model === NANO_MODEL ? (
    <NanoBanana size={size} />
  ) : (
    <OpenAI size={size} />
  );
}
type Props = {
  projectId?: string;
  ensureProject?: () => Promise<string>;
  initialConfig?: ModelConfig;
  busy?: boolean;
  selectedReference?: Asset | null;
  onChooseCanvas?: () => void;
  onConfig?: (c: ModelConfig) => void;
  onSend: (input: GenerationInput) => Promise<void>;
  onAgentSend?: (
    prompt: string,
    attachments: Asset[],
    skill?: Skill | null,
  ) => Promise<void>;
  onUpload?: () => void;
};
export function Composer({
  projectId,
  ensureProject,
  initialConfig = defaultConfig,
  busy,
  onChooseCanvas,
  onSend,
  onConfig,
  selectedReference,
  onAgentSend,
  onUpload,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [attachments, setAttachments] = useState<Asset[]>([]);
  const [mode, setMode] = useState<"agent" | "image">(
    onAgentSend ? "agent" : "image",
  );
  const reference = attachments.find((a) => a.mime !== "text/markdown");
  const [config, setConfig] = useState<ModelConfig>(
    initialConfig.model === AGENT_IMAGE_MODEL ? defaultConfig : initialConfig,
  );
  const [panel, setPanel] = useState<"model" | "config" | "upload" | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const [skillUploading, setSkillUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const uploadingBatch = useRef(false);
  const sendingRequest = useRef(false);
  const saved = useRef<Record<string, ModelConfig>>({
    [initialConfig.model]: initialConfig,
  });
  useLayoutEffect(() => {
    const element = popover.current;
    if (!panel || !element) return;
    element.showPopover();
    const position = () => {
      const anchor = toolbar.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 8;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const right = left + (viewport?.width ?? window.innerWidth) - 16;
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
      const above = Math.max(0, anchor.top - top - 8);
      const below = Math.max(0, bottom - anchor.bottom - 8);
      const openAbove =
        above >= Math.min(element.scrollHeight, 620) || above >= below;
      element.style.maxWidth = `${right - left}px`;
      element.style.minWidth = `${Math.min(panel === "model" ? 250 : 175, right - left)}px`;
      element.style.maxHeight = `${Math.min(620, openAbove ? above : below)}px`;
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(left, Math.min(anchor.left, right - bounds.width))}px`;
      element.style.top = `${openAbove ? anchor.top - 8 - bounds.height : anchor.bottom + 8}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      if (element.matches(":popover-open")) element.hidePopover();
    };
  }, [panel, config.model]);
  useEffect(() => {
    if (selectedReference) {
      setAttachments((old) =>
        old.some((a) => a.id === selectedReference.id)
          ? old
          : [...old, selectedReference],
      );
      setError("");
    }
  }, [selectedReference]);
  useEffect(() => {
    const click = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node))
        setPanel(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", key);
    };
  }, []);
  function update(next: ModelConfig) {
    setConfig(next);
    saved.current[next.model] = next;
    onConfig?.(next);
  }
  async function upload(image: File) {
    if (image.size > 10000000) {
      setError("图片不能超过 10MB");
      return;
    }
    setError("");
    try {
      const form = new FormData();
      form.set("file", image);
      const uploadProject = projectId || (await ensureProject?.());
      if (uploadProject) form.set("projectId", uploadProject);
      const asset = await api<Asset>("uploads", { method: "POST", body: form });
      setAttachments((old) => [...old, { ...asset, filename: image.name }]);
      onUpload?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (file.current) file.current.value = "";
    }
  }
  async function uploadFiles(files: File[]) {
    if (uploadingBatch.current || busy || sendingRequest.current) return;
    uploadingBatch.current = true;
    setUploading(true);
    try {
      for (const item of files.slice(0, 15 - attachments.length))
        await upload(item);
    } finally {
      uploadingBatch.current = false;
      setUploading(false);
    }
  }
  async function send() {
    if (
      !prompt.trim() ||
      skillUploading ||
      uploadingBatch.current ||
      busy ||
      sendingRequest.current
    )
      return;
    sendingRequest.current = true;
    setSending(true);
    setError("");
    const sentPrompt = prompt.trim();
    const sentAttachments = attachments;
    const sentSkill = selectedSkill;
    setPrompt("");
    setAttachments([]);
    setSelectedSkill(null);
    setPanel(null);
    try {
      if (mode === "agent" && onAgentSend)
        await onAgentSend(sentPrompt, sentAttachments, sentSkill);
      else
        await onSend({
          prompt: sentPrompt,
          referenceAssetId: reference?.id,
          attachmentIds: sentAttachments.map((a) => a.id),
          config,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sendingRequest.current = false;
      setSending(false);
    }
  }
  const nano = config.model === NANO_MODEL;
  const px = dimensions(config);
  return (
    <div className="composer-wrapper" ref={root}>
      <div
        className="composer"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading && !busy)
            void uploadFiles(Array.from(e.dataTransfer.files));
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            if (!uploading && !busy) void uploadFiles(files);
          }
        }}
      >
        <div className="reference-row">
          {attachments.map((attachment, index) => (
            <div
              className={
                attachment.mime === "text/markdown"
                  ? "attachment-card"
                  : "reference-thumb"
              }
              key={attachment.id}
            >
              <Attachment
                asset={attachment}
                projectId={projectId}
                label={`图${attachments.slice(0, index + 1).filter((a) => a.mime !== "text/markdown").length}`}
              />
              {attachment.mime !== "text/markdown" && (
                <span className="reference-number">
                  图
                  {["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][
                    attachments
                      .slice(0, index + 1)
                      .filter((a) => a.mime !== "text/markdown").length - 1
                  ] ||
                    attachments
                      .slice(0, index + 1)
                      .filter((a) => a.mime !== "text/markdown").length}
                </span>
              )}
              <button
                aria-label="移除参考图"
                onClick={() =>
                  setAttachments((old) =>
                    old.filter((a) => a.id !== attachment.id),
                  )
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {(projectId || ensureProject) && (
            <button
              className="reference-trigger"
              onClick={() => setPanel(panel === "upload" ? null : "upload")}
              disabled={uploading}
            >
              <ImagePlus size={17} />
              <span>{uploading ? "上传中" : "附件"}</span>
            </button>
          )}
          {(projectId || ensureProject) && onAgentSend && mode === "agent" && (
            <SkillPicker
              projectId={projectId}
              ensureProject={ensureProject}
              selected={selectedSkill}
              onBusy={setSkillUploading}
              onSelect={setSelectedSkill}
              disabled={busy || uploading || skillUploading || sending}
            />
          )}
          {selectedSkill && mode === "agent" && (
            <button
              className="selected-skill"
              onClick={() => setSelectedSkill(null)}
              aria-label="取消本次 Skill"
            >
              {selectedSkill.name}
              <X size={12} />
            </button>
          )}
        </div>
        <textarea
          ref={textarea}
          aria-label="生图提示词"
          placeholder={
            projectId
              ? "今天我们要创作什么"
              : "描述你的想法，让 AI Canvas 帮你实现…"
          }
          value={prompt}
          maxLength={32000}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-toolbar" ref={toolbar}>
          <div className="composer-options">
            {onAgentSend && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="model-trigger"
                    aria-label="选择创作模式"
                    disabled={busy || uploading || skillUploading || sending}
                  >
                    {mode === "agent" ? "Agent" : "生图"}
                    <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  avoidCollisions={false}
                >
                  <DropdownMenuRadioGroup
                    value={mode}
                    onValueChange={(value) => {
                      setMode(value as "agent" | "image");
                      setPanel(null);
                    }}
                  >
                    <DropdownMenuRadioItem value="agent">
                      Agent
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="image">
                      生图
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {mode === "agent" ? (
              <span className="agent-auto">Agent自动规划</span>
            ) : (
              <>
                {!projectId && !ensureProject && (
                  <button
                    className="icon-button"
                    title="上传一张参考图"
                    aria-label="上传参考图"
                    disabled={uploading}
                    onClick={() => file.current?.click()}
                  >
                    {uploading ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Plus size={20} />
                    )}
                  </button>
                )}
                <button
                  className="model-trigger"
                  aria-label="选择生图模型"
                  onClick={() => setPanel(panel === "model" ? null : "model")}
                >
                  <ModelIcon model={config.model} />
                  <span>{nano ? "Nano Banana" : "GPT Image2"}</span>
                  <ChevronDown size={12} />
                </button>
                <button
                  className="config-trigger"
                  aria-label="配置图片参数"
                  onClick={() => setPanel(panel === "config" ? null : "config")}
                >
                  {summary(config)}
                  <ChevronDown size={12} />
                </button>
              </>
            )}
          </div>
          <button
            className="send-button"
            aria-label="发送并生成图片"
            disabled={
              !prompt.trim() || uploading || skillUploading || busy || sending
            }
            onClick={() => void send()}
          >
            {sending ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowUp size={19} />
            )}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,.md,.markdown"
          multiple
          onChange={(e) => {
            if (e.target.files) void uploadFiles(Array.from(e.target.files));
          }}
        />
      </div>
      {panel === "upload" && (
        <div
          ref={popover}
          popover="manual"
          className="composer-popover upload-menu"
        >
          <button
            onClick={() => {
              setPanel(null);
              file.current?.click();
            }}
          >
            <Upload size={15} />
            上传图片或 Markdown
          </button>
          {onChooseCanvas && (
            <button
              onClick={() => {
                setPanel(null);
                onChooseCanvas();
              }}
            >
              <MousePointer2 size={15} />
              从画布选择
            </button>
          )}
        </div>
      )}
      {panel === "model" && (
        <div
          ref={popover}
          popover="manual"
          className="composer-popover model-menu"
        >
          {[GPT_MODEL, NANO_MODEL].map((model) => (
            <button
              key={model}
              aria-pressed={config.model === model}
              onClick={() => {
                update(
                  saved.current[model] || {
                    ...defaultConfig,
                    model: model as ModelConfig["model"],
                  },
                );
                setPanel(null);
              }}
            >
              <ModelIcon model={model} size={20} />
              <div>
                <strong>
                  {model === GPT_MODEL ? "GPT Image2" : "Nano Banana 2.1"}
                </strong>
                <small>
                  {model === GPT_MODEL
                    ? "精准构图与文字表达"
                    : "快速生成与参考图编辑"}
                </small>
              </div>
              {config.model === model && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
      {panel === "config" && (
        <div
          ref={popover}
          popover="manual"
          className="composer-popover config-card"
          role="dialog"
          aria-label={nano ? "Nano Banana 图片配置" : "GPT Image2 图片配置"}
        >
          {!nano && (
            <>
              <label>质量</label>
              <div
                className="segmented muted-control"
                title="当前接口未提供质量参数"
              >
                {["自动", "高", "中", "低"].map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <small className="config-note">当前接口暂不支持质量调整</small>
              <label>尺寸</label>
              <div className="pixel-row">
                <span>W&nbsp; {px?.[0] ?? "自动"}</span>
                <span>×</span>
                <span>H&nbsp; {px?.[1] ?? "自动"}</span>
              </div>
            </>
          )}
          <label>分辨率</label>
          <div className="segmented">
            {(["1k", "2k", "4k"] as const).map((r) => (
              <button
                key={r}
                aria-pressed={config.resolution === r}
                onClick={() => update({ ...config, resolution: r })}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
          <label>图片比例</label>
          <div className="ratio-grid">
            {(nano ? ratios : gptPresets).map((size) => {
              const selected = config.size === size;
              return (
                <button
                  key={size}
                  aria-pressed={selected}
                  onClick={() =>
                    update({
                      ...config,
                      size,
                    })
                  }
                >
                  <span className="ratio-preview">
                    <ImageIcon size={17} strokeWidth={1} />
                  </span>
                  <span>{size}</span>
                </button>
              );
            })}
          </div>
          {!nano && (
            <>
              <label>Image</label>
              <div className="count-grid">
                {Array.from({ length: 10 }, (_, i) => (
                  <button
                    key={i}
                    disabled={i > 0}
                    aria-pressed={i === 0}
                    title={i > 0 ? "待供应商确认数量上限" : "生成一张图片"}
                  >
                    {i + 1} img
                  </button>
                ))}
              </div>
              <small className="config-note">当前启用单张生成</small>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {busy && (
        <p className="composer-hint">
          当前项目正在生成，你可以先编辑下一条提示词。
        </p>
      )}
    </div>
  );
}
