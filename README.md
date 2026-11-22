# CLAWBERED

2026 bullet chess highlights from Chess.com **LobsterRomeo** and Lichess **QuiteQuickly**, with flag wins, comebacks and upsets.

Live: https://dennisonromeo-commits.github.io/clawbered/

It's a static site: plain HTML/CSS/JS with no build step. Libraries and fonts are vendored in `vendor/`, and the data is pre-computed JSON in `data/`.

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

- `index.html`, `css/style.css`: layout and the "Maison Lobster" theme
- `js/app.js`: data loading and every section; `js/replay.js`: the replay board (chessground + chess.js)
- `js/config.js`: data path and profile links
- `img/wordmark.svg`: the CLAWBERED wordmark (Didone, claw-tipped W). `img/wordmark-plain.svg` is the same mark without claws.
- `img/mark.svg`: the monogram slot, currently the claw-tipped W (swap this file to change the mark). `img/mark-plain.svg` is the plain W.
- `img/favicon.svg`: the claw-tipped W in brass on noir.
- `vendor/chessground/chessground.chessnut.css` and `vendor/pieces/chessnut/`: Alexis Luengas' Chessnut set (Apache 2.0), recolored in ivory and espresso for every board.

Opponents are always shown as "Opponent (rating)". License: GPL-3.0 (see `LICENSE` and `NOTICE.md`).
