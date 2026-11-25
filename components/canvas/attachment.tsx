"use client";
import { imageDisplayUrl } from "@/lib/image-display";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { api, type Asset } from "@/lib/client-api";
export function Attachment({
  asset,
  projectId,
  label,
}: {
  asset: Asset;
  projectId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const markdown = asset.mime === "text/markdown";
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    if (markdown && projectId) {
      setText("正在读取附件…");
      void api<{ text: string }>(
        `projects/${projectId}/attachments/${asset.id}/text`,
      )
        .then((data) => setText(data.text))
        .catch(() => setText("附件读取失败，请重试或下载查看。"));
    }
  }, [open, markdown, projectId, asset.id]);
  return (
    <>
      <button
        type="button"
        className={markdown ? "attachment-card" : "attachment-image"}
        title={asset.filename || label}
        onClick={() => setOpen(true)}
      >
        {markdown ? (
          <span>{asset.filename || "Markdown"}</span>
        ) : (
          <img
            src={imageDisplayUrl(asset.url)}
            decoding="async"
            alt={label || "附件图片"}
          />
        )}
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-label={asset.filename || "附件预览"}
          className="attachment-preview"
          onCancel={() => setOpen(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <header>
            <strong>{asset.filename || "附件预览"}</strong>
            <a href={`/api/assets/${asset.id}/content?download=1`}>下载</a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="关闭附件预览"
            >
              关闭
            </button>
          </header>
          {markdown ? (
            <pre>{text}</pre>
          ) : (
            <img src={asset.url} decoding="async" alt="附件预览" />
          )}
        </dialog>
      )}
    </>
  );
}
