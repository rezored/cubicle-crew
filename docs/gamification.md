# Gamification – design note (draft v0.1)

**Idea:** the office earns a currency while your agents work, and you spend it on decorating the office
(sofa, wall paint, carpets, floor, plants, …). The office slowly becomes *yours*: the reward for getting real work done.
Status: **phases 1–4 implemented** (2026-10-09: `public/rules.js`, `wallet.js`, `public/tokens.js`, `public/catalog.js`, `public/shop.js`). The catalog in `catalog.js` is the source of truth for items/prices (it differs slightly from the starter table below). Open questions answered – see *Decisions* in section 8; where they differ from the proposals below, section 8 wins.

---

## 1. Currency
- **Name (proposed):** *кафе зърна* / coffee beans ☕. It fits the existing coffee machine and lounge, and is short in the HUD: `☕ 1 240`.
- Shown in: the HUD (always), the whiteboard (small number), the shop panel.
- Floating `+1 ☕` particles occasionally rise from working agents, so earning is visible without being noisy (at most one per agent every ~20 s).

## 2. Earning rules (proposed)
Earnings come from **active agent time**, weighted by state:

| State | Weight | Why |
|---|---|---|
| typing, running, reading, delegating | 1.0 | real work |
| thinking | 0.5 | work, but partly waiting on the model |
| waiting (needs you) | 0 | don't reward leaving the agent blocked; nudges you to answer |
| idle | 0 | — |

- **Base rate:** 1 bean per weighted active minute of a main agent (orchestrator).
- **Sub-agents:** 0.5× each, and at most 6 workers counted at once, so parallelism helps without making "spawn 20 agents" the best strategy.
- **Bonuses:** sub-agent task finished (`done` via parent `tool_end`) +5. Long run finished (the existing confetti moment, ≥ 60 s busy) +10. First activity of the day +20.
- **Rough balance:** 2 agents × 4 h/day ≈ 300–480 beans/day. First small purchase on day 1, a fully decorated office in ~4–6 weeks.
- **Welcome back-pay (proposed):** on first launch, scan the last 30 days of transcripts once and grant e.g. 25% of what they would have earned, so the shop isn't empty on day one.

### Where earnings are computed: on the **server**
Earnings must accrue even when the widget is hidden or no browser tab is open. The desktop app runs the server anyway, and the server already sees every event.
- The server keeps a light mirror of the model's activity rule per agent: active if there was an event in the last `IDLE_MS` (8 s) **or** a tool is pending. A pending tool counts for at most 10 minutes, so one hung Bash doesn't print money.
- The state weight is derived from the pending tool via the same `TOOL_STATE` map (move it to a shared module, e.g. `public/rules.js`, imported by both server and client).
- Accrue every 5 s. Persist with a debounced write (≤ 1 write / 10 s, plus on exit).

## 3. Persistence
- File: `~/.pixel-office/save.json`, shared by browser and desktop app (one wallet per user, not per Electron profile).
- Atomic write: write `save.json.tmp`, then rename. Keep a `save.json.bak` of the previous version.
```jsonc
{
  "version": 1,
  "beans": 1240, "lifetimeBeans": 5310,
  "lifetimeActiveSec": 318000, "tasksDone": 42,
  "owned": ["wall.sage", "sofa.chesterfield.green", "rug.team.persian"],
  "equipped": { "wall": "wall.sage", "sofa": "sofa.chesterfield.green", "rug.team0": "rug.team.persian" },
  "lastDaily": "2026-10-09"
}
```
- No anti-cheat: it's single-player and local. Editing the file is "cheating yourself". Keep item ids **stable forever**, because they're the save-game and future Steam keys.

## 4. API (server)
- `GET /api/save` → wallet + owned + equipped + the catalog.
- `POST /api/buy {item}` → validates price and ownership, deducts, returns the new save.
- `POST /api/equip {slot, item}` → item must be owned (or a free default).
- WebSocket: broadcast `{type: 'wallet', beans, delta, reason}` on change.
  This is a **new message type without an `agent` field**. The current `Model.ingest` ignores messages without `agent`, so old clients are safe and the "only add optional fields" rule for agent events still holds.

## 5. Decor system (rendering)
Today the furniture colours are hard-coded: `ENV` in `palette.js`, plus `SOFA`, `LEAD` and `RUGS` in `environment.js`.
- Introduce `decor` = the resolved equipped items → a set of **slot values**: palettes and style ids.
  `buildRoom(L, seed, decor)` and `buildPod(seed, lead, decor)` read from it instead of the constants.
- **Colour items** (paint, carpet colour, sofa colour) = a palette override (3-tone ramps), so they're cheap to add.
- **Style items** (sofa shape, rug pattern, floor type, lamp model) = a named draw function per style, routed through `prop('sofa_back@chesterfield', …)` so a PNG tileset can override each style.
- Changing decor triggers `office.relayout()`. It only rebuilds the prerendered layers, which is cheap.
- **Preview:** the shop applies a temporary `decor` on hover/select and reverts on close.

### Starter catalog (proposed ids, prices in beans)
| Slot | Items |
|---|---|
| `wall` paint | slate (default, 0) · sage 60 · terracotta 60 · navy 80 · cream 80 · forest 120 |
| `wainscot` | dark (default) · white panels 90 · wood 150 |
| `floor` | oak planks (default) · walnut 200 · checker tiles 250 · concrete loft 300 |
| `rug.team0` / `rug.team1` | plain (default) · stripes 80 · persian 220 · round 180 |
| `rug.lounge` | red (default) · boho 150 · fluffy white 200 |
| `sofa` style × colour | modern teal (default) · modern (6 colours) 120 · chesterfield 400 · bean bags 250 |
| `chair` / `chair.lead` | colour 50 each · gaming chair 300 · throne for the lead 900 |
| `plants` | ficus (default) · monstera 120 · cactus set 90 · hanging plants 200 |
| `posters` | rocket (default) · 6 more × 40 |
| `lamp` | floor lamp (default) · arc lamp 160 · neon sign 350 |
| `cat` | grey (default) · ginger 150 · black 150 · second cat 600 |
| `window` | city (default) · seaside 500 · mountains 500 (changes the skyline in `drawSky`) |
| `special` | aquarium 1200 · arcade cabinet 1500 · espresso bar upgrade 800 |

## 6. Shop UI
- Open with a **☕ button in the HUD**, the key **B**, or the tray menu "Магазин" (desktop).
- A DOM panel (crisp Bulgarian text) with tabs per slot. Each item shows a small canvas thumbnail, price and Buy/Equip; locked items appear greyed out with the price.
- In the desktop widget the panel opens as a larger overlay window, or temporarily enlarges the window. The 632×376 widget is too small for a comfortable shop.
- Strings go into `T.shop` in `config.js`.

## 7. Phases
1. ✅ **Earning + persistence:** shared rules module, server accrual, `save.json`, `/api/save`, HUD counter, `+1 ☕` particles. *Testable in `?demo`* (the demo must accrue too).
2. ✅ **Decor refactor:** replace hard-coded colours with `decor` slots, zero visual change by default (screenshot-compare against today).
3. ✅ **Shop UI** with preview, plus ~10 items (paint, rugs, sofa colours).
4. ✅ **More items + milestones** (lifetime-beans achievements). These later map 1:1 to Steam achievements.

## 8. Decisions (answered 2026-10-09)
1. Currency: **токени / tokens**, shown with a pixel coin (not ☕). Save fields are `tokens` / `lifetimeTokens`.
2. **Waiting earns a little: 0.25.** An open but idle session (lead on the sofa, from `~/.claude/sessions`) earns 0.25 tokens per 10 min (`EARN.LIVE_IDLE`), added 2026-10-09.
3. Sub-agents earn 0.5×, max 6 counted (as proposed).
4. No daily cap (default, not explicitly answered).
5. **No back-pay** – everyone starts from 0.
6. Decorations: **both** – walls/floor/sofa office-wide, rug and chairs per team pod (`rug.team0`/`rug.team1`).
7. Purely cumulative for now (default, not explicitly answered; revisit with milestones in phase 4).

## 9. Steam notes (later)
- Keep the save-game format and item ids stable. Steam Cloud can sync `save.json`, and achievements map to milestones.
- Before any paid release: a professional or licensed art pack (the tileset override already exists), support for more agents (Codex, Gemini CLI, Cursor), a name without "Claude", and a clear "everything stays on your machine" privacy statement.
