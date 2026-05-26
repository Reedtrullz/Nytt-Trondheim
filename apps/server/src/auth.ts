import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { Strategy as GitHubStrategy, type Profile } from "passport-github2";
import type pg from "pg";
import type { AppConfig } from "./config.js";

export interface AuthUser {
  login: string;
  displayName: string;
  avatarUrl?: string;
}

declare global {
  // Express uses namespace merging for authenticated request users.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      login: string;
      displayName: string;
      avatarUrl?: string;
    }
  }
}

export function configureAuth(app: Express, config: AppConfig, pool?: pg.Pool): void {
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
      req.user = { login: config.githubAllowedLogin, displayName: "Utviklingsbruker" };
      next();
    });
    return;
  }

  if (!config.githubClientId || !config.githubClientSecret) {
    throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production.");
  }

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user: Express.User, done) => done(null, user));
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.githubClientId,
        clientSecret: config.githubClientSecret,
        callbackURL: `${config.publicOrigin}/auth/github/callback`,
      },
      (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (error: Error | null, user?: AuthUser | false) => void,
      ) => {
        if (
          profile.username?.toLocaleLowerCase() !== config.githubAllowedLogin.toLocaleLowerCase()
        ) {
          done(null, false);
          return;
        }
        done(null, {
          login: profile.username,
          displayName: profile.displayName || profile.username,
          avatarUrl: profile.photos?.[0]?.value,
        });
      },
    ),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.get("/auth/github", passport.authenticate("github", { scope: ["read:user"] }));
  app.get(
    "/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/?auth=denied" }),
    (_req, res) => res.redirect("/"),
  );
  app.post("/auth/logout", (req, res, next) => {
    req.logout((error) => {
      if (error) return next(error);
      req.session.destroy(() => res.status(204).end());
    });
  });
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }
  res.status(401).json({ error: "Innlogging kreves.", loginUrl: "/auth/github" });
}

export function currentLogin(req: Request): string {
  if (!req.user) throw new Error("Authenticated user missing");
  return req.user.login;
}
