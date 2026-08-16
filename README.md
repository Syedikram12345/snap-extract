# SnapExtract

Screenshot → clean text/code with an **admin-controlled OCR provider**.

## Provider switch

Open `/admin` and sign in with `ADMIN_PASSWORD`.

- **Local OCR**: Tesseract.js runs in the visitor's browser. No OpenAI key, no API bill, and the screenshot does not go to SnapExtract's server.
- **OpenAI**: the screenshot is sent to the server and processed with OpenAI when you are ready to pay for stronger AI extraction.

### Important production detail

The default local provider is persisted in `data/provider.json` for local development and persistent servers. On serverless platforms such as Vercel, the filesystem is ephemeral. For a global admin switch that survives deployments/instances, configure Upstash Redis with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## Setup

```bash
npm install
```

Create `.env.local`:

```env
DEFAULT_PROVIDER=local
ADMIN_PASSWORD=use-a-long-private-password
ADMIN_SESSION_SECRET=use-a-long-random-secret
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
```

Then:

```bash
npm run dev
```

Open http://localhost:3000 and http://localhost:3000/admin.

## OpenAI mode

You do not need an OpenAI key to use Local OCR. Only add `OPENAI_API_KEY` when you are ready to switch the provider to OpenAI from the admin panel.

## Production hardening

Before public launch, add persistent Upstash storage, rate limiting, monitoring, CSP/security headers, abuse protection, and usage quotas. Keep the admin password/session secret out of Git.


## OCR quality pipeline

Local OCR now preprocesses screenshots in the browser before Tesseract:
- upscales the image
- converts to grayscale
- increases contrast
- uses a code-oriented page segmentation mode for Code mode

Code output is then optionally formatted with Prettier. If OCR produced malformed code that Prettier cannot parse, the raw OCR result is preserved.

The Copy button also provides immediate visual feedback (`Copied!`) for better UX.
# snap-extract
