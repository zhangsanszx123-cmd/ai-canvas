"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Search,
  Upload,
  Trash2,
  X,
  LoaderCircle,
} from "lucide-react";
import { api, type Skill } from "@/lib/client-api";
import { Markdown } from "./agent-messages";

export function SkillLibrary() {
  const [items, setItems] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<(Skill & { body: string }) | null>(null);
  const [target, setTarget] = useState<Skill | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems((await api<{ items: Skill[] }>("skills")).items);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (detail) detailsDialog.current?.showModal();
  }, [detail]);
  useEffect(() => {
    if (target) deleteDialog.current?.showModal();
  }, [target]);
  async function upload(file: File) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      await api("skills", { method: "POST", body: form });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove() {
    if (!target || busy) return;
    setBusy(true);
    try {
      await api(`skills/${target.id}`, { method: "DELETE" });
      setItems((old) => old.filter((skill) => skill.id !== target.id));
      setTarget(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }
  const filtered = items.filter((skill) =>
    `${skill.name} ${skill.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="skill-library">
      <div className="skill-library-heading">
        <div>
          <h1>我的技能库</h1>
          <p>上传一次，在所有项目中使用。输入 / 可快速选择。</p>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Upload size={16} />
          )}
          导入 SKILL.md
        </button>
      </div>
      <label className="skill-library-search">
        <Search size={17} />
        <input
          aria-label="搜索账号技能"
          value={query}
          placeholder="搜索技能名称或用途"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
          <button onClick={() => void load()}>重新加载</button>
        </p>
      )}
      {loading ? (
        <p role="status">正在加载技能…</p>
      ) : filtered.length ? (
        <div className="skill-library-grid">
          {filtered.map((skill) => (
            <article className="skill-library-card" key={skill.id}>
              <BookOpen size={21} />
              <h2>{skill.name}</h2>
              <p>{skill.description}</p>
              <small>账号技能 · 所有项目可用</small>
              <div>
                <button
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setDetail(
                        await api<Skill & { body: string }>(
                          `skills/${skill.id}`,
                        ),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  查看规则
                </button>
                <button
                  disabled={busy}
                  aria-label={`删除账号技能 ${skill.name}`}
                  onClick={() => setTarget(skill)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="skill-library-empty">
          <BookOpen size={30} />
          <h2>{query ? "没有找到匹配的技能" : "把创作方法存进技能库"}</h2>
          <p>
            {query
              ? "试试其他名称或关键词"
              : "导入带有 name、description 和规则正文的 SKILL.md，然后回到首页或画布选择使用。已有项目技能仍保留在对应项目中。"}
          </p>
        </div>
      )}
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".md"
        aria-label="导入账号 Skill 文件"
        onChange={(e) => {
          if (e.target.files?.[0]) void upload(e.target.files[0]);
        }}
      />
      {detail && (
        <dialog
          ref={detailsDialog}
          className="skill-detail-dialog"
          aria-label="技能规则"
          onCancel={() => setDetail(null)}
        >
          <header>
            <h2>{detail.name}</h2>
            <button aria-label="关闭技能详情" onClick={() => setDetail(null)}>
              <X size={18} />
            </button>
          </header>
          <p>{detail.description}</p>
          <Markdown>{detail.body}</Markdown>
        </dialog>
      )}
      {target && (
        <dialog
          ref={deleteDialog}
          className="project-delete-dialog"
          aria-label="删除账号技能？"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setTarget(null);
          }}
        >
          <h3>删除账号技能？</h3>
          <p>
            删除“{target.name}
            ”后，所有项目将无法再选择此技能；已有对话记录会保留。
          </p>
          <div>
            <button autoFocus disabled={busy} onClick={() => setTarget(null)}>
              取消
            </button>
            <button
              className="confirm-project-delete"
              disabled={busy}
              onClick={() => void remove()}
            >
              确认删除技能
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
