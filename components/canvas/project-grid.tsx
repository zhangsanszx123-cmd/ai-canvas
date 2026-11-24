"use client";
/* eslint-disable @next/next/no-img-element -- Private image URLs require session cookies and must bypass the public optimizer cache. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Plus, LoaderCircle, ImageOff } from "lucide-react";
import { api, type ProjectCard } from "@/lib/client-api";
export function ProjectGrid({ recent = false }: { recent?: boolean }) {
  const [items, setItems] = useState<ProjectCard[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
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
          `projects?limit=${recent ? 4 : 20}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
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
    [recent],
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
        <h2>{recent ? "最近项目" : "项目"}</h2>
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
          onClick={() => void create()}
          disabled={creating}
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
          <Link
            href={`/canvas?projectId=${item.id}`}
            className="project-card"
            key={item.id}
          >
            <span className="project-cover">
              {item.coverUrl ? (
                <img
                  src={item.coverUrl}
                  alt={item.name}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
              ) : (
                <ImageOff
                  size={24}
                  strokeWidth={1}
                  className="empty-cover-icon"
                />
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
          </Link>
        ))}
        {loading &&
          Array.from({ length: recent ? 4 : 4 }, (_, i) => (
            <div key={i} className="project-card" aria-hidden>
              <span className="project-cover skeleton" />
              <span className="skeleton skeleton-line" />
            </div>
          ))}
      </div>
      {!loading && !items.length && !error && (
        <p className="empty-projects">还没有项目，从一个想法开始创作吧。</p>
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
