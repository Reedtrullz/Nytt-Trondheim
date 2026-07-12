import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as GitHubStrategy, type Profile } from "passport-github2";
import type pg from "pg";
import type { AppConfig } from "./config.js";

export interface AuthUser {
  id: string;
  login: string;
  displayName: string;
  role: "owner" | "viewer";
  status: "active" | "revoked";
  email?: string;
  avatarUrl?: string;
}

export interface AuthAccountStore {
  ensureGitHubOwner(profile: Profile, allowedLogin: string): Promise<AuthUser | false>;
  authUserById(id: string): Promise<AuthUser | undefined>;
}

export function authorizeGitHubProfile(
  profile: Pick<Profile, "username" | "displayName" | "photos">,
  allowedLogin: string,
): AuthUser | false {
  if (profile.username?.toLocaleLowerCase() !== allowedLogin.toLocaleLowerCase()) return false;
  return {
    id: `github:${profile.username.toLocaleLowerCase()}`,
    login: profile.username,
    displayName: profile.displayName || profile.username,
    role: "owner",
    status: "active",
    avatarUrl: profile.photos?.[0]?.value,
  };
}

declare global {
  // Express uses namespace merging for authenticated request users.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: string;
      login: string;
      displayName: string;
      role: "owner" | "viewer";
      status: "active" | "revoked";
      email?: string;
      avatarUrl?: string;
    }
  }
}

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
  }
}

export function configureAuth(
  app: Express,
  config: AppConfig,
  accountStore: AuthAccountStore,
  pool?: pg.Pool,
): void {
  const PgSessionStore = connectPgSimple(session);
  app.use(
    session({
      name: "nytt.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: config.nodeEnv === "production",
      store: pool ? new PgSessionStore({ pool, tableName: "session" }) : undefined,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.nodeEnv === "production",
        maxAge: 1000 * 60 * 60 * 24 * 14,
      },
    }),
  );

  if (config.devAuthBypass) {
    app.use((req, _res, next) => {
      req.user = {
        id: "dev-owner",
        login: config.githubAllowedLogin,
        displayName: "Utviklingsbruker",
        role: "owner",
        status: "active",
      };
      next();
    });
    return;
  }

  if (!config.githubClientId || !config.githubClientSecret) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production.");
  }

  const authenticator = new passport.Passport();
  authenticator.serializeUser((user, done) => done(null, user.id));
  authenticator.deserializeUser((serialized: unknown, done) => {
    // Accept the pre-migration object shape so sessions issued by the previous release
    // are revalidated instead of being trusted or needlessly logged out during rollout.
    const id =
      typeof serialized === "string"
        ? serialized
        : typeof serialized === "object" &&
            serialized !== null &&
            "id" in serialized &&
            typeof serialized.id === "string"
          ? serialized.id
          : undefined;
    if (!id) {
      done(null, false);
      return;
    }
    accountStore
      .authUserById(id)
      .then((user) => done(null, user ?? false))
      .catch((error: Error) => done(error));
  });
  authenticator.use(
    new GitHubStrategy(
      {
        clientID: config.githubClientId,
        clientSecret: config.githubClientSecret,
        callbackURL: `${config.publicOrigin}/auth/github/callback`,
        // passport-github2 types expose this as string; any truthy strategy value enables nonce state storage.
        state: "enabled",
      },
      (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (error: Error | null, user?: AuthUser | false) => void,
      ) => {
        accountStore
          .ensureGitHubOwner(profile, config.githubAllowedLogin)
          .then((user) => done(null, user))
          .catch((error: Error) => done(error));
      },
    ),
  );
  app.use(authenticator.initialize());
  app.use(authenticator.session());
  // GitHub Apps grant user-token access through configured permissions, not OAuth scopes.
  app.get("/auth/github", authenticator.authenticate("github"));
  app.get(
    "/auth/github/callback",
    authenticator.authenticate("github", { failureRedirect: "/logg-inn?auth=denied" }),
    (_req, res) => res.redirect("/"),
  );
  app.post("/auth/logout", requireUser, requireCsrf(config), (req, res, next) => {
    req.logout((error) => {
      if (error) return next(error);
      req.session.destroy(() => res.status(204).end());
    });
  });
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.status === "active") {
    next();
    return;
  }
  if (req.user?.status === "revoked") {
    req.logout(() => {
      req.session.destroy(() => res.status(403).json({ error: "Tilgangen er tilbakekalt." }));
    });
    return;
  }
  res.status(401).json({ error: "Innlogging kreves.", loginUrl: "/logg-inn" });
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  requireUser(req, res, () => {
    if (req.user?.role === "owner") {
      next();
      return;
    }
    res.status(403).json({ error: "Dette krever eiertilgang." });
  });
}

export function csrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

export function requireCsrf(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    if (origin && origin !== config.publicOrigin) {
      res.status(403).json({ error: "Ugyldig forespørselsopprinnelse." });
      return;
    }
    const expected = csrfToken(req);
    const bodyToken =
      typeof req.body === "object" &&
      req.body !== null &&
      "_csrf" in req.body &&
      typeof req.body._csrf === "string"
        ? req.body._csrf
        : "";
    const supplied = req.get("x-csrf-token") ?? bodyToken;
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (
      expectedBuffer.length !== suppliedBuffer.length ||
      !timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      res.status(403).json({ error: "Ugyldig CSRF-token." });
      return;
    }
    next();
  };
}

export function currentLogin(req: Request): string {
  if (!req.user) throw new Error("Authenticated user missing");
  return req.user.login;
}
