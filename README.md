# TRAILER-MDX WhatsApp Bot

A multi-prefix (`.`, `!`, `/`, `#`) WhatsApp bot built on Baileys with **267 plugins**,
ready to deploy on **Railway.app**.

- Pairing-code login through a **secure webpage** (no codes leaked in deploy logs).
- Owner / Admin / AI / Download / Sticker / Tools / Music / Group / Search / Fun and more.
- AI auto-reply (`.aion` / `.aioff`) using OpenAI (or any OpenAI-compatible endpoint).
- Bot avatar shipped in `assets/avatar.png` and applied automatically on first connect.

---

## 1. Local run

```bash
cd trailer-mdx
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`, paste your WhatsApp number (with country code, e.g.
`256706106326`), and you'll get a pairing code to enter in **WhatsApp → Linked
devices → Link with phone number**.

The session is saved to `auth_info/` and re-used on every restart.

---

## 2. Deploy on Railway.app

1. Push this folder to a GitHub repo.
2. On Railway: **New Project → Deploy from GitHub Repo** → pick the repo.
3. Railway auto-detects the included `Dockerfile` (and `railway.json`) and starts the
   web service.
4. In **Variables**, set at minimum:
   - `OWNER_NUMBER=256706106326`
   - `BOT_NUMBER=256706106326`
   - `BOT_NAME=TRAILER-MDX`
   - `WEB_USERNAME=admin` and `WEB_PASSWORD=<something-strong>` (protects the
     pairing page so only you can request a code)
   - Optional AI: `OPENAI_API_KEY` (enables `.gpt`, `.dalle`, `.aion`)
5. Open the deployed Railway URL → log in → paste your number → enter the pairing
   code in WhatsApp.
6. Add a Railway **Volume** mounted at `/app/auth_info` so your session survives
   redeploys.

The pairing code is **never printed to the deploy logs** — it is only shown on the
authenticated webpage.

---

## 3. Prefixes & menu

Prefixes: `.`  `!`  `/`  `#`

Type `.menu` in WhatsApp to see the full plugin list.

---

## 4. AI auto-reply

- `.aion` — bot starts auto-replying to your DMs using AI
- `.aioff` — stop AI auto-reply
- Conversation history is kept per-chat so replies stay in context.

Requires `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) to be set.
