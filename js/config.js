/* CLAWBERED front-end config.
 * dataPaths are tried in order; the first folder that serves summary.json wins.
 *  - "data/"          -> the published copy next to index.html (GitHub Pages)
 *  - "../site/data/"  -> the pipeline's output, for local development
 * Override at runtime with ?data=some/folder/  (trailing slash optional).
 */
window.CLAWBERED_CONFIG = {
  dataPaths: ["data/", "../site/data/"],
  handles: { "Chess.com": "LobsterRomeo", "Lichess": "QuiteQuickly" },
  profiles: {
    "Chess.com": "https://www.chess.com/member/LobsterRomeo",
    "Lichess": "https://lichess.org/@/QuiteQuickly"
  }
};
