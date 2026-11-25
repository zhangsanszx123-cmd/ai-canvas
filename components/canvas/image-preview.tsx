"use client";
/* eslint-disable @next/next/no-img-element -- Private image URLs require session cookies. */
import { useEffect, useRef, useState } from "react";
import { Download, Maximize, Minus, Plus, X } from "lucide-react";
import type { Asset } from "@/lib/client-api";

export function ImagePreview({
  asset,
  onClose,
  downloadUrl,
}: {
  asset: Asset;
  onClose: () => void;
  downloadUrl?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const fit =
    size.width && size.height
      ? Math.min(size.width / asset.width, size.height / asset.height, 1)
      : 1;
  const current = scale ?? fit;
  const zoom = (factor: number) =>
    setScale(Math.max(0.01, Math.min(8, current * factor)));
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(stage.current!);
    return () => {
      observer.disconnect();
      element.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-label="图片预览"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoom(1.25);
        }
        if (event.key === "-") {
          event.preventDefault();
          zoom(0.8);
        }
        if (event.key === "0") {
          event.preventDefault();
          setScale(null);
        }
      }}
    >
      <header className="preview-toolbar">
        <button
          aria-label="缩小预览图片"
          title="缩小（-）"
          disabled={current <= 0.01}
          onClick={() => zoom(0.8)}
        >
          <Minus size={19} />
        </button>
        <output aria-label="图片缩放比例">{Math.round(current * 100)}%</output>
        <button
          aria-label="放大预览图片"
          title="放大（+）"
          disabled={current >= 8}
          onClick={() => zoom(1.25)}
        >
          <Plus size={19} />
        </button>
        <button
          aria-label="按原始尺寸查看"
          title="原始尺寸"
          onClick={() => setScale(1)}
        >
          1:1
        </button>
        <button
          aria-label="适应预览窗口"
          title="适应窗口（0）"
          onClick={() => {
            setScale(null);
            stage.current?.scrollTo(0, 0);
          }}
        >
          <Maximize size={19} />
        </button>
        <a
          aria-label="下载预览图片"
          title="下载图片"
          href={downloadUrl || `/api/assets/${asset.id}/content?download=1`}
        >
          <Download size={19} />
        </a>
        <button
          aria-label="关闭预览"
          title="关闭（Esc）"
          onClick={onClose}
          autoFocus
        >
          <X size={21} />
        </button>
      </header>
      <div
        ref={stage}
        className="preview-stage"
        tabIndex={0}
        aria-label="图片查看区域"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const element = event.currentTarget;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          element.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft =
            drag.current.left - event.clientX + drag.current.x;
          event.currentTarget.scrollTop =
            drag.current.top - event.clientY + drag.current.y;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="preview-content"
          style={{
            width: Math.max(size.width, asset.width * current),
            height: Math.max(size.height, asset.height * current),
          }}
        >
          {failed ? (
            <p role="alert">图片加载失败，请关闭后重新打开预览</p>
          ) : (
            <img
              src={asset.url}
              alt="生成图片预览"
              draggable={false}
              style={{
                width: asset.width * current,
                height: asset.height * current,
              }}
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </div>
      <p className="preview-hint">
        拖动查看细节 · + / - 缩放 · 0 适应窗口 · Esc 关闭
      </p>
    </dialog>
  );
}
