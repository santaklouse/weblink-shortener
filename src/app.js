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
  USERS_COLLECTION,
} from "./pocketbase.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "../public");

function clientError(response, message, status = 400, code) {
  const body = { error: message };
  if (code) body.code = code;
  return response.status(status).json(body);
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
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "8kb" }));
  app.use(cookieParser());
  app.use(express.static(publicDirectory, { extensions: ["html"], maxAge: "1h" }));
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
      response.json({ google: Boolean(google) });
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
    if (typeof request.body?.active !== "boolean") {
      return clientError(response, "The active field must be true or false");
    }

    try {
      const record = await findOwnedLink(request.params.id, request.user.id);
      if (!record) return clientError(response, "Link not found", 404);
      const updated = await client
        .collection(LINKS_COLLECTION)
        .update(record.id, { active: request.body.active });
      return response.json({ id: updated.id, active: updated.active });
    } catch (error) {
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
