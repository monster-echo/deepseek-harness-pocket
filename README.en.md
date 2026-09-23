<div align="center">

<img src="react-native/assets/brand/logo.png" width="110" alt="DSH Pocket logo">

# DSH Pocket

[English](README.en.md) | [中文](README.md)

**Run [DeepSeek Harness](https://github.com/deepseek-ai) on your own computer — then reach it from anywhere.**

Three pieces that work as one: a **desktop Worker** (a quiet tray helper), a **mobile app**, and an **encrypted relay** (Gateway) —
your AI agent works on your home or office computer while you watch progress, nudge it, and approve actions from the couch, the subway, or another city.

[⬇️ Download for desktop](https://github.com/monster-echo/deepseek-harness-pocket/releases/latest) · [📱 Mobile app](react-native/) · [🏗️ Architecture](docs/ARCHITECTURE.md)

![Console](docs/screenshots/desktop-console.png)

*The desktop piece: opening the app lands you straight into a full DeepSeek Harness — chat, work, deliver.*

</div>

---

## What is this?

First, **DeepSeek Harness** (usually written `dsh`): DeepSeek's AI agent runtime. Give it a goal and it breaks the task down on its own — writing code, running commands, editing files, installing dependencies — until the job is done. Sounds great, except it lives in a terminal, pinned to one computer.

**This project is the missing remote control:**

| Piece | What it does | For whom |
|---|---|---|
| 🖥️ **Desktop app** (DSH Pocket) | A quiet tray helper: boots the Harness automatically at login; the main window *is* the full Harness; a separate console window holds account, status, versions and logs | Every computer you want working for you |
| 📱 **Mobile app** | The same session list and chat as your computer — keep the conversation going, watch it run, approve actions from your pocket | You, on the go |
| ☁️ **Gateway** | An encrypted relay between phone and computer. Your computer dials *out* to it — no public IP, no port forwarding at home | Nobody (it's invisible) |

## What can it do?

Real scenarios:

- 🧹 **"Make the test suite green in this repo"** — say it before you leave in the morning; on the subway, open your phone and watch it finish, fixes already committed
- ✅ **Approvals don't wait** — when the agent wants to do something risky (delete files, install dependencies) it pauses and asks; a notification pops up on your phone, you glance at the diff, tap Approve, it keeps going
- 📦 **Deliverables land on your phone** — the web page / chart / file the agent built shows up on your phone for preview
- 🌙 **Online the moment your computer is** — the desktop side is a login-autostart, crash-restarting daemon; as long as the machine is on, it answers

<div align="center">
<table>
<tr>
<td align="center" width="50%"><img src="docs/store-assets/ios/02-chat.png" width="300"><br><sub>Mobile: sessions fully in sync with your computer</sub></td>
<td align="center" width="50%"><img src="docs/store-assets/ios/03-approval.png" width="300"><br><sub>Approve on the go — the agent doesn't wait for you to get home</sub></td>
</tr>
</table>
</div>

## Up and running in three minutes

> You need: a macOS (Apple Silicon) or Windows computer, an iPhone/Android phone, and a folder you'd like an AI to boss around.

**① Computer: install it, open it, done**

Grab the latest build from [Releases](https://github.com/monster-echo/deepseek-harness-pocket/releases/latest):

- macOS: download `DSH Pocket_<version>_aarch64.dmg`, drag into Applications, open
- Windows: download `DSH Pocket_<version>_x64-setup.exe`, double-click

It boots the Harness by itself (first run spends a few minutes preparing the environment). From then on it comes online at every login; closing the window tucks it into the **tray** — everything is managed from the tray menu.

**② Phone: sign in with the same account**

Desktop tray menu → Console → Account: sign in with the **same Zhangjing account** as the mobile app — your phone sees this computer instantly, **no QR pairing needed**:

<div align="center"><img src="docs/screenshots/desktop-pairing.png" width="320"><br><sub>Sharing with another account? The "Pair" QR page still works (sample image, not a real code)</sub></div>

**③ Put it to work**

Type your first task in the desktop console — or right from your phone — and leave the rest to the agent.

![Status](docs/screenshots/desktop-status.png)

*Tray menu → Console: status / account / pairing / versions / logs in a separate window*

## Security & privacy

The plain-language version:

- 🔒 **Your data stays on your computer** — sessions, files and code all live in the Harness on your machine; the relay moves messages, it doesn't store them
- 🪪 **Same account, auto-connected** — the desktop links to your account at sign-in; only a phone signed into that same account can see it, and you can unbind anytime
- 🤝 **Sharing goes through pairing codes** — when you share the computer with another account; suspect a leak? Hit "rotate code" and the old one dies instantly
- 🛡️ **The desktop console is for locals only** — it listens on 127.0.0.1 behind a one-time token; LAN and internet requests are turned away
- 📴 **Off whenever you want** — one tray click stops the Worker and your computer goes back to being a normal computer

## How it works (30-second version)

```
📱 Mobile app ⇄ ☁️ Gateway ⇄ 🖥️ Desktop Worker ⇄ 🤖 DeepSeek Harness
     (encrypted WebSocket; the computer dials out — no public IP)   (runs locally; data never leaves)
```

Phone and computer never talk directly — both only speak encrypted to the Gateway, and the desktop connection is **outbound**, so home routers need zero configuration. Want to run your own relay? The `gateway/` directory is the complete server.

---

## For developers

### Repository layout (monorepo, everything in one tree)

| Directory | What it is | Status |
|---|---|---|
| `packages/bridge-protocol` | mobile/v1 protocol package (single source of truth, pure TS) | ✅ M1 |
| `packages/bridge` | dsh plugin (protocol server: direct server + gateway uplink) + `dshc` Worker CLI (daemonizes dsh, autostart, pairing codes) | ✅ M1/M2 |
| `gateway/` | Relay service (Next.js + custom WS server; auth, pairing, presence, push, usage) | ✅ M2 |
| `react-native/` | Mobile app (Expo; sidebar layout, maximized chat, pairing flow) | ✅ M1/M2 |
| `desktop-tauri/` | Desktop app (Tauri 2 + React/TS, macOS/Windows: tray-resident, embeds the dsh Web GUI, console, Worker & dsh multi-version management, autostart, notifications, self-update) | ✅ |
| `e2e/` | End-to-end smoke tests (fake phone → gateway → uplink → hub → fake dsh, plus real-dsh smoke scripts) | ✅ |

### Quick start

```sh
# protocol / plugin / gateway
pnpm install && pnpm -r build && pnpm test

# gateway (needs PostgreSQL, see gateway/.env.example)
pnpm --dir gateway migrate && pnpm --dir gateway dev

# desktop Worker CLI
cd packages/bridge && npm link   # or npm i -g <local path>
dshc start                                     # daemonize dsh + print pairing code
dshc install                                   # login autostart

# mobile app
cd react-native && cp .env.example .env && npm install && npx expo start

# desktop GUI (macOS / Windows)
cd desktop-tauri && ./tool/build-sidecar.sh && pnpm install && pnpm tauri dev
```

### More docs

- 🏗️ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture
- 🖥️ [desktop-tauri/README.md](desktop-tauri/README.md) — desktop development & release (CI builds on tag)
- 🧪 `e2e/` — end-to-end smoke tests
