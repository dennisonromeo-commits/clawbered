// CLAWBERED v1 front end. Loads pipeline JSON and renders every section.
import { Replay, buildPositions, miniBoard, HANDLES, baseSeconds, brilliantRaw, brilliantPlies } from "./replay.js";

const CFG = window.CLAWBERED_CONFIG || { dataPaths: ["data/"] };
const FILES = ["summary", "highlights", "games_of_period", "clock_chaos", "openings", "rating_timeline", "heatmap", "upsets", "endgame", "vault"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = (n) => Number(n).toLocaleString("en-US");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtDate = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${MON[m - 1]} ${dd}, ${y}`; };
const TERM = { mate: "checkmate", time: "on time", resign: "resignation", abandon: "abandonment", timevsinsufficient: "on time", checkmate: "checkmate" };
const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);
// Lichess clocks are whole seconds, so 0.0 there means "under a second"
const clk = (g) => (g.plat === "Lichess" && g.myclk === 0 ? "<1s" : `${g.myclk.toFixed(1)}s`);
const hr12 = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

// ---------- privacy guard: opponents are always "Opponent (rating)" ----------
function safeOpp(g) {
  if (typeof g.opp === "string" && /^Opponent \(\d+\)$/.test(g.opp)) return g.opp;
  return `Opponent (${g.opp_rating ?? "?"})`;
}

// The published data is pre-cleaned; the replay only needs SAN moves, so drop any PGN text defensively.
function dropPgn(o) {
  if (Array.isArray(o)) o.forEach(dropPgn);
  else if (o && typeof o === "object") { delete o.pgn; Object.values(o).forEach(dropPgn); }
  return o;
}

// "Brilliant" tag from Chess.com Game Review (future field). Accepts several shapes; returns {count, plies[]} or null.
function brilliantOf(g) {
  const v = brilliantRaw(g);
  if (v == null || v === false || v === 0 || (Array.isArray(v) && !v.length)) return null;
  const plies = [...brilliantPlies(g)];
  const n = typeof v === "number" ? v : Array.isArray(v) ? v.length : 1;
  return { count: Math.max(n, plies.length, 1), plies };
}
const brilliantSticker = (g) => { const b = brilliantOf(g); return b ? [b.count > 1 ? `${b.count}× BRILLIANT !!` : "BRILLIANT !!"] : []; };

// ---------- data loading ----------
async function pickDataPath() {
  const q = new URLSearchParams(location.search).get("data");
  const paths = q ? [q.endsWith("/") ? q : q + "/"] : CFG.dataPaths;
  for (const p of paths) {
    try { const r = await fetch(p + "summary.json", { cache: "no-cache" }); if (r.ok) return p; } catch (e) { /* try next */ }
  }
  throw new Error("No data folder found. Tried: " + paths.join(", "));
}
async function loadAll() {
  const base = await pickDataPath();
  const out = { _base: base };
  await Promise.all(FILES.map(async (f) => {
    try { const r = await fetch(base + f + ".json", { cache: "no-cache" }); out[f] = r.ok ? await r.json() : null; }
    catch (e) { out[f] = null; }
    if (!out[f]) console.warn(`[CLAWBERED] ${f}.json missing in ${base}`);
    else dropPgn(out[f]);
  }));
  return out;
}

// ---------- game registry (anything with san[] can be replayed) ----------
const REG = new Map();
function register(g, extra = {}) {
  const uid = g.id || `${g.plat}-${g.date}-${g.time}-${g.moves}-${g.opp_rating}`;
  const prev = REG.get(uid) || {};
  // first registration wins for descriptive fields (title, caption, stickers, key_ply); fill gaps from later files
  const game = { ...g, ...prev, uid };
  for (const [k, v] of Object.entries(extra)) if (game[k] == null || !REG.has(uid)) game[k] = v;
  if (!game.ev && g.ev) game.ev = g.ev;
  if (game.key_ply == null && g.key_ply != null) game.key_ply = g.key_ply;
  game.opp = safeOpp(game);
  const bs = brilliantSticker(game);
  if (bs.length && !(game.stickers || []).some((x) => /BRILLIANT/.test(x))) game.stickers = [...bs, ...(game.stickers || [])];
  REG.set(uid, game);
  return game;
}
const metaLine = (g) => `${g.plat} · ${g.tclass} ${g.tc} · ${fmtDate(g.date)}${g.time ? " " + g.time + " ET" : ""}`;
const wonBy = (t) => (t === "time" || t === "timevsinsufficient" ? "won on time" : `won by ${TERM[t] || t}`);
const resultLine = (g) => `as ${g.color} vs ${g.opp} · ${wonBy(g.term)}${g.moves ? ` in ${g.moves}` : ""}`;

let replay;
function playGame(uid, scroll = true) {
  const g = REG.get(uid);
  if (!g) return;
  replay.load(g);
  $("ti-title").textContent = g.title || "Highlight";
  $("ti-meta").textContent = `${metaLine(g)} · ${resultLine(g)}${g.opening ? " · " + g.opening : ""}`;
  $("ti-caption").textContent = g.caption || "";
  $("ti-stickers").innerHTML = (g.stickers || []).map((s) => `<span class="chip${/BRILLIANT/.test(s) ? " bril" : ""}">${esc(s)}</span>`).join("");
  $("ti-src").textContent = g.ev && g.ev.length ? `Eval: ${g.ev_source || "engine"}. Clocks from the game record.` : "No engine eval stored for this game; clocks from the game record.";
  document.querySelectorAll(".gcard.playing").forEach((c) => c.classList.remove("playing"));
  document.querySelectorAll(`[data-card="${CSS.escape(uid)}"]`).forEach((c) => c.classList.add("playing"));
  if (scroll) $("theater").scrollIntoView({ behavior: "smooth", block: "start" });
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-play]");
  if (b) { e.preventDefault(); playGame(b.dataset.play); }
});

// lazy mini boards: render when scrolled into view
const miniObs = new IntersectionObserver((es) => es.forEach((x) => {
  if (!x.isIntersecting) return;
  miniObs.unobserve(x.target);
  const g = REG.get(x.target.dataset.mini);
  if (!g) return;
  const pos = buildPositions(g.san);
  const k = Math.min(pos.length - 1, g.key_ply != null ? g.key_ply + 1 : pos.length - 1);
  miniBoard(x.target, pos[k].fen, g.color === "Black" ? "black" : "white", pos[k].lastMove);
}), { rootMargin: "200px" });
const mini = (g) => `<div class="mini" data-mini="${esc(g.uid)}"></div>`;
function hydrateMinis(root = document) { root.querySelectorAll("[data-mini]").forEach((el) => miniObs.observe(el)); }

function gameCard(g, { tag = "", rank = null, cls = "", showMini = true, prov = false } = {}) {
  return `<article class="gcard ${cls}" data-card="${esc(g.uid)}">
    ${rank ? `<span class="rank">${rank}</span>` : ""}${tag}
    <div class="gc-top">${showMini ? mini(g) : ""}<div>
      ${prov ? `<div class="prov">provisional pick</div>` : ""}
      <h4>${esc(g.title || "Highlight")}</h4>
      <div class="meta">${esc(`${g.plat} · ${g.tc} · ${fmtDate(g.date)}`)}<br>${esc(resultLine(g))}</div></div></div>
    <div>${(g.stickers || []).slice(0, 3).map((s) => `<span class="chip${/BRILLIANT/.test(s) ? " bril" : ""}">${esc(s)}</span>`).join("")}</div>
    <p class="cap">${esc(g.caption || "")}</p>
    <div class="row"><span class="meta">${esc(g.opening || "")}</span><button class="btn" data-play="${esc(g.uid)}">▶ Replay</button></div>
  </article>`;
}

// ---------- sections ----------
function renderHero(D) {
  const s = D.summary;
  document.querySelectorAll('[data-bind="period"]').forEach((e) => (e.textContent = s.period.label));
  { const m = (s.period.label || "").match(/([A-Za-z]{3})[^A-Za-z]+([A-Za-z]{3})/); document.querySelectorAll('[data-bind="period-short"]').forEach((e) => (e.textContent = m ? `${m[1]}–${m[2]}` : s.period.label)); }
  document.querySelectorAll('[data-bind="period-note"]').forEach((e) => (e.textContent = s.period.note));
  const pk = s.peaks || {};
  document.querySelector('[data-bind="cc-rating"]').textContent = pk.chesscom_bullet?.current ?? "–";
  document.querySelector('[data-bind="li-rating"]').textContent = pk.lichess_bullet?.current ?? "–";
  $("acct-cc").href = $("f-cc").href = CFG.profiles?.["Chess.com"] || "#";
  $("acct-li").href = $("f-li").href = CFG.profiles?.["Lichess"] || "#";
  $("hero-tickets").innerHTML = (s.headline || []).map((h) => `<div class="ticket"><div class="v">${esc(h.value)}</div><div class="l">${esc(h.label)}</div><div class="s">${esc(shortSub(h.sub))}</div></div>`).join("");
  const bits = ["−3 and still won", `${nf(s.clutch?.wins_le2s ?? 0)} wins with ≤2s`, "premove prayers answered", `${nf(s.totals.wins)} wins in 2026`, "flag 'em and bag 'em", `fastest mate: ${s.mates?.fastest_moves} moves`, "+560 giant-killing", `${nf(s.wins_by?.time ?? 0)} wins on time`, "clawbered"];
  const html = bits.map((b) => `<span>${esc(b)}</span>`).join("");
  $("marquee").innerHTML = html + html;
}

function heroBoard(D) {
  const hl = (D.highlights?.items || [])[0];
  if (!hl) { $("hero-board-cap").textContent = ""; return; }
  const g = REG.get(hl.id) || register(hl);
  const pos = buildPositions(g.san);
  const k = Math.min(pos.length - 1, g.key_ply != null ? g.key_ply + 1 : pos.length - 1);
  const cg = miniBoard($("hero-board"), pos[0].fen, g.color === "Black" ? "black" : "white");
  $("hero-board-cap").innerHTML = `#1 · ${esc(g.title)} · ${esc(g.opp)}<br><a href="#reel" data-play="${esc(g.uid)}" style="color:inherit">▶ watch it</a>`;
  let p = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { cg.set({ fen: pos[k].fen, lastMove: pos[k].lastMove }); return; }
  const tick = () => {
    p = p >= k ? 0 : p + 1;
    cg.set({ fen: pos[p].fen, lastMove: pos[p].lastMove, check: pos[p].check ? pos[p].turn : false, turnColor: pos[p].turn });
    setTimeout(tick, p === k ? 2600 : p === 0 ? 900 : 520);
  };
  setTimeout(tick, 900);
}

function renderStats(D) {
  const s = D.summary, t = s.totals;
  const score = (100 * (t.wins + t.draws / 2) / t.games).toFixed(1);
  const big = [
    [nf(t.games), "rated games", `${nf(t.by_plat["Chess.com"].games)} Chess.com · ${nf(t.by_plat["Lichess"].games)} Lichess`],
    [nf(t.wins), "wins", `${score}% score overall`],
    [nf(s.wins_by.time), "wins on time", "the flag is a finishing move"],
    [nf(s.mates.total), "checkmates", `fastest: ${s.mates.fastest_moves} moves`],
    [nf(s.streaks.combined.length), "win streak", `${fmtDate(s.streaks.combined.start.slice(0, 10))}, both sites`],
    [nf(s.best_day.wins), "wins in one day", fmtDate(s.best_day.date)],
    [nf(s.clutch.wins_le2s), "wins with ≤2s left", `${nf(s.clutch.wins_lt1s)} with under 1s`],
  ];
  $("stat-big").innerHTML = big.map(([v, l, sub]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div><div class="s">${esc(sub)}</div></div>`).join("");

  $("formats").innerHTML = s.formats.filter((f) => f.games > 0).map((f) => {
    const w = (100 * f.W) / f.games, d = (100 * f.D) / f.games, l = (100 * f.L) / f.games;
    return `<div class="fmt-row"><div class="nm"><b>${esc(f.plat)}</b><span>${esc(f.tclass)} · ${nf(f.games)} games</span></div>
      <div class="wdl" title="${f.W} W · ${f.D} D · ${f.L} L"><i class="w" style="width:${w}%"></i><i class="d" style="width:${d}%"></i><i class="l" style="width:${l}%"></i></div>
      <div class="sc">${f.score}%</div></div>`;
  }).join("") + `<div class="legend"><span><i style="background:var(--red)"></i>wins</span><span><i style="background:#777"></i>draws</span><span><i style="background:#3a3f4d"></i>the rest</span><span>score = W + ½D</span></div>`;

  // donut
  const wb = s.wins_by, keys = [["time", "On time", "#ff3b2f"], ["mate", "Checkmate", "#ffd23f"], ["resign", "Resignation", "#f4ead6"], ["abandon", "Abandoned", "#3fd0c9"]];
  const tot = keys.reduce((a, [k]) => a + (wb[k] || 0), 0);
  let acc = 0; const R = 54, C = 2 * Math.PI * R;
  const arcs = keys.map(([k, , c]) => { const f = (wb[k] || 0) / tot; const seg = `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${c}" stroke-width="26" stroke-dasharray="${f * C} ${C}" stroke-dashoffset="${-acc * C}" transform="rotate(-90 75 75)"/>`; acc += f; return seg; }).join("");
  $("winsby").innerHTML = `<div class="donut-wrap"><svg class="donut" viewBox="0 0 150 150">${arcs}<circle r="41" cx="75" cy="75" fill="#171b25"/><text x="75" y="72" text-anchor="middle" fill="#f4ead6" font-family="Anton,Impact" font-size="28">${nf(tot)}</text><text x="75" y="90" text-anchor="middle" fill="#9aa0ad" font-size="11" font-family="Grotesk,sans-serif">WINS</text></svg>
    <div class="donut-legend">${keys.map(([k, n, c]) => `<div><span><i style="background:${c}"></i>${n}</span><b>${nf(wb[k] || 0)}</b></div>`).join("")}</div></div>`;

  const P = s.peaks;
  $("peaks").innerHTML = ["chesscom_bullet", "lichess_bullet", "chesscom_blitz", "lichess_blitz"].filter((k) => P[k]).map((k) => {
    const p = P[k], delta = p.current - p.first;
    return `<div class="peak"><div><div class="p">${p.peak}</div><div class="m">${esc(p.plat)} ${esc(p.tclass)} · peak ${fmtDate(p.date)}</div></div>
      <span class="d" title="Start of 2026 → now">${delta > 0 ? "+" + delta + " in 2026" : "PEAK " + p.peak}</span></div>`;
  }).join("");
}

function periodTitle(it) {
  if (it.title) return it.title;
  if (brilliantOf(it) && it.key_move?.move_number) return `BRILLIANT ON MOVE ${it.key_move.move_number}`;
  if (it.term === "mate") return `MATE ON MOVE ${it.moves}`;
  if (it.term === "time") return `FLAGGED ON MOVE ${it.moves}`;
  if (it.term === "resign") return `KNOCKOUT IN ${it.moves}`;
  return "THE PICK";
}
function periodStickers(it) {
  const st = [...(it.stickers || [])];
  if (it.accuracy != null && it.accuracy >= 90) st.push(`${it.accuracy}% ACCURACY`);
  const sm = it.standout_move || it.key_move;
  if (sm?.label && sm.by !== "opponent") st.push(`★ ${sm.label}`);
  if (it.myclk != null && it.myclk <= 2) st.push(`${it.myclk.toFixed(1)}s LEFT`);
  if (it.opp_rating - it.me >= 200) st.push(`+${it.opp_rating - it.me} UPSET`);
  return st.slice(0, 3);
}

// Games of the Week/Month/Year. Uses the coach's picks when present; otherwise a clearly labelled provisional auto-pick.
function renderGOTW(D) {
  const gp = D.games_of_period;
  const coach = gp && gp.status === "coach";
  const pool = [...REG.values()].filter((g) => g.score != null);
  pool.sort((a, b) => b.score - a.score);
  const used = new Set();
  const take = (arr) => { const r = arr.filter((g) => !used.has(g.uid)).slice(0, 2); r.forEach((g) => used.add(g.uid)); return r; };
  const latest = pool.reduce((m, g) => (g.date > m ? g.date : m), "0000");
  const dayN = (d) => Date.parse(d + "T12:00:00Z") / 864e5;
  const auto = {};
  auto.year = { picks: take(pool), label: "2026 to date" };
  const ym = latest.slice(0, 7);
  let monthPicks = take(pool.filter((g) => g.date.startsWith(ym)));
  auto.month = { picks: monthPicks, label: `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` };
  let win = 7, wk = [];
  while (win <= 63) { wk = pool.filter((g) => !used.has(g.uid) && dayN(latest) - dayN(g.date) < win); if (wk.length >= 2) break; win += 7; }
  const wkPicks = take(wk);
  const from = new Date((dayN(latest) - win + 1) * 864e5).toISOString().slice(0, 10);
  auto.week = { picks: wkPicks, label: win === 7 ? `week ending ${fmtDate(latest)}` : `latest standouts · ${fmtDate(from).replace(/, \d{4}/, "")} – ${fmtDate(latest).replace(/, \d{4}/, "")}` };

  const cols = ["week", "month", "year"].map((per) => {
    let items = [], prov = !coach, label = auto[per].label;
    const P = gp?.periods?.[per] || {};
    if (coach) {
      if (P.window) label = P.window;
      for (const slot of ["winner", "runner_up"]) {
        const it = P[slot];
        if (it && it.san) items.push(register(it, { title: periodTitle(it), caption: it.caption || it.note || "", stickers: periodStickers(it) }));
      }
      if (!items.length) { items = auto[per].picks; prov = true; }
    } else items = auto[per].picks;
    const cards = items.map((g, i) => gameCard(g, { tag: `<span class="slot-tag ${i ? "ru" : ""}">${i ? "Runner-up" : "Winner"}</span>`, cls: i ? "runner" : "", prov })).join("");
    return `<div class="period"><div class="period-h"><h3>${esc(P.label || "Game of the " + per[0].toUpperCase() + per.slice(1))}</h3><span>${esc(label)}</span></div>${cards || '<p class="meta">No pick yet.</p>'}</div>`;
  });
  $("gotw-grid").innerHTML = cols.join("");
  $("gotw-note").textContent = coach
    ? (gp.data_note || "Hand-picked winners plus a runner-up for each period.")
    : "Provisional: the official picks haven't landed yet, so these are auto-picked from the highest-scoring highlights in each window. They switch to the official picks as soon as games_of_period.json has them.";
}

function renderReel(D) {
  const items = (D.highlights?.items || []).map((h) => REG.get(h.id));
  $("reel-method").textContent = D.highlights?.method || "";
  const cats = [...new Set(items.map((g) => g.category))];
  const NAMES = { upset: "Upsets", swindle: "Escapes", fast_mate: "Fast mates", low_clock: "Low clock", comeback: "Comebacks", pretty_mate: "Pretty mates", sacrifice: "Sacrifices", swing: "Pounces" };
  $("reel-filters").innerHTML = `<button class="on" data-f="all">All ${items.length}</button>` + cats.map((c) => `<button data-f="${esc(c)}">${esc(NAMES[c] || c)}</button>`).join("");
  const draw = (f) => {
    const list = items.filter((g) => f === "all" || g.category === f);
    $("reel-grid").innerHTML = list.map((g) => gameCard(g, { rank: g.rank })).join("");
    $("reel-grid").classList.toggle("collapsed", list.length > 6);
    $("reel-more").hidden = list.length <= 6;
    $("reel-more").textContent = `Show all ${list.length} highlights`;
    hydrateMinis($("reel-grid"));
    if (replay.game) document.querySelectorAll(`[data-card="${CSS.escape(replay.game.uid)}"]`).forEach((c) => c.classList.add("playing"));
  };
  $("reel-filters").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    $("reel-filters").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); draw(b.dataset.f);
  });
  $("reel-more").addEventListener("click", () => { $("reel-grid").classList.remove("collapsed"); $("reel-more").hidden = true; });
  draw("all");
  if (items[0]) playGame(items[0].uid, false);
}

function renderChaos(D) {
  const c = D.clock_chaos; if (!c) return;
  const k = c.counts;
  $("chaos-note").textContent = `${k.note} ${D.summary?.minus3?.note || ""}`;
  $("chaos-counts").innerHTML = [[k.wins_le2s, "wins with ≤2 seconds left"], [k.wins_lt1s, "wins with under 1 second"], [k.minus3, "wins after being down 3+ material"], [k.minus3_on_time, "of those, finished on the clock"]]
    .map(([v, l]) => `<div class="cc"><div class="v">${nf(v)}</div><div class="l">${esc(l)}</div></div>`).join("");
  const poster = (g, mode) => {
    const head = mode === "clock" ? "FLAGGED 'EM" : "DOWN BAD, STILL WON";
    const big = mode === "clock" ? esc(clk(g)) : minus(g.deficit);
    const sub = mode === "clock" ? `left on his clock · ${wonBy(g.term)}` : `material at worst · ${clk(g)} left · ${wonBy(g.term)}`;
    return `<div class="poster" data-play="${esc(g.uid)}" role="button" tabindex="0" title="Replay this game">
      <div class="ph">${head}</div><div class="big">${big}</div><div class="sub">${esc(sub)}</div>
      <div class="foot">vs ${esc(g.opp)}${g.opp_berserk ? ' <span class="bz">berserked</span>' : ""}<br>${esc(g.plat)} · ${esc(g.tc)} · ${fmtDate(g.date)}<br>${esc(g.opening || "")}${g.mode === "clock" && g.deficit <= -3 ? "" : ""}${mode === "clock" && g.deficit <= -3 ? ` · also ${minus(g.deficit)} material` : ""} · ▶ replay</div></div>`;
  };
  $("wall-lowest").innerHTML = c.lowest.map((g) => poster(REG.get(g._uid), "clock")).join("");
  $("wall-minus3").innerHTML = c.minus3.map((g) => poster(REG.get(g._uid), "minus3")).join("");
  document.querySelectorAll(".poster").forEach((p) => p.addEventListener("keydown", (e) => { if (e.key === "Enter") playGame(p.dataset.play); }));
}

function renderOpenings(D) {
  const o = D.openings; if (!o) return;
  $("open-note").textContent = o.note;
  const row = (f, i) => `<div class="op"><div class="medal">${i + 1}</div><div><h4>${esc(f.label || f.family)}</h4>
      <div class="bar"><i style="width:${f.score}%"></i></div><div class="m">${nf(f.games)} games · ${nf(f.W)} wins</div></div>
      <div class="sc">${f.score}%<small>score</small></div></div>`;
  $("open-white").innerHTML = (o.best.White || []).map(row).join("");
  $("open-black").innerHTML = (o.best.Black || []).map(row).join("");
  $("open-most").innerHTML = (o.most_wins || []).map((f) => `<div class="wh"><div class="v">${nf(f.W)}</div><div class="l">wins · ${esc(f.label || f.family)}</div><div class="s">as ${esc(f.color)} · ${nf(f.games)} games</div></div>`).join("");
}

function renderRatings(D) {
  const R = D.rating_timeline; if (!R) return;
  const CB = R.peaks?.chesscom_bullet;
  if (CB) $("rating-hero").innerHTML = `<div class="rh-l"><span class="rh-k">Chess.com bullet · 2026</span><span class="rh-v">${CB.first} <i>→</i> <b>${CB.current}</b></span></div><div class="rh-badges"><span class="chip">+${CB.current - CB.first} THIS YEAR</span><span class="chip">${nf(CB.games)} GAMES</span></div>`;
  $("rating-note").textContent = `${R.note} Chess.com and Lichess use different rating pools, so the lines aren't directly comparable. Chess.com bullet is shown by default; tap the chips to add the others.`;
  const STY = { "Chess.com bullet": ["#ff3b2f", "", "chesscom_bullet"], "Lichess bullet": ["#f4ead6", "", "lichess_bullet"], "Chess.com blitz": ["#ffd23f", "7 5", "chesscom_blitz"], "Lichess blitz": ["#3fd0c9", "7 5", "lichess_blitz"] };
  const names = Object.keys(R.series).sort((a, b) => Object.keys(STY).indexOf(a) - Object.keys(STY).indexOf(b));
  // Chess.com bullet is the featured line; the others are optional, secondary toggles (off by default).
  const FEATURED = "Chess.com bullet";
  const on = new Set(names.includes(FEATURED) ? [FEATURED] : names.slice(0, 1));
  const svg = $("rating-chart"), tip = $("rating-tip");
  // phones get a narrower viewBox (bigger type, taller plot); desktop a wide one
  const narrow = (svg.parentElement.clientWidth || 1000) < 640;
  const W = narrow ? 520 : 1000, H = narrow ? 460 : 440, fs = narrow ? 1.35 : 1;
  const m = narrow ? { l: 46, r: 16, t: 54, b: 34 } : { l: 52, r: 70, t: 20, b: 36 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const t0 = Date.parse(R.period.start), t1 = Date.parse(R.period.end);
  const X = (d) => m.l + ((Date.parse(d) - t0) / (t1 - t0)) * (W - m.l - m.r);
  const draw = () => {
    const vis = names.filter((n) => on.has(n));
    const vals = vis.flatMap((n) => R.series[n].map((p) => p[1]));
    let lo = Math.floor((Math.min(...vals) - 30) / 100) * 100, hi = Math.ceil((Math.max(...vals) + 30) / 100) * 100;
    if (!vals.length) { lo = 1000; hi = 2000; }
    const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    let g = `<defs><linearGradient id="rc-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff3b2f" stop-opacity=".35"/><stop offset="1" stop-color="#ff3b2f" stop-opacity="0"/></linearGradient></defs>`;
    svg._skipLast = new Set();
    for (let v = lo; v <= hi; v += 100) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#2a2f3d"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" fill="#9aa0ad" font-size="${12 * fs}" font-family="Mono,monospace">${v}</text>`;
    const s0 = new Date(R.period.start), s1 = new Date(R.period.end);
    for (let d = new Date(Date.UTC(s0.getUTCFullYear(), s0.getUTCMonth(), 1)); d <= s1; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const iso = d.toISOString().slice(0, 10), x = X(iso);
      if (narrow && d.getUTCMonth() % 2) { g += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" stroke="#1f2430"/>`; continue; }
      g += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}" stroke="#1f2430"/><text x="${x + 4}" y="${H - m.b + 20}" fill="#9aa0ad" font-size="${12 * fs}" font-family="Mono,monospace">${MON[d.getUTCMonth()]}</text>`;
    }
    for (const n of vis) {
      const [c, dash, pk] = STY[n] || ["#aaa", "", null];
      const pts = R.series[n];
      const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join(" ");
      const feat = n === FEATURED;
      if (feat) { const area = `${d} L${X(pts[pts.length - 1][0]).toFixed(1)} ${H - m.b} L${X(pts[0][0]).toFixed(1)} ${H - m.b} Z`; g += `<path d="${area}" fill="url(#rc-grad)"/>`; }
      g += `<path class="rline" d="${d}" fill="none" stroke="#000" stroke-width="${feat ? 9 : 6}" stroke-linejoin="round" opacity=".6"/><path class="rline ${feat ? "featured" : ""}" data-series="${esc(n)}" d="${d}" fill="none" stroke="${c}" stroke-width="${feat ? 4.5 : 2.4}" stroke-linejoin="round" stroke-dasharray="${dash}" opacity="${feat ? 1 : .8}"/>`;
      const P = R.peaks?.[pk];
      if (P) {
        const pp = pts.find((p) => p[0] === P.date && p[1] === P.peak) || pts.reduce((a, b) => (b[1] > a[1] ? b : a));
        const px = X(pp[0]), py = Y(pp[1]);
        const feat = n === FEATURED, nearEnd = px > W - m.r - 120;
        g += `<circle class="${feat ? "peak-dot" : ""}" data-peak="${pp[1]}" cx="${px}" cy="${py}" r="${feat ? 10 : 6}" fill="${c}" stroke="#000" stroke-width="3"/>`
          + `<text x="${nearEnd ? px - 16 : px}" y="${py - (feat ? 18 : 12)}" text-anchor="${nearEnd ? "end" : "middle"}" fill="${c}" font-size="${(feat ? 26 : 14) * fs}" font-family="Anton,Impact" letter-spacing=".5" stroke="#000" stroke-width="${feat ? 5 : 3}" paint-order="stroke">PEAK ${pp[1]}${feat ? " · " + fmtDate(pp[0]).replace(/, \d{4}/, "") : ""}</text>`;
        if (pp === pts[pts.length - 1]) { svg._skipLast = (svg._skipLast || new Set()).add(n); }
      }
      const last = pts[pts.length - 1];
      if (!(svg._skipLast && svg._skipLast.has(n))) g += `<text x="${X(last[0]) + 8}" y="${Y(last[1]) + 4}" fill="${c}" font-size="${13 * fs}" font-family="Mono,monospace" font-weight="700">${last[1]}</text>`;
    }
    g += `<line id="rc-x" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="#f4ead6" stroke-dasharray="3 3" opacity="0"/>`;
    svg.innerHTML = g;
    svg._Y = Y;
  };
  $("rating-chips").innerHTML = `<span class="chips-l">Add lines:</span>` + names.map((n) => `<button data-s="${esc(n)}" class="${on.has(n) ? "" : "off"}"><i style="background:${STY[n]?.[0] || "#aaa"}"></i>${esc(n)}</button>`).join("");
  $("rating-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const n = b.dataset.s; if (on.has(n) && on.size > 1) on.delete(n); else on.add(n);
    b.classList.toggle("off", !on.has(n)); draw();
  });
  const move = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    if (x < m.l || x > W - m.r) { tip.style.opacity = 0; return; }
    const t = t0 + ((x - m.l) / (W - m.l - m.r)) * (t1 - t0);
    const iso = new Date(t).toISOString().slice(0, 10);
    const rows = names.filter((n) => on.has(n)).map((n) => { const pts = R.series[n]; let v = null; for (const p of pts) { if (p[0] <= iso) v = p; else break; } return v ? `<div><b style="color:${STY[n][0] === "#f4ead6" ? "#000" : STY[n][0]}">■</b> ${esc(n)}: <b>${v[1]}</b></div>` : ""; }).join("");
    tip.innerHTML = `<b>${fmtDate(iso)}</b>${rows}`;
    tip.style.opacity = 1;
    const px = clientX - r.left;
    tip.style.left = Math.min(r.width - 200, Math.max(0, px + 14)) + "px"; tip.style.top = "16px";
    const l = svg.querySelector("#rc-x"); l.setAttribute("x1", x); l.setAttribute("x2", x); l.setAttribute("opacity", ".6");
  };
  svg.addEventListener("mousemove", (e) => move(e.clientX));
  svg.addEventListener("touchmove", (e) => move(e.touches[0].clientX), { passive: true });
  svg.addEventListener("mouseleave", () => { tip.style.opacity = 0; svg.querySelector("#rc-x")?.setAttribute("opacity", 0); });
  draw();
  $("climb-cards").innerHTML = Object.entries(STY).filter(([n, s]) => R.peaks?.[s[2]]).map(([n, s]) => {
    const p = R.peaks[s[2]], d = p.current - p.first;
    return `<div class="climb" style="--c:${s[0]}"><div class="t">${esc(n)}</div><div class="v">${p.current}</div><div class="s">started 2026 at ${p.first} · 2026 peak ${p.peak}</div>${d > 0 ? `<div class="up">▲ +${d} this year</div>` : `<div class="up">2026 peak ${p.peak} on ${fmtDate(p.date)}</div>`}</div>`;
  }).join("");
}

function renderHeat(D) {
  const H = D.heatmap; if (!H) return;
  $("heat-note").textContent = H.note;
  const cell = new Map(H.cells.map((c) => [`${c.wd}-${c.hr}`, c]));
  const best = new Set((H.best || []).map((c) => `${c.wd}-${c.hr}`));
  const maxW = Math.max(...H.cells.map((c) => c.wins));
  let html = `<div></div>` + Array.from({ length: 24 }, (_, h) => `<div class="hh">${h % 3 === 0 ? hr12(h) : ""}</div>`).join("");
  for (let wd = 0; wd < 7; wd++) {
    html += `<div class="hl">${DAYS[wd]}</div>`;
    for (let h = 0; h < 24; h++) {
      const c = cell.get(`${wd}-${h}`);
      const t = c ? c.wins / maxW : 0;
      const bg = c ? `rgba(255,59,47,${(0.1 + 0.9 * Math.pow(t, 0.8)).toFixed(3)})` : "";
      html += `<div class="c ${best.has(`${wd}-${h}`) ? "best" : ""}" data-k="${wd}-${h}" style="${bg ? "background:" + bg : ""}" title="${DAYS[wd]} ${hr12(h)} ET: ${c ? `${c.wins} wins / ${c.games} games (${c.score}%)` : "no games"}"></div>`;
    }
  }
  $("heat-grid").innerHTML = html;
  $("heat-grid").insertAdjacentHTML("afterend", "");
  document.querySelector(".heat-scroll").insertAdjacentHTML("afterend", `<div class="heat-legend">fewer wins <i style="background:rgba(255,59,47,.12)"></i><i style="background:rgba(255,59,47,.4)"></i><i style="background:rgba(255,59,47,.7)"></i><i style="background:rgba(255,59,47,1)"></i> more wins · ★ = best score % (with enough games)</div>`);
  const show = (k, el) => {
    const c = cell.get(k); const [wd, h] = k.split("-").map(Number);
    $("heat-grid").querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); el.classList.add("sel");
    $("heat-detail").textContent = c ? `${DAYS[wd]} ${hr12(h)}–${hr12((h + 1) % 24)} ET · ${c.wins} wins from ${c.games} games · ${c.score}% score` : `${DAYS[wd]} ${hr12(h)} ET · off the clock (no games)`;
  };
  $("heat-grid").addEventListener("mouseover", (e) => { const el = e.target.closest(".c"); if (el) show(el.dataset.k, el); });
  $("heat-grid").addEventListener("click", (e) => { const el = e.target.closest(".c"); if (el) show(el.dataset.k, el); });
  $("heat-best").innerHTML = (H.best || []).map((c) => `<div class="hb"><b>${DAYS[c.wd].toUpperCase()} ${hr12(c.hr).toUpperCase()}</b>${c.wins} wins · ${c.score}% score</div>`).join("");
}

function renderUpsets(D) {
  const U = D.upsets; if (!U) return;
  $("upset-note").textContent = U.note;
  const items = [...U.items].sort((a, b) => b.gap - a.gap).map((u) => REG.get(u.id || u._uid));
  const [u1, ...rest] = items;
  const base = baseSeconds(u1.tc);
  const bz = u1.opp_berserk ? `<span class="note">Footnote: the opponent berserked (${base / 2}s vs his ${base}s)</span>` : "";
  let html = `<article class="u1" data-card="${esc(u1.uid)}"><span class="num">#1 UPSET OF 2026</span><div class="gap">+${u1.gap}</div>
    <div class="vs">beat <b>${esc(u1.opp)}</b> as ${esc(u1.color)} (${u1.me})</div>
    <div class="meta" style="color:#ffd9d4">${esc(metaLine(u1))} · ${esc(wonBy(u1.term))} in ${u1.moves} · ${esc(u1.opening || "")}</div>
    <p class="cap">${esc(u1.caption || "")}</p>${bz}<button class="btn" data-play="${esc(u1.uid)}">▶ Replay the upset</button></article>`;
  html += `<div class="u-rest">` + rest.map((u, i) => `<article class="ux" data-card="${esc(u.uid)}"><div class="rk">#${i + 2}</div><div><div class="g">+${u.gap}</div><div class="d"><b>beat ${esc(u.opp)}</b><br>${esc(u.plat)} ${esc(u.tc)} · ${fmtDate(u.date)} · ${esc(TERM[u.term] || u.term)} in ${u.moves}${u.opp_berserk ? " · opp berserked" : ""}</div></div><button class="btn" data-play="${esc(u.uid)}">▶ Replay</button></article>`).join("") + `</div>`;
  $("upset-list").innerHTML = html;
}

function renderGrind(D) {
  const E = D.endgame; if (!E || !E.items?.length) { $("grind").style.display = "none"; return; }
  $("grind-note").textContent = `${nf(E.count)} wins in 2026 where the queens came off and he still brought it home. ${E.note}`;
  $("grind-list").innerHTML = E.items.map((e) => gameCard(REG.get(e.id || e._uid))).join("");
  hydrateMinis($("grind-list"));
}

// From the vault: hand-picked pre-2026 games. Registered for replay only; never part of stats or the 2026 pools.
function renderVault(D) {
  const V = D.vault, games = (V?.games || []).filter((g) => g && g.san && g.san.length);
  const sec = $("vault");
  if (!games.length) { sec.style.display = "none"; return; }
  $("vault-note").textContent = V.note || "Hand-picked games from before 2026. Not counted in any 2026 stats.";
  $("vault-list").innerHTML = games.map((v, i) => {
    const g = register({ ...v, id: v.id || `vault-${i + 1}` }, { title: v.title || "From the vault", stickers: [...(v.accuracy != null ? [`${v.accuracy}% ACCURACY`] : [])] });
    delete g.score; // keep it out of the Game-of-the-Period pools
    const year = String(g.date || "").slice(0, 4);
    const km = g.key_move?.label ? `${g.key_move.label}${brilliantPlies(g).has(g.key_ply) ? "!!" : ""}` : "";
    return `<article class="vault-card gcard" data-card="${esc(g.uid)}">
      <div class="vault-stamp">FROM THE VAULT · ${esc(year)}</div>
      <div class="vault-body">${mini(g)}<div>
        <h4>${esc(g.title)}</h4>
        <div class="meta">${esc(`${g.plat} · ${g.tclass} ${g.tc} · ${fmtDate(g.date)}`)}<br>${esc(resultLine(g))}<br>${esc(g.opening || "")}</div>
        <div class="vault-chips">${(g.stickers || []).map((s) => `<span class="chip${/BRILLIANT/.test(s) ? " bril" : ""}">${esc(s)}</span>`).join("")}</div>
      </div></div>
      <p class="cap">${esc(g.caption || "")}</p>
      <div class="row"><span class="meta">${g.excluded_from_stats ? "Archive piece · not in 2026 stats" : ""}</span><button class="btn" data-play="${esc(g.uid)}">▶ Replay${km ? ` · <span class="mv">${esc(km)}</span>` : ""}</button></div>
    </article>`;
  }).join("");
  hydrateMinis($("vault-list"));
}

function registerAll(D) {
  // highlights first (richest: title, stickers, evals)
  for (const h of D.highlights?.items || []) register(h);
  for (const u of D.upsets?.items || []) {
    const ex = u.id && REG.get(u.id);
    const st = [`+${u.gap} UPSET`, ...(u.opp_berserk ? ["OPP BERSERKED"] : [])];
    const g = register(u, ex ? {} : { title: `GIANT SLAYER`, stickers: st, caption: u.caption || `Outrated by ${u.gap} and ${wonBy(u.term)}.` });
    if (g.score == null) g.score = 10 + u.gap / 40;
    u._uid = g.uid;
  }
  const C = D.clock_chaos || {};
  for (const [list, mode] of [[C.lowest || [], "clock"], [C.minus3 || [], "minus3"]]) for (const c of list) {
    const st = [`${clk(c)} LEFT`, ...(c.deficit <= -3 ? ["−3 AND STILL WON"] : [])];
    const title = mode === "clock" ? "ZERO-SECOND HERO" : `${minus(c.deficit)} AND STILL WON`;
    const cap = mode === "clock"
      ? `${wonBy(c.term).replace(/^w/, "W")} with ${clk(c)} on his clock after ${c.moves} moves.${c.deficit <= -3 ? ` He was ${minus(c.deficit)} in material at the low point.` : ""}`
      : `Down ${Math.abs(c.deficit)} points of material at the worst moment and still ${wonBy(c.term)}, ${clk(c)} left.`;
    const g = register(c, { title, stickers: st, caption: cap });
    if (g.score == null) g.score = 6 + Math.max(0, 2 - c.myclk) + Math.min(5, -c.deficit / 4);
    c._uid = g.uid;
  }
  for (const e of D.endgame?.items || []) {
    const ex = e.id && REG.get(e.id);
    const g = register(e, ex ? { key_ply: ex.key_ply ?? e.key_ply } : { title: "THE LONG GAME", stickers: ["QUEENS OFF", ...(e.promoted ? [`${e.promoted}× PROMOTED`] : [])] });
    if (g.score == null) g.score = 5;
    e._uid = g.uid;
  }
}

async function main() {
  replay = new Replay($("theater"));
  let D;
  try { D = await loadAll(); }
  catch (e) { console.error(e); $("hero-tickets").innerHTML = `<div class="ticket"><div class="l">Data not found</div><div class="s">${esc(e.message)}</div></div>`; return; }
  window.CLAWBERED_DATA = D;
  registerAll(D);
  const steps = [renderHero, renderStats, renderReel, renderGOTW, renderChaos, renderOpenings, renderRatings, renderHeat, renderUpsets, renderGrind, renderVault, heroBoard];
  for (const f of steps) { try { f(D); } catch (e) { console.error(`[CLAWBERED] ${f.name} failed`, e); } }
  hydrateMinis();
  const s = D.summary?.period;
  $("foot-scope").textContent = s ? `Scope: ${s.label}. ${s.note}` : "";
  const sample = Object.values(D).some((v) => v && typeof v === "object" && v.SAMPLE);
  $("foot-data").textContent = `Data: ${D._base}${sample ? " (SAMPLE DATA)" : ""} · last games: Chess.com ${s?.last_game?.chesscom || "?"}, Lichess ${s?.last_game?.lichess || "?"}`;
  document.documentElement.dataset.ready = "1";
}
main();

function shortSub(t) { t = String(t || ""); if (t.length <= 28) return t; const a = t.split(/\s[·\-–—]\s|\s*\(/)[0].trim(); return a.length <= 22 ? a : a.split(", ")[0].trim(); }
