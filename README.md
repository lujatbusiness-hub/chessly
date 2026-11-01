# Chessly

A small, dependency-free browser app for practicing chess openings and solving tactics puzzles.

## Run

Open `index.html` in a browser (double-click is enough, no server or build step needed).

## On your phone

The layout adapts to phone screens (portrait and landscape), and the board works with tap-to-move and drag on
touch screens. Chessly is also a Progressive Web App: served over `https://` it can be installed to the home screen
and then works offline, including Stockfish (`manifest.webmanifest`, `sw.js`, `js/pwa.js`, icons in `assets/icons/`).

- **Quick test on the home Wi-Fi** (no install, no offline): on the Mac run `python3 -m http.server 8000` in this
  folder, then open `http://<Mac IP>:8000` in Chrome on the phone (find the IP with `ipconfig getifaddr en0`).
- **Install as an app**: put the folder on any static HTTPS host (e.g. GitHub Pages, Netlify, Cloudflare Pages), open
  the URL in Chrome on the phone and choose ⋮ → *Install app* / *Add to Home screen*.

Updates: the service worker serves the cached version first and fetches the new one in the background, so a change
shows up on the second start. Bump `VERSION` in `sw.js` to clear the cache completely, and add new core files to its
`PRECACHE` list. Settings, ratings and your own openings live in the browser's localStorage, so the phone keeps its own
copy, separate from the computer.

## Modes

- **Training** works in rounds. Clicking the Training tab starts one with the selected opening, line and color
  ("All lines" picks the line you have practiced least). **Moves to train** sets how deep you go: the first
  3, 5, 8, 10 or 15 moves of each line, or the full line. Lines that are identical at that depth are trained once,
  and progress (★) is tracked per depth. Each round has three steps:
  1. **Watch**: the line is played move by move (pause, step, or click a move). Future moves stay hidden.
  2. **Test**: play your moves from memory while the app plays the opponent. No solutions: wrong moves are
     taken back and counted, **Hint** first highlights the piece, then also its target square.
  3. **Result**: perfect or not, with **Retry test**, **Watch again** and **Next line**.

  During Watch and Test the other tabs and the opening library are locked; **End round** leaves early.
  After a round (or via End round) you are back in the lobby to pick another opening, line or color.
- **Explorer**: step through the opening tree (← → Home End). Branch points show all continuations.
  The explorer follows the same move depth as training.
- **Puzzles**: 4,800 tactics puzzles from the [Lichess puzzle database](https://database.lichess.org/#puzzles)
  (CC0). The opponent plays the first move, then you find the best move for your side; the opponent's replies are
  played for you, and any mating move counts as correct. Puzzles are picked near your puzzle rating, adjusted by
  **Difficulty** (Easiest −600 … Hardest +600), and can be limited to a **Theme** (mate in 2, fork, pin, endgames …).
  Puzzles you have seen don't come up again until you have been through the others. **Hint** highlights the piece,
  then its target square; **Show solution** plays the rest; **Retry** replays a puzzle for practice; **Play on vs
  Stockfish** continues the final position as a game; the puzzle number links to the puzzle on Lichess. The puzzle
  rating and themes are shown once the puzzle is solved.
- **Free play**: play both sides on one board, or against **Stockfish**. Pick the strength from 1 (*Beginner*, ≈ 800)
  to 10 (*Maximum*, full engine strength) and your color (White, Black or Random). Changing the opponent or color starts a new
  game; the strength applies from Stockfish's next move. **Undo** takes back your move and Stockfish's reply. Use
  **Save as line** to turn a game into your own opening. **Play from here vs Stockfish** (Explorer) and **Play on vs
  Stockfish** (after a training round) continue an opening position as a game. The ratings are rough guides: levels 1–3
  limit Stockfish's skill and search depth, levels 4–9 use its built-in rating limiter.
- **Elo ratings**: three separate ratings, shown in the top bar (a `?` means provisional, fewer than 20 rated results).
  - *Training rating*: the first test of every training round counts as a game against the line. The line rating grows
    with the moves you play from memory (600 + 70 per move, 400–2600); a perfect run scores 100 %, every mistake costs
    25 % and every hint 15 %. Retries right after are practice and not rated. Shown in the training lobby and result.
  - *Game rating*: every finished game against Stockfish (win 1, draw ½, loss 0) against the level's rating
    (≈ 800 … 3000). **Resign** counts as a loss; a game with an **Undo** or a strength change during play is not rated,
    and abandoned games (New game, reload) don't count. Shown in the Free play Opponent card.
  - *Puzzle rating*: the first attempt at every puzzle counts as a game against the puzzle's Lichess rating. Solved
    without help scores 1, solved with hints ½; the first wrong move, **Show solution** or skipping a puzzle you
    already started scores 0. Retries are not rated. Shown in the Puzzles card.

  Both start at 1200 and use the Elo formula with K = 40 for the first 20 results, then K = 20. **Reset** sets a rating
  back to 1200.
- **Design**: pick the board and the pieces separately (*Classic*, *Frostreich*, *Arkane Nacht*, *Aluminium*,
  *Ebenholz & Messing*, *Facette*, *Obsidian & Gold*, *Schiefer & Kupfer*, *Schwarzer Marmor*,
  *Mondstein*, *Neon-Raster*, *Ochsenblut-Leder*, *Terrazzo-Nacht*, *Tinte & Zinnober*, *Bulle & Bär*,
  *Hologramm*, *Orbitalstation*, *Platine*, *Rohstoffe*, *Ticker-Terminal*, *Inlay*, *Stainless Steel*,
  *Concrete*, *3D Print*, *Origami*, *Crystal*, *Evolution*, *Nature vs Technology*, *Glibber-Bande*,
  *Turnier-Klassik*, *Turnier-Klassik Nacht*). The board also sets
  the app colors; a sample position shows the combination. Your choice is remembered.
  Piece sets: *Classic*, *Frostreich*, *Arkane Nacht*, *Aluminium*, *Facette*, *Obsidian & Gold*, *Mondstein*,
  *Neon-Raster*, *Bulle & Bär*, *Orbitalstation*,
  *Rohstoffe*, *Inlay*, *Stainless Steel*, *Concrete*, *3D Print*, *Origami*, *Crystal*, *Evolution*,
  *Nature vs Technology*, *Glibber-Bande*, *Turnier-Klassik* (sets that only differed in color were merged). **Piece colors** recolors white and black
  separately with a preset or any custom color while keeping each set's shading; ↺ / **Reset** restores the
  set's own colors.
  **Animation** picks how pieces move: *Off*, *Slide*, *Snap*, *Hop*, *Blink*, or one with a trail: *Comet*
  (afterimages), *Light trail* (glowing streak) and *Sparks*. Trails use the board's arrow color. Choose a speed
  (Slow / Normal / Fast) and press **Preview** (`P`) to watch a sample move.

- **Sounds** (Design tab): pick a sound pack: *Off*, *Wood*, *Felt*, *Marble*, *Crystal*, *8-bit* or *Sci-fi*.
  Moves, captures, castling, promotions and checks each sound different, and the trainer adds sounds for wrong
  moves, hints, a finished line and a perfect run. Set the volume with the slider; **Preview** plays a sample.
  All sounds are synthesized in the browser (Web Audio API), so there are no audio files.

Shortcuts: `F` flips the board, `O` toggles the opening library, `M` turns sounds off and on. Training: `Enter` starts a round / the test,
`Space` pauses the demo, `← →` step through it, `H` gives a hint, `R` retries and `N` picks the next line.
Puzzles: `H` gives a hint, `N` skips / goes to the next puzzle (also `Enter` when solved), `R` retries.

## Your own openings

Use **+ New line** (paste SAN or PGN, e.g. `1. e4 c5 2. Nf3 d6`) or **Save as line** in Free play.
They are stored in the browser's localStorage. Built-in openings live in `js/openings.js`.

## Customizing the design

- `css/theme.css`: all colors, fonts, board colors and highlights (CSS variables). Each board overrides
  them in a `[data-board='<id>']` block, each piece set its colors in a `[data-pieces='<id>']` block.
- `js/config.js`: the boards (`boards`: id, name), the piece sets (`pieceSets`: id, name, image path), the piece color swatches (`pieceColorPresets`)
  and trainer timings. `retiredPieceSets` maps removed duplicate sets to the remaining set plus their old colors.
  `moveAnimation` is the base duration of a move animation (ms, `0` turns animations off) and `defaultAnimation`
  the style used until one is picked; animations are also skipped when the system asks for reduced motion.
- `js/sound.js`: the sound packs (`PACKS`). Each pack has a `hit` (a piece landing) and a `timbre` for the short
  melodies, and can override any event (`move`, `capture`, `castle`, `promote`, `check`, `wrong`, `hint`,
  `complete`, `perfect`).
- `assets/themes/<id>/`: piece images (`pieces/wK.svg` … `bP.svg`) and the reference board SVGs of a design.

To add a design: put its pieces in `assets/themes/<id>/pieces/` and add an entry to `pieceSets`; add an entry
to `boards` and a `[data-board='<id>']` block in `css/theme.css` (optionally a `[data-pieces='<id>']` block for the
turn indicator colors). Boards and piece sets are independent, so either one can be added on its own.

Textured boards can use their artwork directly: set `--board-image: url('../assets/themes/<id>/board.svg')`
and `--sq-light-fill` / `--sq-dark-fill` to `transparent` (see the `aluminium` block). The image must be a plain
8×8 board with a light square at a8. `--coord-on-light` / `--coord-on-dark` set the coordinate colors.

## Structure

```
index.html
manifest.webmanifest  app manifest (name, icons, colors) for installing on a phone
sw.js             service worker: offline cache
css/theme.css     design tokens, board and piece set overrides
css/style.css     layout and components
js/chess.js       rules engine (legal moves, check/mate, castling, en passant, promotion, draws, SAN)
js/sound.js       sound packs (Web Audio synthesis)
js/engine.js      Stockfish opponent (loads the engine, difficulty levels, UCI)
vendor/stockfish/ Stockfish.js 19 (ASM-JS build, GPLv3), see its README
js/rating.js      Elo ratings (training rating from line tests, game rating from Stockfish games, puzzle rating)
js/puzzles.js     puzzle helpers (loading, picking by rating and theme, scoring)
js/puzzles-data.js  the puzzle set (generated, loaded when the Puzzles tab is opened)
tools/build_puzzles.py  builds js/puzzles-data.js from the Lichess puzzle database
js/board.js       board view (drag & drop, click-to-move, arrows, promotion picker)
js/openings.js    built-in openings
js/app.js         trainer, explorer, free play, custom openings
js/pwa.js         registers the service worker (only over http/https)
assets/themes/    piece sets and board artwork per design
assets/icons/     app icons (home screen)
tests/            engine, rating and puzzle tests
```

## Tests

```sh
node tests/test-engine.js
node tests/test-rating.js
node tests/test-puzzles.js
```

Checks move generation against known perft counts, core rules, and that every built-in opening line is legal, and the
Elo math of both ratings.

## Puzzle set

`js/puzzles-data.js` is a sample of the [Lichess puzzle database](https://database.lichess.org/#puzzles) (CC0, several
million puzzles, ≈ 300 MB compressed). `tools/build_puzzles.py` keeps only well-tested, popular puzzles (rating
deviation ≤ 90, popularity ≥ 85, ≥ 300 plays) and takes 200 at random from every 100-point rating band (500 … 2800+),
≈ 520 KB. To rebuild it, for example with more puzzles:

```sh
curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
pip install zstandard            # or: zstd -dc lichess_db_puzzle.csv.zst | python3 tools/build_puzzles.py -
python3 tools/build_puzzles.py lichess_db_puzzle.csv.zst --per-band 300
node tests/test-puzzles.js       # checks that every puzzle replays legally
```

## Stockfish

The engine is [Stockfish.js](https://github.com/nmrugg/stockfish.js) 19, a JavaScript build of
[Stockfish](https://stockfishchess.org). It is loaded only when you choose Stockfish as the opponent (≈ 3 MB) and runs in
a Web Worker, so it also works when `index.html` is opened from disk. Stockfish is licensed under the GNU GPL v3
(`vendor/stockfish/Copying.txt`); if you distribute Chessly with it, the GPL applies to that distribution.
The difficulty levels are defined in `LEVELS` in `js/engine.js`.
