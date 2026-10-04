# CLAWBERED

2026 bullet chess highlights from Chess.com **LobsterRomeo** and Lichess **QuiteQuickly**, with flag wins, comebacks and upsets.

Live: https://dennisonromeo-commits.github.io/clawbered/

It's a static site: plain HTML/CSS/JS with no build step. Libraries and fonts are vendored in `vendor/`, and the data is pre-computed JSON in `data/`.

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

- `index.html`, `css/style.css`: layout and the "Lobster Noir" theme
- `js/app.js`: data loading and every section; `js/replay.js`: the replay board (chessground + chess.js)
- `js/config.js`: data path and profile links
- `img/lobster.svg`: the mascot

Opponents are always shown as "Opponent (rating)". License: GPL-3.0 (see `LICENSE` and `NOTICE.md`).
