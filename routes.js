/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from "node:assert";
import * as querystring from "node:querystring";
import { inspect } from "node:util";

import isEmpty from "lodash/isEmpty.js";
import { urlencoded } from "express"; // eslint-disable-line import/no-unresolved

import Account from "./account.js";
import { errors } from "oidc-provider";

const body = urlencoded({ extended: false });

const { SessionNotFound } = errors;
export default (app, provider) => {
  app.use((req, res, next) => {
    const orig = res.render;
    // you'll probably want to use a full blown render engine capable of layouts
    res.render = (view, locals) => {
      app.render(view, locals, (err, html) => {
        if (err) throw err;
        orig.call(res, "_layout", {
          ...locals,
          body: html,
        });
      });
    };
    next();
  });

  app.get("/", (req, res) => {
    res.render("index", {
      title: "Lemmy OIDC",
      uid: null,
      r_client: {},
    });
  });

  function setNoCache(req, res, next) {
    res.set("cache-control", "no-store");
    next();
  }

  app.get("/interaction/:uid", setNoCache, async (req, res, next) => {
    try {
      const { uid, prompt, params, session } =
        await provider.interactionDetails(req, res);

      const client = await provider.Client.find(params.client_id);

      switch (prompt.name) {
        case "login": {
          return res.render("login", {
            r_client: client,
            uid,
            details: prompt.details,
            params,
            title: "Sign-in",
          });
        }
        case "consent": {
          return res.render("interaction", {
            r_client: client,
            uid,
            details: prompt.details,
            params,
            title: "Authorize",
            session: session,
          });
        }
        default:
          return undefined;
      }
    } catch (err) {
      return next(err);
    }
  });

  app.post(
    "/interaction/:uid/login",
    setNoCache,
    body,
    async (req, res, next) => {
      try {
        const {
          prompt: { name },
        } = await provider.interactionDetails(req, res);
        assert.equal(name, "login");

        if (!req.body.instance) {
          throw new Error("Missing instance");
        }

        if (!req.body.login) {
          throw new Error("Missing username");
        }

        if (!req.body.password) {
          throw new Error("Missing password");
        }

        const lemmyauth = await fetch(
          `https://${req.body.instance}/api/v3/user/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              username_or_email: req.body.login,
              password: req.body.password,
              totp_2fa_token: req.body.totp,
            }),
          }
        ).then((a) => a.json());

        // lemmy does respond with a space in `incorrect_totp token`
        if (
          lemmyauth.error === "missing_totp_token" ||
          lemmyauth.error === "incorrect_totp token"
        ) {
          throw new Error("totp_token");
        }

        if (lemmyauth.error) {
          throw new Error("Lemmy login failed");
        }

        const jwt = lemmyauth.jwt;

        const lemmyuser = await fetch(
          `https://${req.body.instance}/api/v3/site?auth=${jwt}`
        ).then((a) => a.json());

        if (!lemmyuser || lemmyuser.error || !lemmyuser.my_user) {
          throw new Error("Lemmy auth failed");
        }

        if (
          lemmyuser.my_user.local_user_view.person.banned ||
          lemmyuser.my_user.local_user_view.person.deleted
        ) {
          throw new Error("Lemmy user invalid");
        }

        const account = await Account.findByLogin(
          lemmyuser.my_user.local_user_view.person.name +
            "@" +
            req.body.instance
        );

        const result = {
          login: {
            accountId: account.accountId,
          },
        };

        const intresult = await provider.interactionResult(req, res, result, {
          mergeWithLastSubmission: false,
        });

        res.json({
          success: true,
          redirect: intresult,
        });
      } catch (err) {
        res.json({
          success: false,
          error: err.message,
        });
      }
    }
  );

  app.post(
    "/interaction/:uid/confirm",
    setNoCache,
    body,
    async (req, res, next) => {
      try {
        const interactionDetails = await provider.interactionDetails(req, res);
        const {
          prompt: { name, details },
          params,
          session: { accountId },
        } = interactionDetails;
        assert.equal(name, "consent");

        let { grantId } = interactionDetails;
        let grant;

        if (grantId) {
          // we'll be modifying existing grant in existing session
          grant = await provider.Grant.find(grantId);
        } else {
          // we're establishing a new grant
          grant = new provider.Grant({
            accountId,
            clientId: params.client_id,
          });
        }

        if (details.missingOIDCScope) {
          grant.addOIDCScope(details.missingOIDCScope.join(" "));
        }
        if (details.missingOIDCClaims) {
          grant.addOIDCClaims(details.missingOIDCClaims);
        }
        if (details.missingResourceScopes) {
          for (const [indicator, scopes] of Object.entries(
            details.missingResourceScopes
          )) {
            grant.addResourceScope(indicator, scopes.join(" "));
          }
        }

        grantId = await grant.save();

        const consent = {};
        if (!interactionDetails.grantId) {
          // we don't have to pass grantId to consent, we're just modifying existing one
          consent.grantId = grantId;
        }

        const result = { consent };
        await provider.interactionFinished(req, res, result, {
          mergeWithLastSubmission: true,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get("/interaction/:uid/abort", setNoCache, async (req, res, next) => {
    try {
      const result = {
        error: "access_denied",
        error_description: "End-User aborted interaction",
      };
      await provider.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/logout", setNoCache, async (req, res, next) => {
    res.clearCookie("_session.legacy.sig");
    res.clearCookie("_session.legacy");
    res.clearCookie("_session.sig");
    res.clearCookie("_session");
    res.render("loggedout", {
      uid: false,
      client: {
        tosUri: null,
        policyUri: null,
      },
      title: "Logged Out",
    });
  });

  app.use((err, req, res, next) => {
    if (err instanceof SessionNotFound) {
      // handle interaction expired / session not found error
    }
    next(err);
  });
};
