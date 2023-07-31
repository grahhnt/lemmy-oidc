/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from "node:assert";
import * as querystring from "node:querystring";
import { inspect } from "node:util";

import isEmpty from "lodash/isEmpty.js";
import { urlencoded } from "express"; // eslint-disable-line import/no-unresolved

import Account from "./account.js";
import LemmyAuth from "./lemmyauth.js";
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

        const username = req.body.login + "@" + req.body.instance;

        if (req.body.token) {
          const code = await LemmyAuth.getCode(username);

          if (req.body.token + "" !== code + "") {
            throw new Error("Code does not match");
          }

          await LemmyAuth.removeCode(username);

          const account = await Account.findByLogin(username);

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
        } else {
          await LemmyAuth.isValidInstance(req.body.instance);

          const code = await LemmyAuth.createCode(username);
          LemmyAuth.pm(
            username,
            `You or someone else is trying to identify you using lemmy-oidc\n\nCode: ${code}\n\nIf you did not request this code; you can safely ignore it\n\nhttps://github.com/grahhnt/lemmy-oidc`
          );
          throw new Error("sent_code");
        }
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
      r_client: {
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
