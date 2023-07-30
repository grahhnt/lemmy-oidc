export default {
  // https://github.com/panva/node-oidc-provider/tree/main/docs#clients
  clients: [
    {
      client_id: "lemmy-canvas",
      client_secret: "EXAMPLE_SECRET",
      grant_types: ["refresh_token", "authorization_code"],
      redirect_uris: ["https://canvas.toast.ooo/auth/lemmy"],
    },
  ],
  interactions: {
    url(ctx, interaction) {
      // eslint-disable-line no-unused-vars
      return `/interaction/${interaction.uid}`;
    },
  },
  cookies: {
    keys: ["A RANDOM STRING"],
  },
  claims: {
    profile: ["sub"],
  },
  // https://github.com/panva/node-oidc-provider/tree/main/docs#features
  features: {
    devInteractions: { enabled: false }, // defaults to true

    deviceFlow: { enabled: true }, // defaults to false
    revocation: { enabled: true }, // defaults to false

    userinfo: { enabled: true }, // defaults to true ; we use it explicitly
  },
  // https://github.com/panva/node-oidc-provider/tree/main/docs#jwks
  jwks: {
    // generate jwks keys
    // try https://mkjwk.org/
  },
  pkce: {
    required: () => false,
  },
};
