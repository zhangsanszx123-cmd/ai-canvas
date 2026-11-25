import "server-only";
import { parse } from "yaml";
import { z } from "zod";
import { getDb } from "./db";
import { HttpError } from "./http";
export function parseSkill(source: string) {
  if (Buffer.byteLength(source, "utf8") > 128000 || source.includes("\0"))
    throw new HttpError(422, "Skill 文件须为不超过 128KB 的 UTF-8 文本");
  const match = source
    .replace(/^\uFEFF/, "")
    .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match || !match[2].trim())
    throw new HttpError(422, "SKILL.md 需要 YAML frontmatter 与完整规则正文");
  let meta: unknown;
  try {
    meta = parse(match[1], { maxAliasCount: 0, uniqueKeys: true });
  } catch {
    throw new HttpError(422, "Skill frontmatter 不是有效 YAML");
  }
  const fields = z
    .object({
      name: z
        .string()
        .min(1)
        .max(64)
        .regex(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          "技能名只能包含小写字母、数字和单连字符",
        ),
      description: z.string().trim().min(1).max(2000),
    })
    .safeParse(meta);
  if (!fields.success) throw new HttpError(422, fields.error.issues[0].message);
  return { ...fields.data, body: match[2], source };
}
export async function skillFor(owner: string, project: string, id: string) {
  const { rows } = await getDb().query(
    "SELECT id,name,description,body,source FROM ac_skills WHERE id=$1 AND owner_id=$2 AND (project_id=$3 OR project_id IS NULL)",
    [id, owner, project],
  );
  if (!rows[0]) throw new HttpError(404, "技能不存在或已移除");
  return rows[0] as {
    id: string;
    name: string;
    description: string;
    body: string;
    source: string;
  };
}

export async function skillUpload(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !/^SKILL\.md$/i.test(file.name))
    throw new HttpError(422, "请上传标准 SKILL.md 文件");
  if (file.size > 128000) throw new HttpError(413, "Skill 不能超过 128KB");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new HttpError(422, "Skill 必须为 UTF-8 编码");
  }
  return parseSkill(source);
}
