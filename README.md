# Lemmy OIDC

A gateway to allow [Lemmy](https://github.com/lemmynet/lemmy) servers to have OpenID Connect capabilities.

[An issue on Lemmy to add OpenID Connect](https://github.com/LemmyNet/lemmy/issues/1368)

Built using [node-oidc-provider](https://github.com/panva/node-oidc-provider)

## Running

**NodeJS 18 required**

- Copy `.env.example` to `.env` and configure
- Copy `config.example.js` to `config.js` and configure
- Copy `views/footer.example.ejs` to `views/footer.ejs` and update
- - Putting a contact & source is suggested
- `npm install`
- `node index.js`
