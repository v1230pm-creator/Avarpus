# Hostinger deployment guide

This is a static React application. It can be hosted on Hostinger, but it still needs the Avarpus API service for authentication, business data, uploads, chat, and permissions.

## Recommended domain split

| Service | Recommended hostname | Hosted by |
| --- | --- | --- |
| Web application | `app.avarpus.com` | Hostinger |
| API | `api.avarpus.com` | Replit API deployment |

Keeping the API on its own hostname prevents the static Hostinger site from needing a server-side proxy.

## 1. Make the API publicly reachable

1. Publish the API service on Replit and attach `api.avarpus.com` as a verified custom domain.
2. Add its required DNS record in the DNS provider that controls `avarpus.com`, using the exact target shown by Replit.
3. In Replit environment variables, set `ALLOWED_ORIGINS` to a comma-separated list that includes `https://app.avarpus.com`. Keep the development preview origin if you still use it.
4. Confirm `https://api.avarpus.com/api/health` or another public API endpoint responds over HTTPS before continuing.

The browser app sends bearer tokens in the `Authorization` header. Do not use a wildcard CORS origin.

## 2. Build the static site

From the repository root:

```bash
cp artifacts/avarpus-web/.env.production.example artifacts/avarpus-web/.env.production
# Verify VITE_API_URL points to the public API origin, then:
pnpm --filter @workspace/avarpus-web run build
```

The deployable files are in:

```text
artifacts/avarpus-web/dist/public
```

`VITE_API_URL` is embedded into the compiled JavaScript. Changing the API hostname requires a new build.

## 3. Upload to Hostinger

1. In hPanel, create or select the `app.avarpus.com` subdomain and open its document root.
2. Upload the **contents** of `dist/public` to that document root — not the parent `dist` folder.
3. Keep the included `.htaccess` file. It makes direct visits to routes such as `/repairs` and `/customers` load the React application instead of returning a 404.
4. Point the `app.avarpus.com` DNS record to Hostinger, then wait for DNS and HTTPS issuance to complete.

## 4. Verify before sharing

1. Visit `https://app.avarpus.com`.
2. Sign in with an existing Avarpus account.
3. In browser developer tools, confirm requests go to `https://api.avarpus.com/api/...` and do not show a CORS error.
4. Reload a nested URL such as `https://app.avarpus.com/repairs` to confirm the SPA fallback works.
5. Test a role-limited account: protected pages must show an access-denied state and API mutations must remain rejected server-side.

## Security notes

- Never put database credentials, API secrets, Matrix credentials, or server tokens in `VITE_*` variables. Anything beginning with `VITE_` is public in the browser bundle.
- Login state is a bearer token stored by the web application; log out on shared devices.
- A static Hostinger site cannot hide or enforce permissions. The API remains the authority for identity, shop isolation, roles, feature toggles, and accounting rules.