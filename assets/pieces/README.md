# Piece images

Drop your piece set here, one file per piece:

```
wK wQ wR wB wN wP   (white)
bK bQ bR bB bN bP   (black)
```

e.g. `wK.svg`, `bN.svg` (PNG works too). Then add it to `pieceSets` in `js/config.js`; it shows up in the Design tab:

```js
{ id: 'my-set', name: 'My set', path: 'assets/pieces/{piece}.svg' },
```

The bundled designs live in `assets/themes/` and follow the same naming.

Images should be square with a transparent background. Missing files fall back to the built-in Unicode pieces.
