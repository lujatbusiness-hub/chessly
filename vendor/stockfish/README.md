# Stockfish

`stockfish.js` is [Stockfish.js](https://github.com/nmrugg/stockfish.js) 19 (ASM-JS build, `bin/stockfish-19-asm.js`
from the npm package `stockfish@19.0.1`), based on [Stockfish](https://github.com/official-stockfish/Stockfish).
It is licensed under the GNU GPL v3, see `Copying.txt`.

The original file is kept unchanged inside `window.CHESSLY_STOCKFISH = function () { … };` so `js/engine.js` can start
it as a Web Worker from a Blob URL. Browsers do not allow normal workers or `.wasm` downloads for pages opened from
disk (`file://`), and the ASM-JS build needs neither.

To update: download the newer package (`npm pack stockfish`), take `bin/stockfish-<version>-asm.js` and wrap it the
same way (keep the comment header and the function wrapper).
