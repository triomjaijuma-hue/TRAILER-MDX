
<div align="center">

```
🌸════════════════════════════════════════════════════════🌸
        ████████╗██████╗  █████╗ ██╗██╗     ███████╗██████╗ 
           ██╔══╝██╔══██╗██╔══██╗██║██║     ██╔════╝██╔══██╗
           ██║   ██████╔╝███████║██║██║     █████╗  ██████╔╝
           ██║   ██╔══██╗██╔══██║██║██║     ██╔══╝  ██╔══██╗
           ██║   ██║  ██║██║  ██║██║███████╗███████╗██║  ██║
           ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚═╝  ╚═╝
                      ✦  M D X  ✦
🌸════════════════════════════════════════════════════════🌸
```

# 🌺 TRAILER-MDX WhatsApp Bot 🌺

**267 Plugins · Multi-Prefix · Railway Ready · AI Powered**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)
![Node.js](https://img.shields.io/badge/Node.js-20+-green?style=flat-square&logo=node.js)
![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
![Plugins](https://img.shields.io/badge/Plugins-267-purple?style=flat-square)
![Prefixes](https://img.shields.io/badge/Prefixes-.%20!%20%2F%20%23-orange?style=flat-square)

</div>

---

## 🌷 What is TRAILER-MDX?

A powerful multi-prefix WhatsApp bot built on **Baileys** with **267 plugins**, ready to deploy on **Railway.app** in minutes.

- 🔐 **Secure pairing** — code shown only on your authenticated webpage, never in logs
- 🤖 **AI auto-reply** (`.aion` / `.aioff`) via OpenAI or any OpenAI-compatible endpoint
- 🎨 **Owner / Admin / AI / Download / Sticker / Tools / Music / Group / Search / Fun** and more
- 🖼️ Bot avatar shipped in `assets/avatar.png`, applied automatically on first connect
- 🌐 Prefixes: `.` `!` `/` `#`

---

## 🌸 Quick Start

### Local Run

```bash
git clone https://github.com/triomjaijuma-hue/TRAILER-MDX
cd TRAILER-MDX
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`, paste your WhatsApp number (with country code, e.g. `256706106326`), and enter the pairing code in **WhatsApp → Linked devices → Link with phone number**.

### Railway Deploy

1. Push this repo to GitHub
2. **New Project → Deploy from GitHub Repo** on Railway
3. Set these variables in **Variables**:

| Variable | Required | Example |
|---|---|---|
| `OWNER_NUMBER` | ✅ | `256706106326` |
| `BOT_NUMBER` | ✅ | `256706106326` |
| `BOT_NAME` | ✅ | `TRAILER-MDX` |
| `WEB_USERNAME` | ✅ | `admin` |
| `WEB_PASSWORD` | ✅ | `strongpassword` |
| `OPENAI_API_KEY` | Optional | enables `.gpt`, `.dalle`, `.aion` |
| `OPENROUTER_API_KEY` | Optional | alternative AI provider |

4. Add a Railway **Volume** at `/app/auth_info` so session survives redeploys
5. Open your Railway URL → log in → pair your number

---

<div align="center">

```
🌺━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🌺
              ✿  C O M M A N D   L I S T  ✿
🌺━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🌺
```

</div>

---

### 👑 OWNER Commands

> Only the bot owner can run these.

```
╔══════════════════════🌸 OWNER 🌸══════════════════════╗
║  .anticall      — Toggle anti-call                    ║
║  .antidelete    — Toggle anti-delete                  ║
║  .autoreact     — Toggle auto-react to messages       ║
║  .autoread      — Toggle auto-read receipts           ║
║  .autoreply     — Toggle auto-reply                   ║
║  .autostatus    — Toggle auto-view status             ║
║  .autotyping    — Toggle typing indicator             ║
║  .cmdreact      — Toggle reaction on commands         ║
║  .maintenance   — Toggle maintenance mode             ║
║  .pmblocker     — Block DMs from non-contacts         ║
║  .stealth       — Toggle stealth (no presence/read)   ║
║  .stop          — Emergency brake — silence replies   ║
║  .resume        — Release emergency brake             ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🤖 AI Commands

> Requires `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

```
╔══════════════════════🌸 AI 🌸═════════════════════════╗
║  .gpt           — Ask GPT anything                    ║
║  .llama         — Ask Llama 3.1 (8B instruct)         ║
║  .mistral       — Ask Mistral 7B                      ║
║  .dalle         — Generate an image from a prompt     ║
║  .flux          — Alias for .dalle                    ║
║  .diffusion     — Alias for .dalle                    ║
║  .sora          — Generate a cinematic video prompt   ║
║  .aion          — Turn AI auto-reply ON for this chat ║
║  .aioff         — Turn AI auto-reply OFF              ║
║  .aiprovider    — Show which AI provider is active    ║
╚═══════════════════════════════════════════════════════╝
```

---

### 📥 DOWNLOAD Commands

```
╔══════════════════════🌸 DOWNLOAD 🌸═══════════════════╗
║  .apkdl         — Download an APK by name             ║
║  .gimage        — Search APK on APKPure               ║
║  .alamy         — Image search results                ║
║  .getty         — Alamy stock image search            ║
║  .istock        — Getty Images search                 ║
║  .gitclone      — iStock search                       ║
║  .gitclone2     — Send a GitHub repo as a zip         ║
╚═══════════════════════════════════════════════════════╝
```

---

### 📌 GENERAL Commands

```
╔══════════════════════🌸 GENERAL 🌸════════════════════╗
║  .alive         — Bot heartbeat / status              ║
║  .ping          — True round-trip latency             ║
║  .pingweb       — Health-check echo (pong)            ║
║  .uptime        — Show bot uptime                     ║
║  .echo          — Echo a message back                 ║
║  .channelid     — Get the chat JID                    ║
║  .getpp         — Get chat/user profile picture       ║
║  .pair          — Show pairing webpage URL            ║
║  .menu          — Full bot command menu               ║
║  .smenu         — Compact category summary            ║
║  .listcmd       — List every loaded command           ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🎴 STICKERS Commands

```
╔══════════════════════🌸 STICKERS 🌸═══════════════════╗
║  .sticker       — Convert media → sticker             ║
║  .sticker2      — Cropped sticker                     ║
║  .crop          — Sticker with crop fit               ║
║  .s2img         — Sticker → image                     ║
║  .attp          — Text-to-pic sticker                 ║
║  .gif           — GIF/video → animated sticker        ║
║  .emojimix      — Mix two emojis into a sticker       ║
║  .igs           — Image → sticker (small pack name)   ║
║  .igsc          — Image → square sticker              ║
║  .tgstk         — Telegram sticker pack import        ║
║  .stickers      — List supported sticker commands     ║
║  .quoted        — Quote a sticker as text             ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🧰 TOOLS Commands

```
╔══════════════════════🌸 TOOLS 🌸══════════════════════╗
║  .base64        — Encode / decode base64              ║
║  .bfdecode      — Decode Brainfuck                    ║
║  .brainfuck     — Encode text → Brainfuck             ║
║  .fetch         — GET a URL (raw text)                ║
║  .getpage       — Fetch URL title + preview           ║
║  .screenshot    — Webpage screenshot                  ║
║  .tinyurl       — Shorten a URL                       ║
║  .url           — URL-encode text                     ║
║  .urldecode     — URL-decode text                     ║
║  .qrcode        — Generate a QR code image            ║
║  .readqr        — Read a QR code image (stub)         ║
║  .removebg      — Background removal                  ║
║  .length        — Length of text                      ║
║  .reverse       — Reverse text                        ║
║  .flip          — Mirror image horizontally           ║
║  .grayscale     — Grayscale image                     ║
║  .blur          — Blur image                          ║
║  .invert        — Invert image colours                ║
║  .sepia         — Sepia tint image                    ║
║  .sharpen       — Sharpen image                       ║
║  .forwarded     — Forward quoted to current chat      ║
║  .excard        — Send a sample contact card          ║
║  .translate     — Translate text (free, no key)       ║
║  .tts           — Text → voice note                   ║
║  .vnote         — Convert audio → voice note          ║
╚═══════════════════════════════════════════════════════╝
```

---

### 👥 GROUP Commands

```
╔══════════════════════🌸 GROUP 🌸══════════════════════╗
║  .character     — Random character analysis           ║
║  .compliment    — Send a compliment                   ║
║  .gcmtdata      — Raw group metadata                  ║
║  .groupinfo     — Group summary                       ║
║  .invitelink    — Get group invite link               ║
║  .joinrequests  — Pending join requests               ║
║  .insult        — Light-hearted roast                 ║
║  .rank          — Random rank for the chat            ║
║  .ship          — Ship two users                      ║
║  .simp          — Simp meter                          ║
║  .staff         — List group admins                   ║
║  .stupid        — Stupidity percentage                ║
║  .warnings      — Show your warnings count            ║
║  .wasted        — Wasted overlay                      ║
║  .poll          — Send a poll (.poll Q | A | B | C)   ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🛡️ ADMIN Commands

```
╔══════════════════════🌸 ADMIN 🌸══════════════════════╗
║  .antibadword   — Toggle anti-badword filter          ║
║  .antilink      — Toggle anti-link filter             ║
║  .antispam      — Toggle anti-spam                    ║
║  .antitag       — Toggle anti-tag                     ║
║  .kick          — Kick mentioned user                 ║
║  .add           — Add a number to the group           ║
║  .promote       — Promote user to admin               ║
║  .demote        — Demote admin to member              ║
║  .mute          — Only admins can send                ║
║  .unmute        — Anyone can send                     ║
║  .disappear     — Disappearing messages timer         ║
║  .delete        — Delete the quoted message           ║
║  .hidetag       — Tag everyone (hidden)               ║
║  .tag           — Tag a single mentioned user         ║
║  .tagall        — List everyone in the group          ║
║  .tagnotadmin   — Tag non-admin members               ║
║  .resetlink     — Revoke & create new invite link     ║
║  .setgname      — Set group name                      ║
║  .setgdesc      — Set group description               ║
║  .setgpp        — Set group profile pic               ║
║  .gcset         — Group settings (open/close/edit)    ║
║  .welcome       — Toggle welcome message              ║
║  .goodbye       — Toggle goodbye message              ║
║  .addbadword    — Add word to anti-badword list       ║
║  .delbadword    — Remove word from list               ║
║  .listbadwords  — Show anti-badword list              ║
║  .ban           — Ban user from using bot             ║
║  .unban         — Unban user                          ║
║  .warn          — Warn user (3 strikes = kick)        ║
║  .chatbot       — Toggle chatbot in group             ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🎮 GAMES Commands

```
╔══════════════════════🌸 GAMES 🌸══════════════════════╗
║  .game          — Show available games                ║
║  .dado          — Roll a dice                         ║
║  .truth         — Random truth question               ║
║  .dare          — Random dare challenge               ║
║  .wyr           — Would You Rather?                   ║
║  .trivia        — Trivia question (reply to answer)   ║
║  .math          — Math problem (reply to answer)      ║
║  .hangman       — Hangman (reply with letter/word)    ║
║  .tictactoe     — Tic-Tac-Toe vs bot (reply 1-9)     ║
║  .quiz          — 5-question quiz (auto-advances)     ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🎉 FUN Commands

```
╔══════════════════════🌸 FUN 🌸════════════════════════╗
║  .8ball         — Magic 8-ball                        ║
║  .fact          — Random interesting fact             ║
║  .joke          — Random joke                         ║
║  .joke2         — Dad joke                            ║
║  .meme          — Random meme                         ║
║  .flirt         — A pick-up line                      ║
║  .hack          — Fake hacking screen                 ║
║  .teddy         — Send a teddy bear                   ║
║  .why           — Random philosophical why question   ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🔎 SEARCH Commands

```
╔══════════════════════🌸 SEARCH 🌸═════════════════════╗
║  .wiki          — Wikipedia summary                   ║
║  .define        — Word definition                     ║
║  .element       — Periodic table element lookup       ║
║  .whoisip       — IP info / geolocation               ║
║  .wattpad       — Search Wattpad stories              ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🎵 MUSIC Commands

```
╔══════════════════════🌸 MUSIC 🌸══════════════════════╗
║  .play          — Search YouTube → send audio         ║
║  .video         — Search YouTube → send video (480p)  ║
║  .ytsearch      — Show YouTube search results         ║
║  .ytdlpcheck    — Diagnose yt-dlp availability        ║
║  .lyrics        — Fetch song lyrics                   ║
║  .ringtone      — Ringtone search link                ║
║  .scloud        — SoundCloud search link              ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🕵️ STALK Commands

```
╔══════════════════════🌸 STALK 🌸══════════════════════╗
║  .github        — GitHub user info                    ║
║  .npmstalk      — NPM package info                    ║
║  .pinstalk      — Pinterest profile URL               ║
║  .tgstalk       — Telegram profile URL                ║
║  .thrstalk      — Threads profile URL                 ║
║  .ttstalk       — TikTok profile URL                  ║
║  .xstalk        — X (Twitter) profile URL             ║
║  .genshin       — Genshin Impact info link            ║
╚═══════════════════════════════════════════════════════╝
```

---

### ℹ️ INFO Commands

```
╔══════════════════════🌸 INFO 🌸═══════════════════════╗
║  .owner         — Bot owner contact                   ║
║  .script        — Project / script info               ║
║  .imdb          — IMDB search URL                     ║
║  .movie         — Movie info (OMDB)                   ║
║  .itunes        — iTunes search                       ║
║  .medicine      — Drug info (openFDA)                 ║
║  .pokedex       — Pokemon info                        ║
║  .quran         — Quran ayah: .quran 2:255            ║
║  .shazam        — Identify song from audio            ║
║  .string        — Bot session info                    ║
║  .trends        — Google Trends top searches          ║
║  .weather       — Weather (Open-Meteo)                ║
║  .whois         — WHOIS domain info (rdap)            ║
║  .news          — Top headlines                       ║
╚═══════════════════════════════════════════════════════╝
```

---

### 💬 QUOTES Commands

```
╔══════════════════════🌸 QUOTES 🌸═════════════════════╗
║  .quote         — Random inspirational quote          ║
║  .quote2        — Programming / tech quote            ║
║  .goodnight     — Goodnight wish                      ║
║  .roseday       — Rose for someone special            ║
║  .shayari       — Random shayari                      ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🛠️ UTILITY Commands

```
╔══════════════════════🌸 UTILITY 🌸════════════════════╗
║  .calc          — Calculator                          ║
║  .cipher        — Caesar shift: .cipher <n> <text>    ║
║  .distance      — Distance between two cities         ║
║  .dna           — DNA → mRNA                          ║
║  .rle           — Run-length encode                   ║
║  .schedule      — Schedule: .schedule 30s | hello     ║
║  .schedulelist  — List scheduled messages             ║
║  .schedulecancel— Cancel a scheduled message          ║
║  .siminfo       — Country lookup by phone prefix      ║
║  .speedtest     — Network info                        ║
║  .sudoku        — Generate an easy sudoku             ║
║  .units         — Convert units: .units 10 km miles   ║
║  .analyze       — Quick text stats                    ║
║  .wordcloud     — Top frequent words in text          ║
╚═══════════════════════════════════════════════════════╝
```

---

### 📝 NOTES Commands

```
╔══════════════════════🌸 NOTES 🌸══════════════════════╗
║  .addnote       — Save: .addnote <name> | <text>      ║
║  .delnote       — Delete: .delnote <name>             ║
║  .listnotes     — List all saved notes                ║
║  .getnote       — Read: .getnote <name>               ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🔒 PRIVACY Commands

```
╔══════════════════════🌸 PRIVACY 🌸════════════════════╗
║  .online        — Force bot to appear online          ║
║  .offline       — Force bot to appear offline         ║
║  .read          — Toggle auto-read: .read on|off      ║
║  .lastseen      — Show bot's lastSeen privacy setting  ║
║  .stealth       — Stealth mode: .stealth on|off       ║
╚═══════════════════════════════════════════════════════╝
```

---

### ☁️ UPLOAD Commands

```
╔══════════════════════🌸 UPLOAD 🌸═════════════════════╗
║  .litterbox     — Upload media (Litterbox)            ║
║  .aupload       — Upload to Catbox (1-hour temp)      ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🖼️ IMAGE & MEDIA Commands

```
╔══════════════════════🌸 IMAGES 🌸═════════════════════╗
║  .coding        — Coding-themed image                 ║
║  .cyberimg      — Cyber-aesthetic image               ║
║  .game          — Gaming image                        ║
║  .islamic       — Islamic image                       ║
║  .mountain      — Mountain scenery image              ║
║  .pies          — Pie image                           ║
║  .tech          — Tech image                          ║
╚═══════════════════════════════════════════════════════╝

╔══════════════════════🌸 ANIME 🌸══════════════════════╗
║  .waifu         — Random waifu                        ║
║  .neko          — Random neko                         ║
║  .hug           — Anime hug GIF                       ║
║  .kiss          — Anime kiss GIF                      ║
║  .pat           — Anime pat GIF                       ║
║  .cuddle        — Anime cuddle GIF                    ║
╚═══════════════════════════════════════════════════════╝
```

---

### 🎶 AUDIO FX Commands

```
╔══════════════════════🌸 AUDIO FX 🌸═══════════════════╗
║  .bass          — Bass boost audio                    ║
║  .deep          — Deep / slow audio                   ║
║  .fast          — Speed up audio                      ║
║  .slow          — Slow down audio                     ║
║  .reverse       — Reverse audio                       ║
║  .nightcore     — Nightcore effect                    ║
╚═══════════════════════════════════════════════════════╝
```

---

### ✏️ TEXT STYLE Commands

```
╔══════════════════════🌸 TEXT STYLES 🌸════════════════╗
║  .smallcaps     — Convert to small caps               ║
║  .bold          — WhatsApp *bold*                     ║
║  .italic        — WhatsApp _italic_                   ║
║  .mono          — WhatsApp `monospace`                ║
║  .strike        — WhatsApp ~strike~                   ║
║  .underline     — Underline style                     ║
╚═══════════════════════════════════════════════════════╝

╔══════════════════════🌸 EPHOTO 🌸═════════════════════╗
║  .glitchtxt     — Glitch text effect image            ║
║  .neontxt       — Neon text effect image              ║
║  .firetxt       — Fire text effect image              ║
║  .metaltxt      — Metal text effect image             ║
╚═══════════════════════════════════════════════════════╝
```

---

<div align="center">

```
🌺════════════════════════════════════════════════════════🌺
          ✿  A I   A U T O - R E P L Y  ✿
🌺════════════════════════════════════════════════════════🌺
```

</div>

Send `.aion` in any chat to activate AI auto-reply. The bot will reply to every message and keep full conversation context. Send `.aioff` to stop. Requires `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.

---

<div align="center">

```
🌸════════════════════════════════════════════════════════🌸
      Made with 💖  by  triomjaijuma-hue  ·  TRAILER-MDX
🌸════════════════════════════════════════════════════════🌸
```

</div>
