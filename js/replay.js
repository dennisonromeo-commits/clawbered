// CLAWBERED replay board: chessground (view) + chess.js (move legality / FEN).
import { Chessground } from "../vendor/chessground/chessground.min.js";
import { Chess } from "../vendor/chessjs/chess.js";

export const HANDLES = (window.CLAWBERED_CONFIG || {}).handles || {};

/** Parse "60+0" / "60" / "180+2" -> base seconds (NaN for daily etc.) */
export function baseSeconds(tc) {
  if (!tc || String(tc).includes("/")) return NaN;
  return parseFloat(String(tc).split("+")[0]);
}

/** Build the list of positions for a SAN array. positions[p] = board after p plies. */
export function buildPositions(san) {
  const chess = new Chess();
  const out = [{ fen: chess.fen(), lastMove: undefined, check: false, turn: "white", san: null }];
  for (const s of san || []) {
    let m;
    try { m = chess.move(s); } catch (e) { console.warn("Replay stopped at illegal SAN", s); break; }
    out.push({ fen: chess.fen(), lastMove: [m.from, m.to], check: chess.inCheck(), turn: chess.turn() === "w" ? "white" : "black", san: m.san });
  }
  return out;
}

/** Brilliant tag (Chess.com Game Review). Accepts: true, a count, ply numbers, {ply} objects,
 *  move labels like "14...Qxd2+" / "15.Qxf7+", or bare SAN. Returns a Set of 0-based ply indexes. */
export function brilliantRaw(g) {
  return g.brilliant ?? g.brilliants ?? g.brilliant_moves ?? g.review?.brilliant ?? g.cc_brilliant;
}
export function brilliantPlies(g) {
  const v = brilliantRaw(g), san = g.san || [], out = new Set();
  const norm = (m) => String(m).replace(/[!?]+$/g, "").replace(/[+#]$/, "");
  const arr = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : typeof v === "string" ? [v] : [];
  for (const x of arr) {
    if (Number.isInteger(x)) { out.add(x); continue; }
    if (x && typeof x === "object") { if (Number.isInteger(x.ply)) { out.add(x.ply); continue; } }
    const lab = typeof x === "string" ? x : x?.label || x?.san;
    if (!lab) continue;
    const m = String(lab).trim().match(/^(\d+)\s*(\.\.\.|\.)\s*(.+)$/);
    if (m) {
      const ply = (parseInt(m[1]) - 1) * 2 + (m[2] === "..." ? 1 : 0);
      if (!san.length || norm(san[ply]) === norm(m[3])) { out.add(ply); continue; }
    }
    const want = norm(m ? m[3] : lab), mine = g.color === "Black" ? 1 : 0;
    const i = san.findIndex((s2, k) => k % 2 === mine && norm(s2) === want);
    if (i >= 0) out.add(i);
  }
  return out;
}

export function fmtClock(s) {
  if (s == null || isNaN(s)) return "–";
  s = Math.max(0, s);
  const m = Math.floor(s / 60), sec = s - m * 60;
  if (s < 20 && Math.abs(s - Math.round(s)) > 1e-6) return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
  return `${m}:${String(Math.floor(sec)).padStart(2, "0")}`;
}

/** Shrink the eval label until it fits inside the bar (never clipped). */
export function fitEvalLabel(el) {
  el.style.fontSize = "";
  const room = (el.parentElement?.clientWidth || el.clientWidth) - 1;
  if (!room || !el.textContent) return;
  const rg = document.createRange();
  let fs = parseFloat(getComputedStyle(el).fontSize) || 9;
  rg.selectNodeContents(el);
  while (rg.getBoundingClientRect().width > room && fs > 5) { fs -= 0.5; el.style.fontSize = fs + "px"; }
}

/** Size of the advantage for the eval-bar label: "M" for mate (|cp| >= 1500), else pawns with no sign. */
export function evalSize(cp) {
  if (cp == null) return "–";
  if (Math.abs(cp) >= 1500) return "M";
  const v = Math.abs(cp) / 100;
  return v >= 9.95 ? String(Math.round(v)) : v.toFixed(1); // whole numbers from 10 up, one decimal below

}

export function fmtEval(cp) {
  if (cp == null) return "–";
  if (Math.abs(cp) >= 1500) return cp > 0 ? "+M" : "−M";
  const v = (cp / 100).toFixed(1);
  return cp > 0 ? `+${v}` : cp < 0 ? `−${v.slice(1)}` : "0.0";
}

/** Mount a small view-only board (hero / cards). */
export function miniBoard(el, fen, orientation = "white", lastMove) {
  return Chessground(el, {
    fen, orientation, lastMove, viewOnly: true, coordinates: false,
    animation: { enabled: true, duration: 220 }, drawable: { enabled: false, visible: false },
  });
}

export class Replay {
  constructor(root) {
    this.root = root;
    this.$ = (id) => document.getElementById(id);
    this.cg = Chessground(this.$("board"), {
      viewOnly: true, coordinates: true, animation: { enabled: true, duration: 180 },
      drawable: { enabled: true, visible: true }, highlight: { lastMove: true, check: true },
    });
    this.p = 0; this.timer = null; this.game = null; this.flipped = false;
    this.speeds = [0.5, 1, 2]; this.speedIx = 1;
    this.scrub = this.$("scrub");
    this.scrub.addEventListener("input", () => { this.stop(); this.go(+this.scrub.value); });
    root.querySelectorAll(".controls button[data-act], .controls2 button[data-act]").forEach((b) => b.addEventListener("click", () => this.act(b.dataset.act)));
    this.$("movelist").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (b) { this.stop(); this.go(+b.dataset.p); } });
    this.$("moments")?.addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (b) { this.stop(); this.go(+b.dataset.p); } });
    // graphs: press/drag to seek, hover for a readout
    for (const id of ["g-eval", "g-clk"]) {
      const svg = this.$(id), box = svg.parentElement;
      const tip = document.createElement("span"); tip.className = "gtip"; tip.setAttribute("aria-hidden", "true"); box.appendChild(tip);
      const plyAt = (x) => { const r = svg.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (x - r.left) / r.width)); return { p: Math.round(f * (this.pos.length - 1)), px: f * r.width }; };
      let down = false;
      box.addEventListener("pointerdown", (e) => { if (!this.game) return; down = true; box.setPointerCapture?.(e.pointerId); this.stop(); this.go(plyAt(e.clientX).p); });
      box.addEventListener("pointerup", () => { down = false; });
      box.addEventListener("pointercancel", () => { down = false; });
      box.addEventListener("pointermove", (e) => {
        if (!this.game) return;
        const { p, px } = plyAt(e.clientX);
        if (down) this.go(p);
        tip.textContent = this.readout(p, id === "g-eval" ? "eval" : "clock");
        tip.style.left = Math.max(4, Math.min(px + 8, box.clientWidth - tip.offsetWidth - 4)) + "px";
        box.classList.add("hover");
      });
      box.addEventListener("pointerleave", () => box.classList.remove("hover"));
    }
    // keyboard: only while the theater is on screen
    this.visible = false;
    new IntersectionObserver((es) => es.forEach((x) => { this.visible = x.isIntersecting; if (!x.isIntersecting && this.timer) this.stop(); }), { threshold: 0.25 }).observe(root);
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.timer) this.stop(); });
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!this.visible || !this.game || /input|textarea|select/i.test(e.target.tagName) && e.target !== this.scrub) return;
      if (e.defaultPrevented) return;
      if (e.key === " " && e.target.closest?.("button,[role=button],a")) return; // a focused control handles its own space press
      const map = { ArrowLeft: "prev", ArrowRight: "next", Home: "start", End: "end", " ": "play", k: "key", K: "key", "[": "mprev", "]": "mnext", f: "flip", F: "flip" };
      if (map[e.key]) { e.preventDefault(); this.act(map[e.key]); }
    });
  }

  act(a) {
    if (!this.game) return;
    const n = this.pos.length - 1;
    if (a === "play") return this.timer ? this.stop() : this.play();
    if (a === "speed") { this.speedIx = (this.speedIx + 1) % this.speeds.length; this.setSpeedLabel(); if (this.timer) { this.stop(); this.play(); } return; }
    if (a === "flip") { this.flipped = !this.flipped; this.orient(); return; }
    this.stop();
    if (a === "start") this.go(0);
    if (a === "end") this.go(n);
    if (a === "prev") this.go(this.p - 1);
    if (a === "next") this.go(this.p + 1);
    if (a === "key") this.go(this.keyPos);
    if (a === "mnext" || a === "mprev") {
      const ps = this.moments.map((m) => m.p);
      const t = a === "mnext" ? ps.find((x) => x > this.p) : [...ps].reverse().find((x) => x < this.p);
      if (t != null) this.go(t);
    }
  }
  orient() {
    const side = this.flipped ? (this.me === "white" ? "black" : "white") : this.me;
    this.cg.set({ orientation: side });
    this.root.classList.toggle("flipped", this.flipped);
    // clock plates follow the board: the side at the bottom of the board gets the bottom plate
    this.topSide = side === "white" ? "black" : "white";
    this.botSide = side;
    const g = this.game, who = (c) => c === this.me ? `${HANDLES[g.plat] || "Him"} (${g.me})` : `${g.opp}${g.opp_berserk ? " · berserked" : ""}`;
    this.$("clk-top").querySelector(".who").textContent = who(this.topSide);
    this.$("clk-bot").querySelector(".who").textContent = who(this.botSide);
    this.$("clk-top").classList.toggle("me", this.topSide === this.me);
    this.$("clk-bot").classList.toggle("me", this.botSide === this.me);
    const fb = this.root.querySelector('[data-act="flip"]'); if (fb) fb.setAttribute("aria-pressed", String(this.flipped));
    this.go(this.p, true);
  }
  setSpeedLabel() { const b = this.root.querySelector('[data-act="speed"]'); if (b) { const v = this.speeds[this.speedIx]; b.textContent = `${v}×`; b.setAttribute("aria-label", `Playback speed ${v}×, press to change`); } }
  play() {
    if (this.p >= this.pos.length - 1) this.go(0);
    this.setPlayIcon(true);
    this.$("ti-move").setAttribute("aria-live", "off");
    const step = () => {
      if (this.p >= this.pos.length - 1) return this.stop();
      this.go(this.p + 1);
      const base = 650 / this.speeds[this.speedIx];
      // linger on the key moment and on brilliancies so they register
      const hold = this.p === this.keyPos || this.brilPlies.has(this.p - 1) ? 1600 / Math.sqrt(this.speeds[this.speedIx]) : 0;
      this.timer = setTimeout(step, base + hold);
    };
    this.timer = setTimeout(step, 120);
  }
  stop() { clearTimeout(this.timer); this.timer = null; this.setPlayIcon(false); this.$("ti-move")?.setAttribute("aria-live", "polite"); }
  setPlayIcon(on) { const b = this.root.querySelector('[data-act="play"]'); b.textContent = on ? "⏸" : "▶"; b.setAttribute("aria-label", on ? "Pause" : "Play"); }

  load(g, { at = "key" } = {}) {
    this.stop();
    this.game = g;
    this.pos = buildPositions(g.san);
    const n = this.pos.length - 1;
    this.keyPos = Math.min(n, g.key_ply != null ? g.key_ply + 1 : n);
    this.me = g.color === "Black" ? "black" : "white";
    this.base = baseSeconds(g.tc);
    this.scrub.max = n;
    // eval in centipawns from HIS side, per position (index p = after p plies)
    this.evMe = g.ev && g.ev.length ? [null, ...g.ev.map((v) => (v == null ? null : this.me === "white" ? v : -v))] : null;
    this.brilPlies = brilliantPlies(g);
    this.swings = this.computeSwings();
    this.flipped = false;
    this.topSide = this.me === "white" ? "black" : "white"; this.botSide = this.me;
    this.moments = this.computeMoments();
    this.renderMoves();
    this.renderGraphs();
    this.renderMoments();
    this.$("evalbar").classList.toggle("na", !this.evMe);
    this.orient();
    this.go(at === "key" ? this.keyPos : at === "start" ? 0 : n, true);
  }

  /** Eval change caused by each ply, from his side (centipawns, clamped so mates read as ±10). Only stored evals are used. */
  computeSwings() {
    const out = new Map();
    if (!this.evMe) return out;
    const c = (v) => Math.max(-1000, Math.min(1000, v));
    for (let p = 1; p < this.evMe.length; p++) {
      const a = p === 1 ? 20 * (this.me === "white" ? 1 : -1) : this.evMe[p - 1], b = this.evMe[p];
      if (a == null || b == null) continue;
      const d = c(b) - c(a);
      if (Math.abs(d) >= 200) out.set(p, { d, from: a, to: b, byHim: (p % 2 === 1) === (this.me === "white") });
    }
    return out;
  }

  /** Navigable moments, all derived from the stored game: key move, brilliancies, the biggest eval swings, first time his clock hits 5s, the finish. */
  computeMoments() {
    const n = this.pos.length - 1, M = new Map();
    const add = (p, kind, label, why) => { if (p < 1 || p > n || M.has(p)) return; M.set(p, { p, kind, label, why }); };
    const mv = (p) => `${Math.ceil(p / 2)}${p % 2 ? "." : "..."}${this.pos[p].san}`;
    this.mvLabel = mv;
    add(this.keyPos, "key", `★ ${mv(this.keyPos)}`, "Key moment");
    for (const b of this.brilPlies) add(b + 1, "bril", `${mv(b + 1)}!!`, "Brilliant (Chess.com Game Review)");
    [...this.swings.values()].length && [...this.swings.entries()].sort((a, b) => Math.abs(b[1].d) - Math.abs(a[1].d)).slice(0, 3)
      .forEach(([p, s]) => add(p, s.d > 0 ? "up" : "down", `${s.d > 0 ? "▲" : "▼"} ${mv(p)}`,
        `${s.byHim ? "His move" : "Opponent's move"}: eval ${fmtEval(s.from)} → ${fmtEval(s.to)} for him (${s.d > 0 ? (s.byHim ? "a strong move" : "an opponent slip") : (s.byHim ? "his slip" : "a strong opponent move")})`));
    if (!isNaN(this.base) && this.base >= 30 && (this.game.clk || []).length) {
      for (let p = 1; p <= n; p++) { const t = this.clockAt(this.me, p); if (t != null && t <= 5) { add(p, "clock", `⏱ ${mv(p)}`, `His clock drops to ${fmtClock(t)}`); break; } }
    }
    add(n, "end", `⚑ ${mv(n)}`, "Final move");
    return [...M.values()].sort((a, b) => a.p - b.p);
  }

  renderMoments() {
    const el = this.$("moments"); if (!el) return;
    el.innerHTML = `<span class="mo-l">Jump to</span>` + this.moments.map((m) => `<button type="button" class="mo mo-${m.kind}" data-p="${m.p}" title="${m.why}" aria-label="${m.why}, move ${m.label.replace(/^[^\d]+/, "")}">${m.label}</button>`).join("");
  }

  /** One-line readout for the graph hover tooltip. */
  readout(p, what) {
    const s = this.pos[p], mv = s.san ? `${Math.ceil(p / 2)}${p % 2 ? "." : "..."} ${s.san}` : "Start";
    if (what === "eval") { const cp = this.evMe ? (p === 0 ? null : this.evMe[p]) : null; return `${mv} · ${cp == null ? "–" : fmtEval(cp)}`; }
    return `${mv} · him ${fmtClock(this.clockAt(this.me, p))} · opp ${fmtClock(this.clockAt(this.me === "white" ? "black" : "white", p))}`;
  }

  clockAt(side, p) {
    const g = this.game, clk = g.clk || [];
    const parity = side === "white" ? 0 : 1;
    for (let i = Math.min(p, clk.length) - 1; i >= 0; i--) if (i % 2 === parity && clk[i] != null) return clk[i];
    if (isNaN(this.base)) return null;
    const oppSide = this.me === "white" ? "black" : "white";
    return side === oppSide && g.opp_berserk ? this.base / 2 : this.base;
  }

  go(p, instant = false) {
    const n = this.pos.length - 1;
    p = Math.max(0, Math.min(n, p));
    this.p = p;
    const s = this.pos[p];
    this.cg.set({ fen: s.fen, lastMove: s.lastMove, turnColor: s.turn, check: s.check ? s.turn : false, animation: { enabled: !instant } });
    // key-moment arrow
    this.cg.setAutoShapes(p === this.keyPos && s.lastMove ? [{ orig: s.lastMove[0], dest: s.lastMove[1], brush: "red" }] : []);
    this.scrub.value = p;
    // clocks
    for (const [el, side] of [[this.$("clk-top"), this.topSide], [this.$("clk-bot"), this.botSide]]) {
      const t = this.clockAt(side, p);
      el.querySelector(".time").textContent = fmtClock(t);
      el.classList.toggle("active", p < n && s.turn === side);
      el.classList.toggle("low", t != null && t <= 5);
    }
    // eval bar, Chess.com convention: cream = White's share, dark = Black's share.
    // His colour sits at the bottom (same as the board), and the label (size only, no White-POV sign) sits at the winning side's end.
    const bar = this.$("evalbar");
    let cp = this.evMe ? (p === 0 ? 20 * (this.me === "white" ? 1 : -1) : this.evMe[p]) : null;
    const wcp = cp == null ? null : this.me === "white" ? cp : -cp; // White's POV
    const whitePct = wcp == null ? 50 : 50 + 50 * (2 / (1 + Math.exp(-0.00368 * wcp)) - 1);
    const fill = bar.querySelector(".evalfill"), txt = bar.querySelector(".evaltxt");
    fill.style.height = whitePct + "%";
    bar.classList.toggle("white-top", this.botSide === "black"); // White's (cream) end is at the top when Black is at the bottom
    const winner = wcp == null || wcp === 0 ? null : wcp > 0 ? "white" : "black";
    txt.textContent = this.evMe ? evalSize(wcp) : "";
    fitEvalLabel(txt);
    const atBottom = winner ? winner === this.botSide : true;
    bar.classList.toggle("lbl-top", !atBottom);
    bar.classList.toggle("lbl-on-dark", winner === "black" || (!winner && this.botSide === "black"));
    bar.dataset.winner = winner || "even";
    bar.title = wcp == null ? "Engine eval" : `Engine eval: ${winner ? (winner === this.me ? "he" : "opponent") + " is better by " + evalSize(wcp) : "level"}`;
    // move label
    const mv = s.san ? `${Math.ceil(p / 2)}${p % 2 ? "." : "..."} ${s.san}` : "Start position";
    const sw = this.swings.get(p);
    const star = (p === this.keyPos ? "  ★ KEY MOMENT" : "") + (this.brilPlies.has(p - 1) ? "  !! BRILLIANT" : "") + (sw && p !== this.keyPos ? `  ${sw.d > 0 ? "▲" : "▼"} SWING` : "");
    const evs = this.evMe && p > 0 ? (Math.abs(cp) >= 1500 ? `  ·  ${cp > 0 ? "forced mate for him" : "engine sees mate against him"}` : `  ·  eval ${fmtEval(cp)} for him`) : "";
    this.$("ti-move").textContent = `${mv}${star}${evs}`;
    this.$("ti-step") && (this.$("ti-step").textContent = `${p} / ${n}`);
    this.$("moments")?.querySelectorAll(".mo").forEach((b) => b.classList.toggle("on", +b.dataset.p === p));
    // move list
    this.$("movelist").querySelectorAll("button.cur").forEach((b) => b.classList.remove("cur"));
    const cur = this.$("movelist").querySelector(`button[data-p="${p}"]`);
    if (cur) { cur.classList.add("cur"); const ml = this.$("movelist"); const top = cur.offsetTop - ml.offsetTop; if (top < ml.scrollTop || top > ml.scrollTop + ml.clientHeight - 24) ml.scrollTop = top - 40; }
    // graph cursors
    for (const id of ["g-eval", "g-clk"]) { const c = this.$(id).querySelector(".cur"); if (c) { const x = (p / Math.max(1, n)) * 600; c.setAttribute("x1", x); c.setAttribute("x2", x); } }
  }

  renderMoves() {
    const ml = this.$("movelist");
    const parts = [];
    for (let p = 1; p < this.pos.length; p++) {
      const num = p % 2 ? `<span class="n">${(p + 1) / 2}.</span>` : "";
      const bril = this.brilPlies.has(p - 1) ? "!!" : "";
      const sw = this.swings.get(p);
      const swc = sw ? (sw.d > 0 ? " sw-up" : " sw-dn") : "";
      const swt = sw ? ` title="${sw.byHim ? "His move" : "Opponent's move"}: eval ${fmtEval(sw.from)} → ${fmtEval(sw.to)} for him"` : "";
      parts.push(`${p % 2 ? "<li>" + num : ""}<button type="button" data-p="${p}" class="${p === this.keyPos ? "key" : ""}${bril ? " bril" : ""}${swc}"${swt}>${this.pos[p].san}${bril}</button>${p % 2 === 0 || p === this.pos.length - 1 ? "</li>" : ""}`);
    }
    ml.innerHTML = parts.join("");
  }

  renderGraphs() {
    const n = Math.max(1, this.pos.length - 1), W = 600, H = 90;
    const X = (i) => (i / n) * W;
    const keyX = X(this.keyPos);
    const keyMark = `<line x1="${keyX}" x2="${keyX}" y1="0" y2="${H}" stroke="#ffd23f" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
    const ticks = (this.moments || []).filter((m) => m.kind === "up" || m.kind === "down" || m.kind === "bril").map((m) => `<line x1="${X(m.p)}" x2="${X(m.p)}" y1="0" y2="8" stroke="${m.kind === "down" ? "#ff3b2f" : "#3fd0c9"}" stroke-width="3" vector-effect="non-scaling-stroke"/>`).join("");
    const cursor = `<line class="cur" x1="0" x2="0" y1="0" y2="${H}" stroke="#f4ead6" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
    // eval
    const ge = this.$("g-eval");
    if (this.evMe) {
      const Y = (cp) => H / 2 - (Math.max(-800, Math.min(800, cp ?? 0)) / 800) * (H / 2 - 4);
      let d = `M0 ${H / 2}`;
      this.evMe.forEach((v, i) => { d += ` L${X(i).toFixed(1)} ${Y(i === 0 ? 20 * (this.me === "white" ? 1 : -1) : v).toFixed(1)}`; });
      const area = `${d} L${W} ${H / 2} Z`;
      ge.innerHTML = `<defs><clipPath id="cpTop"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath><clipPath id="cpBot"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath></defs>
        <path d="${area}" fill="#ff3b2f" opacity=".75" clip-path="url(#cpTop)"/><path d="${area}" fill="#3a3f4d" clip-path="url(#cpBot)"/>
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#555" vector-effect="non-scaling-stroke"/>${keyMark}${ticks}${cursor}`;
      ge.parentElement.style.display = "";
    } else {
      ge.parentElement.style.display = "none";
    }
    // clocks
    const gc = this.$("g-clk"), clk = this.game.clk || [];
    if (clk.length && !isNaN(this.base)) {
      const top = this.base;
      const Y = (s) => H - 3 - (Math.max(0, Math.min(top, s)) / top) * (H - 8);
      const line = (side) => {
        let d = "";
        for (let p = 0; p <= n; p++) { const t = this.clockAt(side, p); if (t != null) d += `${d ? " L" : "M"}${X(p).toFixed(1)} ${Y(t).toFixed(1)}`; }
        return d;
      };
      const opp = this.me === "white" ? "black" : "white";
      gc.innerHTML = `<line x1="0" x2="${W}" y1="${Y(10)}" y2="${Y(10)}" stroke="#ff3b2f" stroke-dasharray="3 4" opacity=".5" vector-effect="non-scaling-stroke"/>
        <path d="${line(opp)}" fill="none" stroke="#3fd0c9" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
        <path d="${line(this.me)}" fill="none" stroke="#ff3b2f" stroke-width="3" vector-effect="non-scaling-stroke"/>${keyMark}${cursor}`;
      gc.parentElement.style.display = "";
    } else gc.parentElement.style.display = "none";
  }
}
