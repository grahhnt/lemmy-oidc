/* eslint-disable no-console */

import * as path from "node:path";
import * as url from "node:url";

import "dotenv/config";

import { dirname } from "desm";
import express from "express"; // eslint-disable-line import/no-unresolved
import helmet from "helmet";

import Provider from "oidc-provider"; // from 'oidc-provider';

import Account from "./account.js";
import configuration from "./config.js";
import routes from "./routes.js";
import lemmyauth from "./lemmyauth.js";

const __dirname = dirname(import.meta.url);

const { PORT = 3000, ISSUER = `https://oidc.toast.ooo` } = process.env;
configuration.findAccount = Account.findAccount;

const app = express();

const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
delete directives["form-action"];
directives["script-src"] = ["'self'"];
directives["default-src"].push("*");
directives["img-src"].push("*");
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives,
    },
  })
);

app.use(express.static("public"));
app.get("/api/get-software", async (req, res) => {
  if (!req.query.domain) {
    res.json({
      success: false,
      error: "Missing ?domain",
    });
    return;
  }

  const HOST = req.query.domain.replace(/https?:\/\//gi, "").split("/")[0];
  if (!HOST?.length) {
    res.json({
      success: false,
      error: "Invalid domain",
    });
    return;
  }
  let meta = {
    name: "",
    icon: "",
  };
  let software = {
    name: "",
    version: "",
  };

  let info = [];

  try {
    const wk_nodeinfo = await fetch(
      `https://${HOST}/.well-known/nodeinfo`
    ).then((a) => a.json());

    if (!wk_nodeinfo?.links?.length) {
      throw new Error("Nodeinfo is invalid");
    }

    const nodeinfo_url = wk_nodeinfo.links.find(
      (l) => l.rel === "http://nodeinfo.diaspora.software/ns/schema/2.0"
    )?.href;

    if (!nodeinfo_url) {
      throw new Error("Nodeinfo 2.0 not found");
    }

    const nodeinfo = await fetch(nodeinfo_url).then((a) => a.json());

    if (
      !nodeinfo?.software?.name ||
      nodeinfo.software.name.toLowerCase() !== "lemmy"
    ) {
      info.push(
        "Instance is not a Lemmy instance, you may not be able to receive the code (LemmyNet/lemmy#2657)"
      );
    } else {
      const lemmyMeta = await fetch(`https://${HOST}/api/v3/site`).then((a) =>
        a.json()
      );

      if (lemmyMeta?.site_view?.site?.name) {
        meta.name = lemmyMeta.site_view.site.name;
      }

      if (lemmyMeta?.site_view?.site?.icon) {
        meta.icon = lemmyMeta.site_view.site.icon;
      }
    }

    software.name = nodeinfo.software.name;
    software.version = nodeinfo.software.version;
  } catch (e) {
    res.json({
      success: false,
      error: e.message,
    });
    return;
  }

  res.json({
    success: true,
    software,
    meta,
    info,
  });
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

let server;
try {
  let adapter;
  if (process.env.MONGODB_URI) {
    ({ default: adapter } = await import("./adapters/mongodb.js"));
    await adapter.connect();
  }

  const prod = process.env.NODE_ENV === "production";

  const provider = new Provider(ISSUER, { adapter, ...configuration });

  if (prod) {
    app.enable("trust proxy");
    provider.proxy = true;

    app.use((req, res, next) => {
      if (req.secure) {
        next();
      } else if (req.method === "GET" || req.method === "HEAD") {
        res.redirect(
          url.format({
            protocol: "https",
            host: req.get("host"),
            pathname: req.originalUrl,
          })
        );
      } else {
        res.status(400).json({
          error: "invalid_request",
          error_description: "do yourself a favor and only use https",
        });
      }
    });
  }

  routes(app, provider);
  app.use(provider.callback());
  server = app.listen(PORT, () => {
    console.log(
      `application is listening on port ${PORT}, check its /.well-known/openid-configuration`
    );
  });
} catch (err) {
  if (server?.listening) server.close();
  console.error(err);
  process.exitCode = 1;
}
