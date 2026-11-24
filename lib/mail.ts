import "server-only";
import nodemailer from "nodemailer";
export function mailReady() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.SMTP_FROM
  );
}
export async function sendAuthMail(to: string, subject: string, url: string) {
  if (!mailReady()) throw new Error("邮件服务尚未配置");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASSWORD! },
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: `${subject}\n\n请打开以下链接完成操作：\n${url}\n\n如果不是你的操作，请忽略此邮件。`,
  });
}
