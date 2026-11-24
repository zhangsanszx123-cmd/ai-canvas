-- Better Auth PostgreSQL schema snapshot; generated from its applied migration.

CREATE TABLE "user" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "emailVerified" bool NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "user_id_not_null" NOT NULL id,
  CONSTRAINT "user_name_not_null" NOT NULL name,
  CONSTRAINT "user_email_not_null" NOT NULL email,
  CONSTRAINT "user_emailVerified_not_null" NOT NULL "emailVerified",
  CONSTRAINT "user_createdAt_not_null" NOT NULL "createdAt",
  CONSTRAINT "user_updatedAt_not_null" NOT NULL "updatedAt",
  CONSTRAINT "user_pkey" PRIMARY KEY (id),
  CONSTRAINT "user_email_key" UNIQUE (email)
);

CREATE TABLE "session" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid NOT NULL,
  CONSTRAINT "session_id_not_null" NOT NULL id,
  CONSTRAINT "session_expiresAt_not_null" NOT NULL "expiresAt",
  CONSTRAINT "session_token_not_null" NOT NULL token,
  CONSTRAINT "session_createdAt_not_null" NOT NULL "createdAt",
  CONSTRAINT "session_updatedAt_not_null" NOT NULL "updatedAt",
  CONSTRAINT "session_userId_not_null" NOT NULL "userId",
  CONSTRAINT "session_pkey" PRIMARY KEY (id),
  CONSTRAINT "session_token_key" UNIQUE (token),
  CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON public.session USING btree ("userId");

CREATE TABLE "account" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT "account_id_not_null" NOT NULL id,
  CONSTRAINT "account_accountId_not_null" NOT NULL "accountId",
  CONSTRAINT "account_providerId_not_null" NOT NULL "providerId",
  CONSTRAINT "account_userId_not_null" NOT NULL "userId",
  CONSTRAINT "account_createdAt_not_null" NOT NULL "createdAt",
  CONSTRAINT "account_updatedAt_not_null" NOT NULL "updatedAt",
  CONSTRAINT "account_pkey" PRIMARY KEY (id),
  CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX "account_userId_idx" ON public.account USING btree ("userId");

CREATE TABLE "verification" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "verification_id_not_null" NOT NULL id,
  CONSTRAINT "verification_identifier_not_null" NOT NULL identifier,
  CONSTRAINT "verification_value_not_null" NOT NULL value,
  CONSTRAINT "verification_expiresAt_not_null" NOT NULL "expiresAt",
  CONSTRAINT "verification_createdAt_not_null" NOT NULL "createdAt",
  CONSTRAINT "verification_updatedAt_not_null" NOT NULL "updatedAt",
  CONSTRAINT "verification_pkey" PRIMARY KEY (id)
);
CREATE INDEX verification_identifier_idx ON public.verification USING btree (identifier);

CREATE TABLE "rateLimit" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "count" int4 NOT NULL,
  "lastRequest" int8 NOT NULL,
  CONSTRAINT "rateLimit_id_not_null" NOT NULL id,
  CONSTRAINT "rateLimit_key_not_null" NOT NULL key,
  CONSTRAINT "rateLimit_count_not_null" NOT NULL count,
  CONSTRAINT "rateLimit_lastRequest_not_null" NOT NULL "lastRequest",
  CONSTRAINT "rateLimit_pkey" PRIMARY KEY (id),
  CONSTRAINT "rateLimit_key_key" UNIQUE (key)
);
