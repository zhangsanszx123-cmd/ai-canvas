"use client";
import { useRef, useState } from "react";
import { api, type Skill } from "@/lib/client-api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { BookOpen, Upload, Trash2, Check } from "lucide-react";
export function SkillPicker({
  projectId,
  ensureProject,
  selected,
  onSelect,
  disabled,
  onBusy,
}: {
  projectId?: string;
  ensureProject?: () => Promise<string>;
  selected: Skill | null;
  onSelect: (skill: Skill | null) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Skill[]>([]),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function load() {
    try {
      const id = projectId || (await ensureProject?.());
      if (!id) throw new Error("请先创建项目");
      setItems((await api<{ items: Skill[] }>(`projects/${id}/skills`)).items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function upload(file: File) {
    onBusy?.(true);
    setUploading(true);
    setError("");
    try {
      const id = projectId || (await ensureProject?.());
      if (!id) throw new Error("请先创建项目");
      const form = new FormData();
      form.set("file", file);
      const skill = await api<Skill>(`projects/${id}/skills`, {
        method: "POST",
        body: form,
      });
      await load();
      onSelect(skill);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
      setOpen(true);
    } finally {
      onBusy?.(false);
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) void load();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            className="reference-trigger"
            disabled={disabled || uploading}
            aria-label="选择 Skill"
          >
            <BookOpen size={17} />
            <span>{uploading ? "上传中" : "Skill"}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          className="skill-menu"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <button
            className="skill-upload"
            onClick={() => input.current?.click()}
            disabled={uploading}
          >
            <Upload size={15} />
            上传 SKILL.md
          </button>
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {!items.length && !error && (
            <p className="skill-empty">上传技能，为本次 Agent 提供工作规则</p>
          )}
          {items.map((skill) => (
            <div className="skill-list-item" key={skill.id}>
              <button
                className="skill-select"
                aria-pressed={selected?.id === skill.id}
                onClick={() => {
                  onSelect(selected?.id === skill.id ? null : skill);
                  setOpen(false);
                }}
              >
                <strong>
                  {skill.name}
                  {selected?.id === skill.id && <Check size={13} />}
                </strong>
                <span className="skill-description" title={skill.description}>
                  {skill.description}
                </span>
              </button>
              <button
                aria-label={`移除技能 ${skill.name}`}
                className="skill-delete"
                disabled={uploading}
                onClick={() =>
                  void api(`projects/${projectId}/skills/${skill.id}`, {
                    method: "DELETE",
                  })
                    .then(() => {
                      if (selected?.id === skill.id) onSelect(null);
                      return load();
                    })
                    .catch((e) => setError(e.message))
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        accept=".md"
        className="sr-only"
        aria-label="上传 Skill 文件"
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0]);
        }}
      />
    </>
  );
}
