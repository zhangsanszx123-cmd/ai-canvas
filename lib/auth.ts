import "server-only";
import { betterAuth } from "better-auth";
import { getDb } from "./db";
import { sendAuthMail } from "./mail";

export const auth = betterAuth({
  database: getDb(),
  baseURL: process.env.APP_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.APP_URL || "http://localhost:3000"],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
    minPasswordLength: 10,
    sendResetPassword: async ({ user, url }) =>
      sendAuthMail(user.email, "重置 AI Canvas 密码", url),
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-up/email": { window: 60, max: 3 },
      "/sign-in/email": { window: 60, max: 8 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
  advanced: { database: { generateId: "uuid" } },
});
