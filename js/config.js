/*
 * Chessly configuration — the place to plug in your own design.
 * Colors, fonts and board styling live in css/theme.css.
 */
window.CHESSLY_CONFIG = {
    // Boards (picked in the Design tab). id sets <html data-board="..."> so css/theme.css can
    // override the board, frame and app colors in a [data-board='<id>'] block.
    boards: [
        { id: 'classic', name: 'Classic' },
        { id: 'frostreich', name: 'Frostreich' },
        { id: 'arkane-nacht', name: 'Arkane Nacht' },
        { id: 'aluminium', name: 'Aluminium' },
        { id: 'ebenholz-messing', name: 'Ebenholz & Messing' },
        { id: 'facette', name: 'Facette' },
        { id: 'obsidian-gold', name: 'Obsidian & Gold' },
        { id: 'schiefer-kupfer', name: 'Schiefer & Kupfer' },
        { id: 'schwarzer-marmor', name: 'Schwarzer Marmor' },
        { id: 'mondstein', name: 'Mondstein' },
        { id: 'neon-raster', name: 'Neon-Raster' },
        { id: 'ochsenblut-leder', name: 'Ochsenblut-Leder' },
        { id: 'terrazzo-nacht', name: 'Terrazzo-Nacht' },
        { id: 'tinte-zinnober', name: 'Tinte & Zinnober' },
        { id: 'bulle-baer', name: 'Bulle & Bär' },
        { id: 'hologramm', name: 'Hologramm' },
        { id: 'orbitalstation', name: 'Orbitalstation' },
        { id: 'platine', name: 'Platine' },
        { id: 'rohstoffe', name: 'Rohstoffe' },
        { id: 'ticker-terminal', name: 'Ticker-Terminal' },
        { id: 'inlay', name: 'Inlay' },
        { id: 'stainless-steel', name: 'Stainless Steel' },
        { id: 'concrete', name: 'Concrete' },
        { id: '3d-print', name: '3D Print' },
        { id: 'origami', name: 'Origami' },
        { id: 'crystal', name: 'Crystal' },
        { id: 'evolution', name: 'Evolution' },
        { id: 'nature-tech', name: 'Nature vs Technology' },
        { id: 'glibber-bande', name: 'Glibber-Bande' },
        { id: 'turnier-klassik', name: 'Turnier-Klassik' },
        { id: 'turnier-klassik-nacht', name: 'Turnier-Klassik Nacht' },
    ],

    // Piece sets (picked separately in the Design tab). id sets <html data-pieces="...">.
    //   path  template for the piece images. {piece} is replaced by the piece code:
    //         wK wQ wR wB wN wP  bK bQ bR bB bN bP
    //         Example: 'assets/pieces/{piece}.svg'  ->  assets/pieces/wK.svg, assets/pieces/bN.svg, ...
    //         null uses the built-in Unicode pieces.
    pieceSets: [
        { id: 'classic', name: 'Classic', path: null },
        { id: 'frostreich', name: 'Frostreich', path: 'assets/themes/frostreich/pieces/{piece}.svg' },
        { id: 'arkane-nacht', name: 'Arkane Nacht', path: 'assets/themes/arkane-nacht/pieces/{piece}.svg' },
        { id: 'aluminium', name: 'Aluminium', path: 'assets/themes/aluminium/pieces/{piece}.svg' },
        { id: 'facette', name: 'Facette', path: 'assets/themes/facette/pieces/{piece}.svg' },
        { id: 'obsidian-gold', name: 'Obsidian & Gold', path: 'assets/themes/obsidian-gold/pieces/{piece}.svg' },
        { id: 'mondstein', name: 'Mondstein', path: 'assets/themes/mondstein/pieces/{piece}.svg' },
        { id: 'neon-raster', name: 'Neon-Raster', path: 'assets/themes/neon-raster/pieces/{piece}.svg' },
        { id: 'bulle-baer', name: 'Bulle & Bär', path: 'assets/themes/bulle-baer/pieces/{piece}.svg' },
        { id: 'orbitalstation', name: 'Orbitalstation', path: 'assets/themes/orbitalstation/pieces/{piece}.svg' },
        { id: 'rohstoffe', name: 'Rohstoffe', path: 'assets/themes/rohstoffe/pieces/{piece}.svg' },
        { id: 'inlay', name: 'Inlay', path: 'assets/themes/inlay/pieces/{piece}.svg' },
        { id: 'stainless-steel', name: 'Stainless Steel', path: 'assets/themes/stainless-steel/pieces/{piece}.svg' },
        { id: 'concrete', name: 'Concrete', path: 'assets/themes/concrete/pieces/{piece}.svg' },
        { id: '3d-print', name: '3D Print', path: 'assets/themes/3d-print/pieces/{piece}.svg' },
        { id: 'origami', name: 'Origami', path: 'assets/themes/origami/pieces/{piece}.svg' },
        { id: 'crystal', name: 'Crystal', path: 'assets/themes/crystal/pieces/{piece}.svg' },
        { id: 'evolution', name: 'Evolution', path: 'assets/themes/evolution/pieces/{piece}.svg' },
        { id: 'nature-tech', name: 'Nature vs Technology', path: 'assets/themes/nature-tech/pieces/{piece}.svg' },
        { id: 'glibber-bande', name: 'Glibber-Bande', path: 'assets/themes/glibber-bande/pieces/{piece}.svg' },
        { id: 'turnier-klassik', name: 'Turnier-Klassik', path: 'assets/themes/turnier-klassik/pieces/{piece}.svg' },
    ],

    // Piece sets that were removed because their shapes duplicated another set (only the colors differed).
    // Saved settings move to the remaining set and keep the old look through the piece colors.
    retiredPieceSets: {
        'ebenholz-messing': { pieces: 'aluminium', w: '#cfa65e', b: '#1a120c' },
        'schiefer-kupfer': { pieces: 'facette', w: '#cf8455', b: '#2b3136' },
        'schwarzer-marmor': { pieces: 'facette', w: '#e9e6e1', b: '#26262a' },
        'ochsenblut-leder': { pieces: 'facette', w: '#e0cdae', b: '#181214' },
        'terrazzo-nacht': { pieces: 'aluminium', w: '#f7f1e4', b: '#26262c' },
        'tinte-zinnober': { pieces: 'obsidian-gold', w: '#f06045', b: '#272d3d' },
        'platine': { pieces: 'orbitalstation', w: '#e9c46a', b: '#101211' },
        'hologramm': { pieces: 'orbitalstation', w: '#7fe9ff', b: '#ffb36b' },
        'ticker-terminal': { pieces: 'bulle-baer', w: '#ffb000', b: '#d5dee7' },
    },

    // Swatches offered for the piece colors in the Design tab (any color can also be picked freely).
    pieceColorPresets: [
        { name: 'Snow', color: '#f7f8fb' },
        { name: 'Ivory', color: '#fbf4e8' },
        { name: 'Silver', color: '#c6c9ce' },
        { name: 'Gold', color: '#e6cb8c' },
        { name: 'Brass', color: '#cfa65e' },
        { name: 'Amber', color: '#ffb000' },
        { name: 'Copper', color: '#cf8455' },
        { name: 'Vermilion', color: '#ee6a50' },
        { name: 'Coral', color: '#ff5a5f' },
        { name: 'Emerald', color: '#3ddc84' },
        { name: 'Ice', color: '#9fd8ff' },
        { name: 'Cyan', color: '#5ef2ff' },
        { name: 'Lavender', color: '#b9adff' },
        { name: 'Violet', color: '#a25cff' },
        { name: 'Magenta', color: '#ff4fd8' },
        { name: 'Oxblood', color: '#6a2626' },
        { name: 'Navy', color: '#26324f' },
        { name: 'Slate', color: '#454b5e' },
        { name: 'Graphite', color: '#3a3c45' },
        { name: 'Charcoal', color: '#2a2527' },
        { name: 'Ebony', color: '#1a120c' },
    ],

    // Used until the player picks something in the Design tab.
    defaultBoard: 'classic',
    defaultPieces: 'classic',

    // Milliseconds before the trainer plays the opponent's reply.
    opponentDelay: 450,

    // Milliseconds a wrong move stays on the board before it is taken back.
    wrongMoveDelay: 700,

    // Training rounds: pause before the demo starts and between demo moves (milliseconds).
    demoStartDelay: 700,
    demoDelay: 1100,

    // Duration of the piece slide animation in milliseconds (0 turns animations off).
    // Animations are also skipped when the system asks for reduced motion.
    moveAnimation: 200,

    // Move animation used until the player picks one in the Design tab:
    // off, slide, snap, hop, blink, comet, light, sparks.
    defaultAnimation: 'slide',
};
