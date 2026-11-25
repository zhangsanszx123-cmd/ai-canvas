"use client";
import { imageDisplayUrl } from "@/lib/image-display";
/* eslint-disable @next/next/no-img-element -- Private image URLs require session cookies and must bypass the public optimizer cache. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Plus,
  LoaderCircle,
  ImageOff,
  Trash2,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { api, type ProjectCard } from "@/lib/client-api";
function ProjectCardContent({ item }: { item: ProjectCard }) {
  return (
    <>
      <span className="project-cover">
        {item.coverUrl ? (
          <img
            src={imageDisplayUrl(item.coverUrl)}
            decoding="async"
            alt={item.name}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : (
          <ImageOff size={24} strokeWidth={1} className="empty-cover-icon" />
        )}
      </span>
      <strong>{item.name}</strong>
      <small>
        更新于{" "}
        {new Date(item.updated_at).toLocaleDateString("zh-CN", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </small>
    </>
  );
}

export function ProjectGrid({
  recent = false,
  publicView = false,
}: {
  recent?: boolean;
  publicView?: boolean;
}) {
  const [items, setItems] = useState<ProjectCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState<ProjectCard | null>(null);
  const [operation, setOperation] = useState<"delete" | "rename">("delete");
  const [draftName, setDraftName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (target) dialog.current?.showModal();
  }, [target]);
  function closeDelete() {
    setTarget(null);
    deleteTrigger.current?.focus();
  }
  async function remove() {
    if (!target || deleting) return;
    if (operation === "rename" && !draftName.trim()) return;
    setDeleting(true);
    setError("");
    try {
      if (operation === "rename") {
        const name = draftName.trim();
        await api(`projects/${target.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
        setItems((old) =>
          old.map((item) => (item.id === target.id ? { ...item, name } : item)),
        );
      } else {
        await api(`projects/${target.id}`, { method: "DELETE" });
        setItems((old) => old.filter((item) => item.id !== target.id));
      }
      closeDelete();
    } catch (e) {
      setError((e as Error).message);
      closeDelete();
    } finally {
      setDeleting(false);
    }
  }
  const loadingRef = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const load = useCallback(
    async (next?: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError("");
      try {
        const data = await api<{
          items: ProjectCard[];
          nextCursor: string | null;
        }>(
          `${publicView ? "public/" : ""}projects?limit=${recent ? 4 : 20}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
        );
        setItems((old) => (next ? [...old, ...data.items] : data.items));
        setCursor(data.nextCursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [recent, publicView],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (recent || !cursor || loading || !sentinel.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void load(cursor);
      },
      { rootMargin: "250px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [recent, cursor, loading, load]);
  async function create() {
    setCreating(true);
    setError("");
    try {
      const project = await api<{ id: string }>("projects", {
        method: "POST",
        body: "{}",
      });
      window.location.assign(`/canvas?projectId=${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }
  return (
    <section className="projects-section">
      <div className="section-heading">
        <h2>{recent ? "最近项目" : publicView ? "全部项目" : "项目"}</h2>
        {recent && (
          <Link href="/projects">
            查看全部
            <ChevronRight size={14} />
          </Link>
        )}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button className="text-button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}
      <div className="project-grid">
        <button
          className="project-card new-project"
          onClick={() => {
            if (!publicView) void create();
          }}
          disabled={creating || publicView}
          title={publicView ? "登录后可新建项目" : undefined}
        >
          <span className="project-cover">
            {creating ? (
              <LoaderCircle size={22} className="spin" />
            ) : (
              <Plus size={24} strokeWidth={1} />
            )}
          </span>
          <strong>新建项目</strong>
        </button>
        {items.map((item) => (
          <div className="project-card-shell" key={item.id}>
            <Link
              href={`/canvas?projectId=${item.id}`}
              className="project-card"
            >
              <ProjectCardContent item={item} />
            </Link>
            {!publicView ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="project-more"
                    aria-label={`项目操作 ${item.name}`}
                    title="项目操作"
                    onPointerDown={(e) => {
                      deleteTrigger.current = e.currentTarget;
                    }}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(e) => {
                    if (target) e.preventDefault();
                  }}
                >
                  <DropdownMenuItem
                    onSelect={() => {
                      setOperation("rename");
                      setDraftName(item.name);
                      setTarget(item);
                    }}
                  >
                    <Pencil size={15} />
                    重命名项目 {item.name}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-red-600"
                    onSelect={() => {
                      setOperation("delete");
                      setTarget(item);
                    }}
                  >
                    <Trash2 size={15} />
                    删除项目 {item.name}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                className="project-more"
                disabled
                aria-label={`项目操作 ${item.name}`}
                title="登录后可管理自己的项目"
              >
                <MoreHorizontal size={18} />
              </button>
            )}
          </div>
        ))}
        {loading &&
          Array.from({ length: recent ? 4 : 4 }, (_, i) => (
            <div key={i} className="project-card" aria-hidden>
              <span className="project-cover skeleton" />
              <span className="skeleton skeleton-line" />
            </div>
          ))}
      </div>
      {target && (
        <dialog
          ref={dialog}
          className="project-delete-dialog"
          aria-labelledby="delete-project-title"
          onCancel={(e) => {
            if (deleting) e.preventDefault();
            else closeDelete();
          }}
        >
          <h3 id="delete-project-title">
            {operation === "rename" ? "重命名项目" : "删除项目？"}
          </h3>
          {operation === "rename" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              <label htmlFor="project-name">项目名称</label>
              <input
                id="project-name"
                autoFocus
                required
                maxLength={80}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                disabled={deleting}
              />
              <div>
                <button type="button" disabled={deleting} onClick={closeDelete}>
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={deleting || !draftName.trim()}
                >
                  {deleting ? "保存中…" : "保存名称"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p>
                确定删除“{target.name}
                ”吗？删除后会从项目列表移除，无法继续打开。
              </p>
              <div>
                <button onClick={closeDelete} disabled={deleting} autoFocus>
                  取消
                </button>
                <button
                  className="confirm-project-delete"
                  onClick={() => void remove()}
                  disabled={deleting}
                >
                  {deleting ? "删除中…" : "确认删除"}
                </button>
              </div>
            </>
          )}
        </dialog>
      )}
      {!loading && !items.length && !error && (
        <p className="empty-projects">
          {publicView
            ? "暂无可展示的项目"
            : "还没有项目，从一个想法开始创作吧。"}
        </p>
      )}
      {!recent && (
        <div ref={sentinel} className="list-footer">
          {loading ? (
            "正在加载项目…"
          ) : cursor ? (
            <button onClick={() => void load(cursor)}>加载更多</button>
          ) : items.length ? (
            "已显示全部项目"
          ) : (
            ""
          )}
        </div>
      )}
    </section>
  );
}
