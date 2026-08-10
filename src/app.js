import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { buildAnalytics, captureClickDetails } from "./analytics.js";
import {
  normalizeEmailChangeConfirmation,
  normalizeEmailVerificationConfirmation,
  normalizeLogin,
  normalizePasswordResetConfirmation,
  normalizePasswordResetRequest,
  normalizeRegistration,
  normalizeVerificationRequest,
  publicUser,
} from "./auth.js";
import {
  generateSlug,
  generateStatsToken,
  getPublicBaseUrl,
  isUniqueSlugError,
  isValidSlug,
  normalizeAlias,
  normalizeTargetUrl,
} from "./links.js";
import {
  buildOAuthAuthorizationUrl,
  createOAuthStateToken,
  OAUTH_STATE_TTL_MS,
  verifyOAuthStateToken,
} from "./oauth.js";
import {
  CLICK_EVENTS_COLLECTION,
  createUserClient,
  LINKS_COLLECTION,
  TELEGRAM_ACCOUNTS_COLLECTION,
  TELEGRAM_LINK_TOKENS_COLLECTION,
  USERS_COLLECTION,
} from "./pocketbase.js";
import {
  buildTelegramDeepLink,
  generateTelegramLinkToken,
  hashTelegramLinkToken,
  matchesInternalSecret,
  normalizeTelegramIdentity,
} from "./telegram.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "../public");

function clientError(response, message, status = 400, code) {
  const body = { error: message };
  if (code) body.code = code;
  return response.status(status).json(body);
}

function telegramClientError(message, status = 400) {
  const error = new Error(message);
  error.telegramClientError = true;
  error.status = status;
  return error;
}

function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: config.sessionMaxAgeMs,
    path: "/",
  };
}

function setSession(response, config, token) {
  response.cookie(config.sessionCookieName, token, sessionCookieOptions(config));
}

function clearSession(response, config) {
  response.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
  });
}

function googleOAuthCookieName(config) {
  return `${config.sessionCookieName}_google_oauth`;
}

function googleOAuthCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    maxAge: OAUTH_STATE_TTL_MS,
    path: "/api/auth",
  };
}

function clearGoogleOAuthState(response, config) {
  response.clearCookie(googleOAuthCookieName(config), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/api/auth",
  });
}

function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (!origin) return next();

  try {
    if (new URL(origin).host !== request.get("host")) {
      return clientError(response, "Cross-origin request rejected", 403);
    }
  } catch {
    return clientError(response, "Invalid Origin header", 403);
  }

  return next();
}

async function createRecord(client, url, requestedSlug, ownerId, anonymousLinkTtlMs) {
  const attempts = requestedSlug ? 1 : 5;
  const statsToken = generateStatsToken();
  const expiresAt = ownerId ? "" : new Date(Date.now() + anonymousLinkTtlMs).toISOString();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const slug = requestedSlug ?? generateSlug();
    try {
      return await client.collection(LINKS_COLLECTION).create({
        url,
        slug,
        clicks: 0,
        active: true,
        owner: ownerId || "",
        statsToken,
        expiresAt,
      });
    } catch (error) {
      if (!requestedSlug && isUniqueSlugError(error)) continue;
      throw error;
    }
  }

  throw new Error("Could not generate an available short URL");
}

function normalizeOwnedLinkUpdate(body) {
  const update = {};
  if (Object.hasOwn(body || {}, "url")) update.url = normalizeTargetUrl(body.url);
  if (Object.hasOwn(body || {}, "alias")) {
    const alias = normalizeAlias(body.alias);
    if (!alias) throw new Error("The slug cannot be empty");
    update.slug = alias;
  }
  if (Object.hasOwn(body || {}, "active")) {
    if (typeof body.active !== "boolean") throw new Error("The active field must be true or false");
    update.active = body.active;
  }
  if (Object.keys(update).length === 0) throw new Error("Provide a URL, slug, or active state to update");
  return update;
}

export function createApp({
  client,
  config,
  geoIpResolver,
  logger = console,
  userClientFactory = (token) => createUserClient(config, token),
}) {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://telegram.org"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "8kb" }));
  app.use(cookieParser());
  const staticCache = config.staticCache !== false;
  app.use(express.static(publicDirectory, {
    extensions: ["html"],
    etag: staticCache,
    lastModified: staticCache,
    maxAge: staticCache ? "1h" : 0,
    setHeaders(response) {
      if (!staticCache) {
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("Expires", "0");
      }
    },
  }));
  app.use("/api", requireSameOrigin);

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: config.rateLimitMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again in a few minutes." },
  });

  const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many password reset requests. Please try again later." },
  });

  const telegramInternalLimiter = rateLimit({
    windowMs: 60 * 1_000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many Telegram bot requests" },
  });

  const telegramEnabled = Boolean(config.telegramBotUsername && config.telegramInternalSecret);
  const authenticateTelegramInternal = (request, response, next) => {
    if (!telegramEnabled) return clientError(response, "Telegram integration is not configured", 503);
    if (!matchesInternalSecret(request.get("x-telegram-bot-secret"), config.telegramInternalSecret)) {
      return clientError(response, "Not found", 404);
    }
    return next();
  };

  app.use("/api/internal/telegram", authenticateTelegramInternal, telegramInternalLimiter);

  const resolveUser = async (request, response, next, required) => {
    const token = request.cookies[config.sessionCookieName];
    if (!token) {
      if (required) return clientError(response, "Authentication required", 401);
      return next();
    }

    try {
      const userClient = userClientFactory(token);
      const auth = await userClient.collection(USERS_COLLECTION).authRefresh();
      if (!auth.record.verified) {
        clearSession(response, config);
        if (required) {
          return clientError(
            response,
            "Verify your email before signing in",
            403,
            "email_verification_required",
          );
        }
        return next();
      }
      request.user = auth.record;
      setSession(response, config, auth.token);
      return next();
    } catch {
      clearSession(response, config);
      if (required) return clientError(response, "Your session has expired. Sign in again.", 401);
      return next();
    }
  };

  const authenticate = (request, response, next) =>
    resolveUser(request, response, next, true);
  const optionalAuthenticate = (request, response, next) =>
    resolveUser(request, response, next, false);

  app.get("/health", async (_request, response) => {
    try {
      await client.health.check();
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });

  app.post("/api/auth/register", apiLimiter, async (request, response, next) => {
    try {
      let registration;
      try {
        registration = normalizeRegistration(request.body);
      } catch (error) {
        return clientError(response, error.message);
      }

      await client.collection(USERS_COLLECTION).create({
        email: registration.email,
        password: registration.password,
        passwordConfirm: registration.password,
        name: registration.name,
      });

      let verificationEmailSent = true;
      const userClient = userClientFactory();
      try {
        await userClient
          .collection(USERS_COLLECTION)
          .requestVerification(registration.email);
      } catch (error) {
        verificationEmailSent = false;
        logger.warn("Registration verification email failed", error?.message || error);
      }

      return response.status(201).json({
        verificationRequired: true,
        verificationEmailSent,
      });
    } catch (error) {
      if (error?.response?.data?.email) {
        return clientError(response, "An account with this email already exists", 409);
      }
      return next(error);
    }
  });

  app.post("/api/auth/login", apiLimiter, async (request, response) => {
    let credentials;
    try {
      credentials = normalizeLogin(request.body);
    } catch (error) {
      return clientError(response, error.message);
    }

    const userClient = userClientFactory();
    let auth;
    try {
      auth = await userClient
        .collection(USERS_COLLECTION)
        .authWithPassword(credentials.email, credentials.password);
    } catch {
      return clientError(response, "Incorrect email or password", 401);
    }

    if (!auth.record.verified) {
      userClient.authStore.clear();
      return clientError(
        response,
        "Verify your email before signing in",
        403,
        "email_verification_required",
      );
    }

    setSession(response, config, auth.token);
    return response.json({ user: publicUser(auth.record) });
  });

  const getGoogleProvider = async () => {
    const userClient = userClientFactory();
    const methods = await userClient.collection(USERS_COLLECTION).listAuthMethods();
    return methods.oauth2?.providers?.find((provider) => provider.name === "google") || null;
  };

  app.get("/api/auth/providers", apiLimiter, async (_request, response, next) => {
    try {
      const google = await getGoogleProvider();
      response.json({ google: Boolean(google), telegram: telegramEnabled });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/google/start", apiLimiter, async (request, response, next) => {
    try {
      const provider = await getGoogleProvider();
      if (!provider) return clientError(response, "Google sign-in is not configured", 503);

      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      const redirectUrl = `${baseUrl}/api/auth/google-callback`;
      const stateToken = createOAuthStateToken(
        provider,
        redirectUrl,
        config.analyticsHashSecret,
      );

      response.cookie(
        googleOAuthCookieName(config),
        stateToken,
        googleOAuthCookieOptions(config),
      );
      return response.redirect(302, buildOAuthAuthorizationUrl(provider.authURL, redirectUrl));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/auth/google-callback", apiLimiter, async (request, response) => {
    const returnToHome = (status) => response.redirect(303, `/?auth=${status}`);
    const stateCookie = request.cookies[googleOAuthCookieName(config)];
    clearGoogleOAuthState(response, config);

    if (request.query.error) return returnToHome("cancelled");

    try {
      const state = typeof request.query.state === "string" ? request.query.state : "";
      const code = typeof request.query.code === "string" ? request.query.code : "";
      const oauthState = verifyOAuthStateToken(
        stateCookie,
        config.analyticsHashSecret,
      );

      if (!state || state !== oauthState.state || !code) {
        throw new Error("OAuth state or authorization code is invalid");
      }

      const userClient = userClientFactory();
      const auth = await userClient.collection(USERS_COLLECTION).authWithOAuth2Code(
        "google",
        code,
        oauthState.codeVerifier,
        oauthState.redirectUrl,
      );
      setSession(response, config, auth.token);
      return returnToHome("google-success");
    } catch (error) {
      logger.warn("Google authentication failed", error?.message || error);
      return returnToHome("google-failed");
    }
  });

  app.post(
    "/api/auth/resend-verification",
    passwordResetLimiter,
    async (request, response) => {
      let verificationRequest;
      try {
        verificationRequest = normalizeVerificationRequest(request.body);
      } catch (error) {
        return clientError(response, error.message);
      }

      try {
        const userClient = userClientFactory();
        await userClient
          .collection(USERS_COLLECTION)
          .requestVerification(verificationRequest.email);
      } catch (error) {
        logger.warn("Email verification request failed", error?.message || error);
      }

      return response.status(202).json({
        message: "If an unverified account exists for that email, a verification link has been sent.",
      });
    },
  );

  app.post(
    "/api/auth/verify-email",
    apiLimiter,
    async (request, response, next) => {
      let confirmation;
      try {
        confirmation = normalizeEmailVerificationConfirmation(request.body);
      } catch (error) {
        return clientError(response, error.message);
      }

      try {
        const userClient = userClientFactory();
        await userClient
          .collection(USERS_COLLECTION)
          .confirmVerification(confirmation.token);
        clearSession(response, config);
        return response.status(204).end();
      } catch (error) {
        if (!error?.status || error.status >= 500) return next(error);
        return clientError(response, "This email verification link is invalid or has expired");
      }
    },
  );

  app.post(
    "/api/auth/forgot-password",
    passwordResetLimiter,
    async (request, response) => {
      let resetRequest;
      try {
        resetRequest = normalizePasswordResetRequest(request.body);
      } catch (error) {
        return clientError(response, error.message);
      }

      try {
        const userClient = userClientFactory();
        await userClient
          .collection(USERS_COLLECTION)
          .requestPasswordReset(resetRequest.email);
      } catch (error) {
        logger.warn("Password reset email request failed", error?.message || error);
      }

      return response.status(202).json({
        message: "If an account exists for that email, a password reset link has been sent.",
      });
    },
  );

  app.post(
    "/api/auth/reset-password",
    apiLimiter,
    async (request, response, next) => {
      let confirmation;
      try {
        confirmation = normalizePasswordResetConfirmation(request.body);
      } catch (error) {
        return clientError(response, error.message);
      }

      try {
        const userClient = userClientFactory();
        await userClient.collection(USERS_COLLECTION).confirmPasswordReset(
          confirmation.token,
          confirmation.password,
          confirmation.password,
        );
        clearSession(response, config);
        return response.status(204).end();
      } catch (error) {
        if (!error?.status || error.status >= 500) return next(error);
        return clientError(response, "This password reset link is invalid or has expired");
      }
    },
  );

  app.post(
    "/api/auth/confirm-email-change",
    apiLimiter,
    async (request, response, next) => {
      let confirmation;
      try {
        confirmation = normalizeEmailChangeConfirmation(request.body);
      } catch (error) {
        return clientError(response, error.message);
      }

      try {
        const userClient = userClientFactory();
        await userClient.collection(USERS_COLLECTION).confirmEmailChange(
          confirmation.token,
          confirmation.password,
        );
        clearSession(response, config);
        return response.status(204).end();
      } catch (error) {
        if (!error?.status || error.status >= 500) return next(error);
        return clientError(response, "This email change link is invalid or has expired");
      }
    },
  );

  app.post("/api/auth/logout", (_request, response) => {
    clearSession(response, config);
    response.status(204).end();
  });

  app.get("/api/auth/me", authenticate, (request, response) => {
    response.json({ user: publicUser(request.user) });
  });

  const findTelegramBindingByOwner = async (ownerId) => {
    try {
      const filter = client.filter("owner = {:owner}", { owner: ownerId });
      return await client.collection(TELEGRAM_ACCOUNTS_COLLECTION).getFirstListItem(filter);
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  };

  const findTelegramBindingByUser = async (telegramUserId) => {
    try {
      const filter = client.filter("telegramUserId = {:telegramUserId}", { telegramUserId });
      return await client.collection(TELEGRAM_ACCOUNTS_COLLECTION).getFirstListItem(filter);
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  };

  const deleteTelegramTokensForOwner = async (ownerId) => {
    const filter = client.filter("owner = {:owner}", { owner: ownerId });
    const records = await client.collection(TELEGRAM_LINK_TOKENS_COLLECTION).getFullList({
      filter,
      fields: "id",
    });
    await Promise.all(records.map((record) =>
      client.collection(TELEGRAM_LINK_TOKENS_COLLECTION).delete(record.id)));
  };

  app.get("/api/telegram/status", apiLimiter, authenticate, async (request, response, next) => {
    try {
      const binding = await findTelegramBindingByOwner(request.user.id);
      return response.json({
        configured: telegramEnabled,
        connected: Boolean(binding),
        account: binding
          ? {
              username: binding.username || null,
              firstName: binding.firstName || null,
              connectedAt: binding.created,
            }
          : null,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/telegram/link", apiLimiter, authenticate, async (request, response, next) => {
    if (!telegramEnabled) return clientError(response, "Telegram integration is not configured", 503);

    try {
      await deleteTelegramTokensForOwner(request.user.id);
      const token = generateTelegramLinkToken();
      const tokenHash = hashTelegramLinkToken(token, config.telegramInternalSecret);
      const expiresAt = new Date(Date.now() + config.telegramLinkTtlMs).toISOString();
      await client.collection(TELEGRAM_LINK_TOKENS_COLLECTION).create({
        owner: request.user.id,
        tokenHash,
        expiresAt,
      });
      return response.status(201).json({
        botUrl: buildTelegramDeepLink(config.telegramBotUsername, token),
        expiresAt,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/telegram/link", apiLimiter, authenticate, async (request, response, next) => {
    try {
      const binding = await findTelegramBindingByOwner(request.user.id);
      if (binding) await client.collection(TELEGRAM_ACCOUNTS_COLLECTION).delete(binding.id);
      await deleteTelegramTokensForOwner(request.user.id);
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  const resolveTelegramOwner = async (body) => {
    let identity;
    try {
      identity = normalizeTelegramIdentity(body);
    } catch (error) {
      throw telegramClientError(error.message);
    }
    const binding = await findTelegramBindingByUser(identity.userId);
    if (!binding) {
      throw telegramClientError("Telegram account is not connected", 401);
    }
    return { binding, identity, ownerId: binding.owner };
  };

  const authenticateTelegramWebApp = async (request, response, next) => {
    if (!telegramEnabled) return clientError(response, "Telegram integration is not configured", 503);
    const initData = request.get("x-telegram-init-data");
    if (!initData || initData.length > 8_192) {
      return clientError(response, "Open this Mini App from Telegram", 401);
    }

    try {
      const validationResponse = await fetch(`${config.telegramValidatorUrl}/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Secret": config.telegramInternalSecret,
        },
        body: JSON.stringify({ initData }),
        signal: AbortSignal.timeout(5_000),
      });
      const result = await validationResponse.json().catch(() => null);
      if (!validationResponse.ok) {
        return clientError(
          response,
          result?.error || "Telegram Mini App authentication failed",
          validationResponse.status === 401 ? 401 : 503,
        );
      }
      request.telegramIdentity = normalizeTelegramIdentity(result?.identity);
      return next();
    } catch (error) {
      logger.warn("Telegram Mini App validation failed", error?.message || error);
      return clientError(response, "Telegram Mini App authentication is temporarily unavailable", 503);
    }
  };

  const findTelegramOwnedLink = async (reference, ownerId) => {
    const value = String(reference || "").trim().toLowerCase();
    const filter = /^[a-z0-9]{15}$/.test(value)
      ? client.filter("id = {:reference} && owner = {:owner}", { reference: value, owner: ownerId })
      : client.filter("slug = {:reference} && owner = {:owner}", { reference: value, owner: ownerId });
    try {
      return await client.collection(LINKS_COLLECTION).getFirstListItem(filter);
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  };

  app.post("/api/internal/telegram/connect", async (request, response, next) => {
    let identity;
    let tokenHash;
    try {
      identity = normalizeTelegramIdentity(request.body);
      tokenHash = hashTelegramLinkToken(request.body?.token, config.telegramInternalSecret);
    } catch (error) {
      return clientError(response, error.message);
    }

    try {
      let tokenRecord;
      try {
        const filter = client.filter("tokenHash = {:tokenHash}", { tokenHash });
        tokenRecord = await client.collection(TELEGRAM_LINK_TOKENS_COLLECTION).getFirstListItem(filter);
      } catch (error) {
        if (error?.status === 404) return clientError(response, "This Telegram login link is invalid or expired", 401);
        throw error;
      }

      if (new Date(tokenRecord.expiresAt) <= new Date()) {
        await client.collection(TELEGRAM_LINK_TOKENS_COLLECTION).delete(tokenRecord.id);
        return clientError(response, "This Telegram login link is invalid or expired", 401);
      }

      await client.collection(TELEGRAM_LINK_TOKENS_COLLECTION).delete(tokenRecord.id);
      const userBinding = await findTelegramBindingByUser(identity.userId);
      if (userBinding && userBinding.owner !== tokenRecord.owner) {
        return clientError(response, "This Telegram account is connected to another user", 409);
      }
      const ownerBinding = await findTelegramBindingByOwner(tokenRecord.owner);
      const bindingPayload = {
        owner: tokenRecord.owner,
        telegramUserId: identity.userId,
        chatId: identity.chatId,
        username: identity.username,
        firstName: identity.firstName,
      };
      if (ownerBinding) {
        await client.collection(TELEGRAM_ACCOUNTS_COLLECTION).update(ownerBinding.id, bindingPayload);
      } else {
        await client.collection(TELEGRAM_ACCOUNTS_COLLECTION).create(bindingPayload);
      }
      const user = await client.collection(USERS_COLLECTION).getOne(tokenRecord.owner, {
        fields: "id,email,name",
      });
      return response.json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/internal/telegram/me", async (request, response, next) => {
    try {
      const { binding, ownerId } = await resolveTelegramOwner(request.body);
      const user = await client.collection(USERS_COLLECTION).getOne(ownerId, { fields: "id,email,name" });
      return response.json({
        user: publicUser(user),
        telegram: { username: binding.username || null, firstName: binding.firstName || null },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.post("/api/internal/telegram/logout", async (request, response, next) => {
    try {
      const { binding } = await resolveTelegramOwner(request.body);
      await client.collection(TELEGRAM_ACCOUNTS_COLLECTION).delete(binding.id);
      return response.status(204).end();
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.post("/api/internal/telegram/links/list", async (request, response, next) => {
    try {
      const { ownerId } = await resolveTelegramOwner(request.body);
      const filter = client.filter("owner = {:owner}", { owner: ownerId });
      const records = await client.collection(LINKS_COLLECTION).getList(1, 20, {
        filter,
        sort: "-created",
        fields: "id,slug,url,clicks,active,created,statsToken",
      });
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        total: records.totalItems,
        links: records.items.map((record) => ({
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
          clicks: record.clicks,
          active: record.active,
        })),
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.post("/api/internal/telegram/links", async (request, response, next) => {
    let url;
    let alias;
    try {
      url = normalizeTargetUrl(request.body?.url);
      alias = normalizeAlias(request.body?.alias);
    } catch (error) {
      return clientError(response, error.message);
    }

    try {
      const { ownerId } = await resolveTelegramOwner(request.body);
      const record = await createRecord(client, url, alias, ownerId, config.anonymousLinkTtlMs);
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.status(201).json({
        link: {
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
          clicks: record.clicks,
          active: record.active,
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      if (isUniqueSlugError(error)) return clientError(response, "This slug is already taken", 409);
      return next(error);
    }
  });

  app.patch("/api/internal/telegram/links/:reference", async (request, response, next) => {
    let update;
    try {
      update = normalizeOwnedLinkUpdate(request.body);
    } catch (error) {
      return clientError(response, error.message);
    }

    try {
      const { ownerId } = await resolveTelegramOwner(request.body);
      const record = await findTelegramOwnedLink(request.params.reference, ownerId);
      if (!record) return clientError(response, "Link not found", 404);
      const updated = await client.collection(LINKS_COLLECTION).update(record.id, update);
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        link: {
          id: updated.id,
          slug: updated.slug,
          shortUrl: `${baseUrl}/${updated.slug}`,
          targetUrl: updated.url,
          clicks: updated.clicks,
          active: updated.active,
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      if (isUniqueSlugError(error)) return clientError(response, "This slug is already taken", 409);
      return next(error);
    }
  });

  app.post("/api/internal/telegram/links/:reference/stats", async (request, response, next) => {
    try {
      const { ownerId } = await resolveTelegramOwner(request.body);
      const record = await findTelegramOwnedLink(request.params.reference, ownerId);
      if (!record) return clientError(response, "Link not found", 404);
      const filter = client.filter("link = {:link}", { link: record.id });
      const events = await client.collection(CLICK_EVENTS_COLLECTION).getList(
        1,
        config.analyticsMaxEvents,
        {
          filter,
          sort: "-created",
          skipTotal: true,
          fields: "countryCode,referrerHost,visitorHash,device,browser,os",
        },
      );
      const analytics = buildAnalytics(events.items, record.clicks, 0, [], {
        hideSensitiveHeaders: config.hideSensitiveHeaders,
      });
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        link: {
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
          active: record.active,
        },
        analytics: {
          totals: analytics.totals,
          countries: analytics.countries.slice(0, 5),
          referrers: analytics.referrers.slice(0, 5),
          devices: analytics.devices.slice(0, 5),
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.post("/api/internal/telegram/links/:reference/delete", async (request, response, next) => {
    try {
      const { ownerId } = await resolveTelegramOwner(request.body);
      const record = await findTelegramOwnedLink(request.params.reference, ownerId);
      if (!record) return clientError(response, "Link not found", 404);
      await client.collection(LINKS_COLLECTION).delete(record.id);
      return response.status(204).end();
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.use("/api/telegram/webapp", apiLimiter, authenticateTelegramWebApp);

  app.get("/api/telegram/webapp/me", async (request, response, next) => {
    try {
      const { binding, ownerId } = await resolveTelegramOwner(request.telegramIdentity);
      const user = await client.collection(USERS_COLLECTION).getOne(ownerId, { fields: "id,email,name" });
      return response.json({
        user: publicUser(user),
        telegram: {
          username: binding.username || request.telegramIdentity.username || null,
          firstName: binding.firstName || request.telegramIdentity.firstName || null,
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.get("/api/telegram/webapp/links", async (request, response, next) => {
    try {
      const { ownerId } = await resolveTelegramOwner(request.telegramIdentity);
      const filter = client.filter("owner = {:owner}", { owner: ownerId });
      const records = await client.collection(LINKS_COLLECTION).getFullList({
        filter,
        sort: "-created",
        fields: "id,slug,url,clicks,active,created,statsToken",
      });
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        links: records.map((record) => ({
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
          clicks: record.clicks,
          active: record.active,
          created: record.created,
        })),
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.post("/api/telegram/webapp/links", async (request, response, next) => {
    let url;
    let alias;
    try {
      url = normalizeTargetUrl(request.body?.url);
      alias = normalizeAlias(request.body?.alias);
    } catch (error) {
      return clientError(response, error.message);
    }

    try {
      const { ownerId } = await resolveTelegramOwner(request.telegramIdentity);
      const record = await createRecord(client, url, alias, ownerId, config.anonymousLinkTtlMs);
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.status(201).json({
        link: {
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
          clicks: record.clicks,
          active: record.active,
          created: record.created,
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      if (isUniqueSlugError(error)) return clientError(response, "This slug is already taken", 409);
      return next(error);
    }
  });

  app.patch("/api/telegram/webapp/links/:reference", async (request, response, next) => {
    let update;
    try {
      update = normalizeOwnedLinkUpdate(request.body);
    } catch (error) {
      return clientError(response, error.message);
    }

    try {
      const { ownerId } = await resolveTelegramOwner(request.telegramIdentity);
      const record = await findTelegramOwnedLink(request.params.reference, ownerId);
      if (!record) return clientError(response, "Link not found", 404);
      const updated = await client.collection(LINKS_COLLECTION).update(record.id, update);
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        link: {
          id: updated.id,
          slug: updated.slug,
          shortUrl: `${baseUrl}/${updated.slug}`,
          targetUrl: updated.url,
          clicks: updated.clicks,
          active: updated.active,
          created: updated.created,
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      if (isUniqueSlugError(error)) return clientError(response, "This slug is already taken", 409);
      return next(error);
    }
  });

  app.delete("/api/telegram/webapp/links/:reference", async (request, response, next) => {
    try {
      const { ownerId } = await resolveTelegramOwner(request.telegramIdentity);
      const record = await findTelegramOwnedLink(request.params.reference, ownerId);
      if (!record) return clientError(response, "Link not found", 404);
      await client.collection(LINKS_COLLECTION).delete(record.id);
      return response.status(204).end();
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.get("/api/telegram/webapp/links/:reference/stats", async (request, response, next) => {
    try {
      const { ownerId } = await resolveTelegramOwner(request.telegramIdentity);
      const record = await findTelegramOwnedLink(request.params.reference, ownerId);
      if (!record) return clientError(response, "Link not found", 404);
      const filter = client.filter("link = {:link}", { link: record.id });
      const events = await client.collection(CLICK_EVENTS_COLLECTION).getList(
        1,
        config.analyticsMaxEvents,
        {
          filter,
          sort: "-created",
          skipTotal: true,
          fields: "countryCode,referrerHost,visitorHash,device,browser,os",
        },
      );
      const analytics = buildAnalytics(events.items, record.clicks, 0, [], {
        hideSensitiveHeaders: config.hideSensitiveHeaders,
      });
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        link: {
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
          active: record.active,
        },
        analytics: {
          totals: analytics.totals,
          countries: analytics.countries.slice(0, 10),
          referrers: analytics.referrers.slice(0, 10),
          devices: analytics.devices.slice(0, 10),
          browsers: analytics.browsers.slice(0, 10),
          operatingSystems: analytics.operatingSystems.slice(0, 10),
        },
      });
    } catch (error) {
      if (error?.telegramClientError) return clientError(response, error.message, error.status);
      return next(error);
    }
  });

  app.get("/api/links", authenticate, async (request, response, next) => {
    try {
      const filter = client.filter("owner = {:owner}", { owner: request.user.id });
      const records = await client.collection(LINKS_COLLECTION).getFullList({
        filter,
        sort: "-created",
        fields: "id,slug,url,clicks,active,created,expiresAt,statsToken",
      });
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      response.json({
        links: records.map((record) => ({
          id: record.id,
          slug: record.slug,
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          clicks: record.clicks,
          active: record.active,
          created: record.created,
          expiresAt: record.expiresAt || null,
          statsUrl: `${baseUrl}/stats/${record.statsToken}`,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/links", apiLimiter, optionalAuthenticate, async (request, response, next) => {
    try {
      let url;
      let alias;

      try {
        url = normalizeTargetUrl(request.body?.url);
        alias = normalizeAlias(request.body?.alias);
      } catch (error) {
        return clientError(response, error.message);
      }

      if (alias && !request.user) {
        return clientError(response, "Custom slugs are available only to registered users", 403);
      }

      const record = await createRecord(
        client,
        url,
        alias,
        request.user?.id,
        config.anonymousLinkTtlMs,
      );
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);

      return response.status(201).json({
        slug: record.slug,
        shortUrl: `${baseUrl}/${record.slug}`,
        targetUrl: record.url,
        clicks: record.clicks,
        active: record.active,
        created: record.created,
        expiresAt: record.expiresAt || null,
        statsUrl: `${baseUrl}/stats/${record.statsToken}`,
      });
    } catch (error) {
      if (isUniqueSlugError(error)) {
        return clientError(response, "This slug is already taken", 409);
      }
      return next(error);
    }
  });

  const findOwnedLink = async (id, ownerId) => {
    if (!/^[a-z0-9]{15}$/.test(id)) return null;
    try {
      const filter = client.filter("id = {:id} && owner = {:owner}", { id, owner: ownerId });
      return await client.collection(LINKS_COLLECTION).getFirstListItem(filter);
    } catch (error) {
      if (error?.status === 404) return null;
      throw error;
    }
  };

  app.patch("/api/links/:id", apiLimiter, authenticate, async (request, response, next) => {
    let update;
    try {
      update = normalizeOwnedLinkUpdate(request.body);
    } catch (error) {
      return clientError(response, error.message);
    }

    try {
      const record = await findOwnedLink(request.params.id, request.user.id);
      if (!record) return clientError(response, "Link not found", 404);
      const updated = await client
        .collection(LINKS_COLLECTION)
        .update(record.id, update);
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      return response.json({
        id: updated.id,
        slug: updated.slug,
        shortUrl: `${baseUrl}/${updated.slug}`,
        targetUrl: updated.url,
        active: updated.active,
      });
    } catch (error) {
      if (isUniqueSlugError(error)) return clientError(response, "This slug is already taken", 409);
      return next(error);
    }
  });

  app.delete("/api/links/:id", apiLimiter, authenticate, async (request, response, next) => {
    try {
      const record = await findOwnedLink(request.params.id, request.user.id);
      if (!record) return clientError(response, "Link not found", 404);
      await client.collection(LINKS_COLLECTION).delete(record.id);
      return response.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/stats/:token", async (request, response, next) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.params.token)) {
      return clientError(response, "Statistics not found", 404);
    }

    try {
      const filter = client.filter("statsToken = {:token}", { token: request.params.token });
      const record = await client.collection(LINKS_COLLECTION).getFirstListItem(filter, {
        fields: "id,slug,url,clicks,active,created,expiresAt",
      });
      const eventsFilter = client.filter("link = {:link}", { link: record.id });
      const [eventsPage, recentEventsPage] = await Promise.all([
        client.collection(CLICK_EVENTS_COLLECTION).getList(
          1,
          config.analyticsMaxEvents,
          {
            filter: eventsFilter,
            sort: "-created",
            skipTotal: true,
            fields:
              "countryCode,referrerHost,visitorHash,device,browser,os",
          },
        ),
        client.collection(CLICK_EVENTS_COLLECTION).getList(
          1,
          config.analyticsRecentEvents,
          {
            filter: eventsFilter,
            sort: "-created",
            skipTotal: true,
            fields:
              "id,countryCode,referrer,referrerHost,ipAddress,device,browser,os,requestMethod,requestProtocol,requestHost,requestPath,httpVersion,requestHeaders,created",
          },
        ),
      ]);
      const baseUrl = getPublicBaseUrl(request, config.publicBaseUrl);
      const expired = Boolean(record.expiresAt && new Date(record.expiresAt) <= new Date());
      return response.json({
        link: {
          shortUrl: `${baseUrl}/${record.slug}`,
          targetUrl: record.url,
          clicks: record.clicks,
          active: record.active,
          created: record.created,
          expiresAt: record.expiresAt || null,
          expired,
        },
        analytics: buildAnalytics(
          eventsPage.items,
          record.clicks,
          config.analyticsRecentEvents,
          recentEventsPage.items,
          { hideSensitiveHeaders: config.hideSensitiveHeaders },
        ),
      });
    } catch (error) {
      if (error?.status === 404) return clientError(response, "Statistics not found", 404);
      return next(error);
    }
  });

  app.get("/stats/:token", (_request, response) => {
    response.sendFile(path.join(publicDirectory, "stats.html"));
  });

  app.get("/:slug", async (request, response, next) => {
    const slug = request.params.slug.toLowerCase();
    if (!isValidSlug(slug)) return next();

    try {
      const filter = client.filter("slug = {:slug} && active = true", { slug });
      const record = await client.collection(LINKS_COLLECTION).getFirstListItem(filter);

      if (record.expiresAt && new Date(record.expiresAt) <= new Date()) return next();

      const clickDetails = await captureClickDetails(request, config, geoIpResolver);
      const writes = await Promise.allSettled([
        client.collection(LINKS_COLLECTION).update(record.id, { "clicks+": 1 }),
        client.collection(CLICK_EVENTS_COLLECTION).create({
          link: record.id,
          ...clickDetails,
        }),
      ]);
      for (const write of writes) {
        if (write.status === "rejected") logger.error("Failed to record click analytics", write.reason);
      }

      return response.redirect(302, record.url);
    } catch (error) {
      if (error?.status === 404) return next();
      return next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).sendFile(path.join(publicDirectory, "404.html"));
  });

  app.use((error, _request, response, _next) => {
    logger.error(error);
    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}
