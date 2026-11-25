"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { api, type Skill } from "@/lib/client-api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { BookOpen, Upload, Trash2, Check, Copy } from "lucide-react";
export function SkillPicker({
  projectId,
  selected,
  onSelect,
  disabled,
  onBusy,
}: {
  projectId?: string;
  selected: Skill | null;
  onSelect: (skill: Skill | null) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Skill[]>([]),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function load() {
    try {
      setItems(
        (
          await api<{ items: Skill[] }>(
            projectId ? `projects/${projectId}/skills` : "skills",
          )
        ).items,
      );
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
      const form = new FormData();
      form.set("file", file);
      const skill = await api<Skill>(
        projectId ? `projects/${projectId}/skills` : "skills",
        {
          method: "POST",
          body: form,
        },
      );
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
          if (value) {
            setQuery("");
            void load();
          }
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
            {projectId ? "上传到本项目" : "上传 SKILL.md"}
          </button>
          <Link className="skill-upload" href="/skills">
            管理账号技能库
          </Link>
          <input
            className="skill-search"
            aria-label="搜索技能"
            placeholder="搜索名称或用途"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {!items.length && !error && (
            <p className="skill-empty">上传技能，为本次 Agent 提供工作规则</p>
          )}
          {items
            .filter((skill) =>
              `${skill.name} ${skill.description}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            )
            .map((skill) => (
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
                    <small>{skill.scope === "account" ? "账号" : "项目"}</small>
                    {selected?.id === skill.id && <Check size={13} />}
                  </strong>
                  <span className="skill-description" title={skill.description}>
                    {skill.description}
                  </span>
                </button>
                {skill.scope !== "account" && (
                  <button
                    aria-label={`加入账号技能库 ${skill.name}`}
                    title="加入账号技能库，在其他项目复用"
                    className="skill-delete"
                    disabled={uploading}
                    onClick={async () => {
                      onBusy?.(true);
                      setUploading(true);
                      try {
                        await api(
                          `projects/${projectId}/skills/${skill.id}/library`,
                          { method: "POST", body: "{}" },
                        );
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setUploading(false);
                        onBusy?.(false);
                      }
                    }}
                  >
                    <Copy size={15} />
                  </button>
                )}
                {skill.scope !== "account" && (
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
                )}
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
