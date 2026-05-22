# Composer API

Minimal Cloudflare Worker proxy exposing OpenAI-compatible endpoints backed by Cursor Composer.

Supported routes:

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `GET /v1/models`
- `POST /opencode/v1/chat/completions`
- `GET /opencode/v1/models`

Authenticate with a Cursor API key as the bearer token. The Worker forwards it to Cursor per request and does not store keys, create accounts, log requests to D1, or serve a frontend.

```bash
curl https://<deployment>/v1/chat/completions \
  -H "Authorization: Bearer $CURSOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","messages":[{"role":"user","content":"Hello"}]}'
```

Required Worker secrets:

```txt
CURSOR_BACKEND_BASE_URL
CURSOR_CHAT_ENDPOINT
```

Optional vars/secrets:

```txt
CURSOR_API_BASE=https://api.cursor.com
CURSOR_CLIENT_VERSION=2.6.22
ENCRYPTION_KEY=<stable salt for Cursor machine identity>
```

Local/deploy commands:

```bash
npm install
npm run dev
npm run test
npm run typecheck
npm run deploy
```
