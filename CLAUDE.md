# Cubicle Crew (formerly Pixel Office) – notes for Claude

Local app that shows Claude Code sessions as pixel-art people in an office. Node server tails
`~/.claude/projects/**/*.jsonl` and pushes events over WebSocket; a vanilla-JS canvas client renders them.
Ships as a browser app (`npm start`) and as an Electron desktop widget with a Windows installer.
User-facing docs: `README.md` (English, GitHub landing page; media in `docs/media/`). Gamification (`docs/gamification.md`): phases 1–4 done – tokens, decor, shop, achievements.

## Commands
```bash
npm start                 # server + web UI on http://localhost:4317  (PORT=, CLAUDE_PROJECTS_DIR=)
npm run debug             # same, logs every parsed event and how sub-agent parents were resolved
npm run desktop           # Electron widget (runs its own server; 4317 busy -> 4318..4320 -> random)
npm run dist              # Windows NSIS installer -> release/CubicleCrew-Setup-<version>.exe (bump "version" first)
npm run icon              # regenerate build/icon.png (code-drawn, no deps)
node scripts/shot.cjs "<url>" <outPrefix> <w> <h> <dpr> <ms,ms,...> [evalJs] [preEvalJs]
                          # headless Chrome screenshots + console errors + external requests (see Testing)
```
There is no build step for the client and no test framework. `node --check <file>` for syntax.

## Hard constraints (from the user, keep them)
- **No external assets/CDN/fonts, works offline, no client build step** (plain ES modules in `public/`).
- **WebSocket protocol:** only ever *add optional* fields. Event: `{agent, label, subagent, ts, type: tool_start|tool_end|say|user_prompt, id, tool, detail, tool_use_id}` + optional `parent, parent_tool_use_id, background, desc, link`.
- **State colours are the visual language:** idle `#6b6b80`, thinking `#e0c24a`, typing `#4ac26b`, reading `#4a8fe0`, running `#e07a4a`, delegating `#b04ae0`, waiting `#e04a6b` (`STATES` in `public/config.js`).
- **UI is bilingual:** `T_BG` / `T_EN` in `config.js` (`T` = the active one, `LANG`, `setLang()`, `itemName(it)` for shop items – `catalog.js` keeps the Bulgarian names, English ones are in `T_EN.items`). Language: `?lang=en|bg` → saved `localStorage po.lang` → system language (`bg*` → bg, else en); HUD chip БГ/EN; Electron: tray submenu "Language", `settings.lang`, passes `&lang=` to the page (the HUD chip in the app sends `action("lang:xx")`). **Every new UI string goes into both.** Code comments in this repo are Bulgarian – match it.
- **All text is DOM** over the canvas (crisp, Cyrillic). The 3x5 `pixelfont.js` is only for digits/symbols inside the scene.
- **Integer pixel scaling** in *device* pixels: canvas is logical size (e.g. 640×360), CSS size = W*scale/dpr.
- Keep `?demo` and `?demo=showcase` working; they are how features get checked without real sessions.
- The procedural art must stay **override-able** by PNGs (`public/sprites/characters.png`, `tiles.png`+`tiles.json`); new props should go through `prop(name, …)` in `environment.js` so a tileset can replace them.

## Architecture (public/)
- `config.js` – `CFG` constants, `STATES`, `T` strings (`T_BG`/`T_EN`), URL `PARAMS` (`demo, debug, agents, time, wander, seed, desktop`); re-exports `TOOL_STATE`/`DELEGATE_TOOLS` from `rules.js`.
- `rules.js` – **shared with the server** (no DOM/`location`!): `TOOL_STATE`, `EARN` weights/bonuses, `Earner` (events → whole tokens per agent + bonuses).
- `tokens.js` – client wallet: HUD chip, whiteboard plaque (`office.tokens`), `+N` particles (≤1 per agent / 20 s, bonuses immediate), `drawCoin`; applies `equipped` → `office.setDecor()` (or the shop's `setPreview`); `backend` = server POSTs or `demoWallet` (in-memory, 10× rate, starts with 600 / 1240).
- `catalog.js` – **shared with the server**: `SLOTS` (slot → group + free default; `def: null` = on/off item), `ITEMS` (id, group, price, Bulgarian name, colours/style), `TABS`, `ACHIEVEMENTS`, `buyItem`/`equipItem`/`grantAchievements`, `resolveDecor(equipped)`. **Item ids are save data – never rename.** New item = one line here + (for a new style) a branch in the matching draw function in `environment.js` + thumbnail case in `thumb()`.
- `shop.js` – shop panel (DOM), thumbnails (integer-scaled canvases), hover preview, trophies tab; opened by HUD coin / B / tray+⚙ "Магазин" (`open-shop` IPC; Electron grows the window to ≥820×620 while open).
- `model.js` – events → per-agent state (pending tools + 8 s idle rule, unchanged from v1); parent/child links; leave rules; emits `join/leave/link/state/celebrate`. No drawing.
- `office.js` – the scene: **teams & seats**, lounge queue/swap (`manageTeams`), routing on lanes, particles hooks, layered rendering, hit-testing, DOM anchor points.
- `layout.js` – `computeLayout(devW, devH, {teams, rows})`: picks integer scale, room fills the window. `POD` = geometry inside one 72×76 desk pod (seat, aisle, monitor, label…). Pods carry `{team, role:'lead'|'sub', slot}`.
- `environment.js` – room prerender (`buildRoom` → `bg` canvas + depth-sorted prop images), sky by real local time (`timeOfDay`), wall clock, whiteboard stats, door, tint (multiply) and `glow` (additive). Colours of furniture: `ENV` in `palette.js`, `SOFA`/`LEAD` consts and `RUGS` array in `environment.js` (this is where decor theming will hook in).
- `sprites.js` – 24×32 character generator from string pixel maps + palettes, auto selective outline, two layers (`body`, `front` = hands/paper drawn over the desk), cache; `POSES`/`POSE_ORDER`; PNG sheet override.
- `characters.js` – `Actor` (pose selection per state, walking, pacing, fades) and the `Cat`.
- `screens.js` (monitor content per state), `particles.js`, `pixelfont.js`, `palette.js`, `util.js`.
- `ui.js` – labels, bubbles, tooltip, focus card, HUD, legend, `?debug`, Electron bridge (`window.pixelOffice`).
- `demo.js` – `?demo` simulation (2 orchestrators + sometimes a queued 3rd) and `?demo=showcase` (2 teams + 2 queued, all 7 states).
- `main.js` – loop, resize/scale, WS connect, sprite override loading via `GET /api/sprites`. **Adaptive FPS (CPU):** full rate while `office.animating()` (walk/pace/fade/typing+running at desk/door/flying darts/top-layer particles), else 30 fps; hidden Electron window (`visible` IPC → `pixelOffice.onVisible`) = logic only, 4×/s, no render. Something new that moves fast must be added to `animating()`.

Wallet (`wallet.js`, phase 1 of `docs/gamification.md` done): server-side accrual every 5 s via `Earner`, `~/.pixel-office/save.json` (atomic tmp→rename + `.bak`, ≤1 write/10 s, flush on exit; `PIXEL_OFFICE_HOME=` overrides – **use it in tests**, never touch the user's real save). `save.lock` (pid + heartbeat): only one running server accrues, others re-read the file. WS message `{type:'wallet', tokens, lifetime, delta, reason, src?, by?}` has **no `agent` field** on purpose. `GET /api/save`, `POST /api/buy {item}`, `POST /api/equip {slot, item|null}`, `POST /api/avatar {skin, hair, glasses}` (JSON + localhost Origin only, else 403). A non-owner server forwards buy/equip/avatar to the owner's port (stored in `save.lock`). Achievement rewards go to `tokens` only (not `lifetimeTokens`).
Avatar: `save.avatar = {skin, hair, glasses}` (indices into `SKINS`/`HAIRS` in `palette.js`; `AVATAR`/`setAvatar`/`avatarOf` in `catalog.js`, default `AVATAR.def`), sent in full wallet messages. Only **one** main agent wears it: the earliest-joined one still in the office (`office.avatarId`, `syncAvatar()` on join/removal; when it leaves the next oldest takes over), via `avatarLook(av, id)` (`sprites.js`; fixed hair style/clothes). Every other agent (other leads and sub-agents) uses `lookFor(id)`. `office.setAvatar()` re-skins the owner via `Actor.setLook()`. Edited in the shop's free "Аватар" tab (saved on every click).
Sofa sitters use `couchSit/couchSip/couchDoze` (legs `'couch'` = shins + shoes) and depth `lounge.sofa.base + 2`, i.e. in front of `sofa_front` – otherwise the seat hides their legs. Lounge leisure (`office.leisure`): coffee/cooler → sofa (`a.sofaAct` = 'game' 70% → `couchGameA/B` with a handheld prop, or 'doze') → after 20–45 s, if nobody is there, darts (`loc.type 'darts'`, spot `lounge.spots.darts`, board `lounge.darts` at the right end of the window wall – `environment.js` shortens the window span for it, prop `dartboard`) for 12–24 s → back to a free sofa. Throws: `dartPose()`/`DART_CYCLE` in `characters.js`, `office.throwDart()` + `drawDarts()` (stuck darts on the wall layer, flying ones above everything, cleared after 3 and on relayout). Console glow in `drawGlows`.
New poses were appended to `POSE_ORDER` (a PNG sheet made for the old order needs those rows added).
Live sessions: `server.js` reads `~/.claude/sessions/<pid>.json` (`{pid, sessionId, cwd, status}`, written by Claude Code while a session is open; pid checked with `process.kill(pid, 0)`) every 3 s → WS `{type:'sessions', list:[{agent,label,status}]}` (no top-level `agent`; sent on connect + on change) and `wallet.setLive()`. Client `model.sessions()` creates missing ones as idle (`presence`, they walk to the sofa) and sets `a.live`/`a.ended`/`a.busy` (`status === 'busy'` while Claude thinks/writes a long reply – no JSONL lines then, so `stateOf()` skips the 8 s idle rule and shows `thinking`/the pending tool instead): live leads never hit `GONE_AFTER_MS`, ended ones leave after `IDLE_MS`. Idle live leads earn `EARN.LIVE_IDLE` (0.25 tokens / 10 min), which does **not** count as active time. Busy live leads (`wallet.setLive(ids, busyIds)` → `Earner.busy`) never go idle in `Earner.stateOf()` and earn as `thinking` (or the pending tool). `CLAUDE_SESSIONS_DIR=` overrides (default: sibling of `CLAUDE_PROJECTS_DIR`) – in tests put fake `<pid>.json` with a real pid there.
Decor: `buildRoom(L, seed, decor)` / `buildPod(seed, lead, decor, team)` read `resolveDecor()`; with defaults the room is **pixel-identical** to the pre-decor version (check: with `?debug`, hash `getImageData` of `__office.room.bg`, every `room.objects[].img` and `podImgs[].back/front` before and after a change, at 1600×900, 632×376@1.25 and 900×560). `prop(name, w, h, fn, variant)` looks up `name@itemId` in tiles.json for non-default items. Dynamic extras: aquarium fish / arcade screen are depth-sorted items in `office.render`; lamp/neon/aquarium/arcade glows in `drawGlows` via `room.lampGlow`, `room.neon`, `room.aquarium`, `room.arcade`.
Server (`server.js`): static files + `/api/sprites` + `/api/save`; polls JSONL (400 ms: tracked files + readdir of project dirs and active sessions' `subagents/`; full recursive scan + stat of `dormant` (>1 h old) files only every `SCAN_MS` 2 s; history is not replayed on start, a resumed dormant file continues from its last size). Exports `startServer(port, {reuse})`; runs itself only when executed directly.
Electron (`electron/main.js` ESM, `electron/preload.cjs`): frameless always-on-top window above the tray, tray menu, Ctrl+Alt+P, notifications on "waiting", start-with-Windows, `prefer-size` auto-widen for 2 teams (user's manual size = `baseSize` minimum). Settings + `desktop.log` in `%APPDATA%\pixel-office\` (pinned with `app.setPath('userData')`, kept after the rename to Cubicle Crew). Internal ids stay `pixel-office` on purpose for save/settings compatibility: `~/.pixel-office`, `PIXEL_OFFICE_HOME`, `window.pixelOffice`, appId `com.pixeloffice.desktop`. `migrateLoginItem()` repoints an old "Pixel Office.exe" start-with-Windows entry. Releases: `gh release create v<version> release/CubicleCrew-Setup-<version>.exe` on `rezored/cubicle-crew`.

## Office model (decided with the user)
- **Team = one Claude Code session** (orchestrator). Lead desk on top (walnut desk, gold nameplate, red chair, ★ label); its sub-agents sit in rows of 3 below it, growing by rows.
- **Only working leads hold a desk** (asked by the user): an idle lead with no live sub-agents that is already in the lounge (`LOUNGE` loc types) releases its team in `manageTeams`; idle queued/joining leads never take a team (an idle `presence` join walks from the door to the sofa). So the idle office shows **one** pod (lead + 3 subs), the 2nd pod appears when two leads work. Sofa seats are 26 px apart (`SOFA_SEATS` in `environment.js` = `lounge.spots.sofa` in `layout.js`), the 2nd sofa label is stacked one row lower (`ui.js`). Every main agent's label gets ★.
- **Max 2 teams** (`CFG.MAX_TEAMS`). 3rd+ working sessions wait in the lounge; an active queued session swaps with a lead idle > `SWAP_IDLE_MS` (20 s) that has no live sub-agents.
- Sub-agents enter through the door; lead walks over to hand the paper (≤ once per 10 s, else paper plane).
- Parent link priority (server): `subagents/agent-<id>.meta.json` `toolUseId` (exact) → `sessionId`/folder → 15 s heuristic. Child leaves on parent's `tool_end` for its `parent_tool_use_id`, or after 30 s quiet (3 min if last event was an unfinished tool).

## Gotchas learned the hard way
- **Security (keep it):** the server binds `127.0.0.1` only (`HOST`), every HTTP request and WebSocket upgrade passes `localReq()` (Host must be localhost/127.0.0.1/[::1], Origin absent or local – blocks other websites and DNS rebinding; browsers allow cross-origin `ws://`, so the WS check matters), bad `%`-escapes → 400, static files must be inside `PUBLIC + sep`. Transcripts created before the server started and first seen later (`claude --resume`) are read from their end, not replayed. Server-to-server calls use `http://127.0.0.1:<port>`; the Electron page keeps `http://localhost` (changing the origin wipes localStorage).
- `ws` re-emits HTTP `listen` errors as **uncaught exceptions** → `startServer` probes the port with a separate `net` socket first. Don't remove that.
- Shell heredocs mangle long Python/JS edits with quotes/`\n`; write edit scripts to a file instead.
- A random server port changes the page origin and wipes `localStorage` prefs → Electron prefers fixed 4318–4320.
- Many tool sandboxes block writes outside the project/scratch dir; Electron logs to its userData dir.
- Windows PowerShell 5 `Compress-Archive` writes backslash paths → use `tar -a -c -f x.zip`.
- To run a second Electron instance next to the user's installed app, pass `--user-data-dir=<other dir>` (single-instance lock + settings are per userData).
- Seated characters are drawn in 3 slices: chair (depth `pod.y+18`) → body (`+24`) → desk + `front` layer (`+30`). Walkers sort by feet y. New furniture needs a sensible depth key.

## Testing (do this for every visual change)
1. `PORT=4399 node server.js` (any free port), then e.g.
   `node scripts/shot.cjs "http://localhost:4399/?demo=showcase&time=15:00" out/x 1600 900 1 3000,9000`
2. Read the PNGs; check **LOGS: none** and **EXTERNAL REQUESTS: none** in the output.
3. Cover: 1 team and 2 teams, desktop widget size (`?desktop`, 632×376 @ dpr 1.25), small window (900×560), night (`&time=22:30`).
4. `?debug` exposes `window.__office` / `window.__model` for state dumps via the `evalJs` argument, and lets you inject events with `__model.ingest({...})` via `preEvalJs`.
5. Real pipeline: write fake JSONL into a temp `CLAUDE_PROJECTS_DIR` (parent `<sid>.jsonl` + `<sid>/subagents/agent-x.jsonl` + `.meta.json`) and read the WS output.
Don't kill the user's own `Cubicle Crew.exe` (older installs: `Pixel Office.exe`) / port-4317 server without asking.
