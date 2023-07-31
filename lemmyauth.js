import { DB } from "./adapters/mongodb.js";

class LemmyAuth {
  auth;

  constructor() {
    this.login();
  }

  async login() {
    const {
      LEMMY_USER_INSTANCE: instance,
      LEMMY_USER: username,
      LEMMY_PASSWORD: password,
    } = process.env;
    console.info("Logging into Lemmy account...", { instance, username });

    const login = await fetch(`https://${instance}/api/v3/user/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username_or_email: username,
        password,
      }),
    }).then((a) => a.json());

    if (login.error) {
      console.error("Logging into lemmy account failed.", login);
      process.exit(1);
    }

    this.auth = login.jwt;
    console.log("Logged into Lemmy account");
  }

  async getActorID(username) {
    const { LEMMY_USER_INSTANCE: instance } = process.env;

    const actor = await fetch(
      `https://${instance}/api/v3/user?auth=${this.auth}&username=${username}`
    ).then((a) => a.json());

    if (actor.error || !actor?.person_view?.person?.id) {
      throw new Error("Can't find account");
    }

    return actor?.person_view?.person?.id;
  }

  async pm(username, content) {
    const { LEMMY_USER_INSTANCE: instance } = process.env;

    const actorId = await this.getActorID(username);

    const pm = await fetch(`https://${instance}/api/v3/private_message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth: this.auth,
        content,
        recipient_id: actorId,
      }),
    }).then((a) => a.json());

    if (pm.error) {
      console.error("create pm", { username, content }, pm);
      throw new Error("Failed to send direct message");
    }

    return true;
  }

  async getCode(username) {
    const data = await DB.collection("pm_codes").findOne({ _id: username });

    if (data.expiresAt < new Date().getTime()) {
      await DB.collection("pm_codes").deleteOne({
        _id: username,
      });
      throw new Error("No code");
    }

    return data.code;
  }

  async createCode(username) {
    const data = await DB.collection("pm_codes").findOne({ _id: username });

    if (data && data.expiresAt < new Date().getTime()) {
      // todo: limit by once per 10 minutes
      throw new Error("too_frequent");
    }

    const code = parseInt(
      "."
        .repeat(5)
        .split("")
        .map((l) => Math.floor(Math.random() * 10) + "")
        .join("")
    );

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await DB.collection("pm_codes").updateOne(
      { _id: username },
      { $set: { code, expiresAt: expiresAt.getTime() } },
      { upsert: true }
    );

    return code;
  }

  async removeCode(username) {
    await DB.collection("pm_codes").deleteOne({ _id: username });
  }

  async isValidInstance(instance) {
    const nodeinfo_basic = await fetch(
      `https://${instance}/.well-known/nodeinfo`
    ).then((a) => a.json());
    const nodeinfo2 = nodeinfo_basic?.links?.find(
      (l) => l.rel === "http://nodeinfo.diaspora.software/ns/schema/2.0"
    )?.href;
    if (!nodeinfo2) throw new Error("no_nodeinfo");

    const nodeinfo = await fetch(nodeinfo2).then((a) => a.json());
    if (!nodeinfo.protocols.find((p) => p === "activitypub"))
      throw new Error("no_activitypub_support");

    return true;
  }
}

export default new LemmyAuth();
