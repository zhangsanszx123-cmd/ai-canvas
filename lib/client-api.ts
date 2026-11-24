"use client";
export type Skill = { id: string; name: string; description: string };
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = await response
    .json()
    .catch(() => ({ error: { message: "服务响应异常，请稍后重试" } }));
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/auth/login");
    throw new ApiError(
      data.error?.message || data.message || "请求失败",
      response.status,
    );
  }
  return data as T;
}
export type Asset = {
  mime?: string;
  filename?: string;
  id: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
};
export type ProjectCard = {
  id: string;
  name: string;
  coverUrl: string | null;
  updated_at: string;
};
