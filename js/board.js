/*
 * Chessly — interactive board view (drag & drop, click-to-move, highlights, arrows, promotion).
 * Reads its position from a Chess instance; moves are reported via options.onMove(from, to, promotion).
 */
(function (root) {
    'use strict';

    const GLYPHS = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };
    const FILES = 'abcdefgh';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const DRAG_THRESHOLD = 4;
    const MOVE_EASING = 'cubic-bezier(0.25, 0.8, 0.35, 1)';
    const SPRING_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

    // Selectable move animations (Design tab). `timing` scales the base duration; `trail` styles draw effects.
    const ANIMATION_STYLES = [
        { id: 'off', name: 'Off', description: 'Pieces jump to their square instantly.', timing: 0 },
        { id: 'slide', name: 'Slide', description: 'A calm, smooth glide.', timing: 1 },
        { id: 'snap', name: 'Snap', description: 'A quick move that springs into place.', timing: 1.15 },
        { id: 'hop', name: 'Hop', description: 'The piece is lifted in an arc and set down.', timing: 1.45 },
        { id: 'blink', name: 'Blink', description: 'The piece fades out and pops up on its new square.', timing: 1.1 },
        { id: 'comet', name: 'Comet', description: 'Afterimages follow the piece like a comet tail.', timing: 1.3, trail: true },
        { id: 'light', name: 'Light trail', description: 'A glowing streak traces the move.', timing: 1.3, trail: true },
        { id: 'sparks', name: 'Sparks', description: 'Sparks scatter along the path.', timing: 1.35, trail: true },
    ];
    const ANIMATION_SPEEDS = { slow: 1.7, normal: 1, fast: 0.6 };

    function createPieceElement(piece, pieceSet) {
        const el = document.createElement('div');
        el.className = `piece piece-${piece[0]}`;
        el.dataset.piece = piece;
        if (pieceSet) {
            const img = document.createElement('img');
            img.src = pieceSet.replace('{piece}', piece);
            img.alt = piece;
            img.draggable = false;
            img.addEventListener('error', () => {
                img.remove();
                el.textContent = GLYPHS[piece[1]];
            }, { once: true });
            el.appendChild(img);
        } else {
            el.textContent = GLYPHS[piece[1]];
        }
        return el;
    }

    function svg(tag, attrs) {
        const node = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        return node;
    }

    class BoardView {
        constructor(container, options = {}) {
            this.container = container;
            this.onMove = options.onMove || (() => {});
            this.canMove = options.canMove || (() => true);
            // Called with the move record whenever the drawn position advances by exactly one move (used for sounds).
            this.onMoveShown = options.onMoveShown || null;
            this.game = null;
            this.pieceSet = options.pieceSet || null;
            this.orientation = 'w';
            this.selected = null;
            this.targets = [];
            this.marks = new Map();
            this.arrows = [];
            this.drag = null;
            this.promotionPending = false;

            // Move animation: pieces slide between squares, captured pieces fade.
            this.animationMs = options.animationMs === undefined ? 200 : options.animationMs;
            this.animationStyle = 'slide';
            this.animationSpeed = 'normal';
            this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
            this.shownMoves = null; // SAN history of the position currently drawn (null = draw without animation)
            this.shownLast = null;
            this.dropped = null; // last drag & drop move: that piece is already where it belongs

            container.classList.add('board');
            this.grid = document.createElement('div');
            this.grid.className = 'board-grid';
            this.arrowLayer = svg('svg', { class: 'board-arrows', viewBox: '0 0 8 8' });
            const defs = svg('defs', {});
            const marker = svg('marker', {
                id: 'chessly-arrowhead', viewBox: '0 0 4 4', refX: '0', refY: '2',
                markerWidth: '3', markerHeight: '3', orient: 'auto',
            });
            marker.appendChild(svg('path', { d: 'M0,0 L4,2 L0,4 z', class: 'arrow-head' }));
            defs.appendChild(marker);
            this.arrowLayer.appendChild(defs);
            this.promoLayer = document.createElement('div');
            this.promoLayer.className = 'promo-layer hidden';
            this.fxLayer = document.createElement('div');
            this.fxLayer.className = 'board-fx';
            container.append(this.grid, this.fxLayer, this.arrowLayer, this.promoLayer);
            this.buildSquares();

            this.grid.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
            window.addEventListener('pointermove', (e) => this.handlePointerMove(e));
            window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
            window.addEventListener('pointercancel', () => this.endDrag());
            this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        buildSquares() {
            this.shownMoves = null;
            if (this.fxLayer) this.fxLayer.innerHTML = '';
            this.grid.innerHTML = '';
            this.squares = new Array(64);
            this.pieceEls = new Array(64).fill(null);
            for (let i = 0; i < 64; i++) {
                const sq = this.orientation === 'w' ? i : 63 - i;
                const r = sq >> 3;
                const c = sq & 7;
                const el = document.createElement('div');
                el.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
                if ((i & 7) === 0) el.insertAdjacentHTML('beforeend', `<span class="coord coord-rank">${8 - r}</span>`);
                if (i >> 3 === 7) el.insertAdjacentHTML('beforeend', `<span class="coord coord-file">${FILES[c]}</span>`);
                this.grid.appendChild(el);
                this.squares[sq] = el;
            }
        }

        setGame(game) {
            this.game = game;
            this.shownMoves = null;
            this.clearSelection();
        }

        setOrientation(color) {
            if (color === this.orientation) return;
            this.orientation = color;
            this.buildSquares();
        }

        setPieceSet(pieceSet) {
            pieceSet = pieceSet || null;
            if (pieceSet === this.pieceSet) return;
            this.pieceSet = pieceSet;
            // Drop the current piece elements so render() recreates them with the new images.
            this.pieceEls.forEach((el) => el && el.remove());
            this.pieceEls.fill(null);
            this.shownMoves = null;
            this.render();
        }

        setAnimation(style, speed) {
            if (ANIMATION_STYLES.some((s) => s.id === style)) this.animationStyle = style;
            if (ANIMATION_SPEEDS[speed]) this.animationSpeed = speed;
        }

        // Duration of one move animation in ms (0 = no animation).
        moveDuration() {
            if (!this.animationMs || this.reducedMotion.matches) return 0;
            const style = ANIMATION_STYLES.find((s) => s.id === this.animationStyle);
            return Math.round(this.animationMs * style.timing * ANIMATION_SPEEDS[this.animationSpeed]);
        }

        clearSelection() {
            this.selected = null;
            this.targets = [];
        }

        select(sq) {
            this.selected = sq;
            this.targets = this.game.legalMoves(sq);
            this.render();
        }

        render() {
            const game = this.game;
            if (!game) return;
            const history = game.history();
            const last = history[history.length - 1];
            const checkSq = game.inCheck() ? game.kingSquare(game.turn) : -1;
            const targets = new Map(this.targets.map((m) => [m.to, m]));
            const motion = this.detectMotion(history);
            const previous = this.shownMoves;
            if (this.onMoveShown && previous && history.length === previous.length + 1
                && previous.every((san, i) => history[i].san === san)) this.onMoveShown(last);
            this.shownMoves = history.map((record) => record.san);
            this.shownLast = last || null;

            for (let sq = 0; sq < 64; sq++) {
                const el = this.squares[sq];
                const piece = game.board[sq];
                const current = this.pieceEls[sq];
                if ((current ? current.dataset.piece : null) !== piece) {
                    if (current) {
                        // A captured (or otherwise vanished) piece fades out; the moving piece's old element just goes.
                        if (motion && !motion.sources.has(sq)) this.fade(current, false);
                        else current.remove();
                    }
                    this.pieceEls[sq] = piece ? el.appendChild(createPieceElement(piece, this.pieceSet)) : null;
                    if (piece && motion) {
                        if (motion.slides.has(sq)) this.slide(this.pieceEls[sq], motion.slides.get(sq), sq);
                        else if (!motion.placed.has(sq)) this.fade(this.pieceEls[sq], true);
                    }
                }
                const target = targets.get(sq);
                el.classList.toggle('last-move', !!last && (last.from === sq || last.to === sq));
                el.classList.toggle('selected', this.selected === sq);
                el.classList.toggle('target', !!target);
                el.classList.toggle('capture', !!target && (!!piece || target.flag === 'e'));
                el.classList.toggle('check', sq === checkSq);
                el.dataset.mark = this.marks.get(sq) || '';
            }
            this.renderArrows();
        }

        // Animates only single steps: one move forward, or one move taken back.
        // Returns { slides: Map(toSq -> fromSq), sources: Set(fromSq), placed: Set(toSq) } or null.
        detectMotion(history) {
            const previous = this.shownMoves;
            if (!previous || !this.moveDuration()) return null;
            const count = history.length;
            const samePrefix = (length) => history.slice(0, length).every((record, i) => record.san === previous[i]);
            let move;
            let backwards = false;
            if (count === previous.length + 1 && samePrefix(previous.length)) move = history[count - 1];
            else if (count === previous.length - 1 && this.shownLast && samePrefix(count)) {
                move = this.shownLast;
                backwards = true;
            } else return null;

            const pairs = [[move.from, move.to]];
            if (move.flag === 'k') pairs.push([move.to + 1, move.to - 1]);
            if (move.flag === 'q') pairs.push([move.to - 2, move.to + 1]);
            const dropped = this.dropped;
            this.dropped = null;
            const slides = new Map();
            const sources = new Set();
            const placed = new Set();
            for (const [a, b] of pairs) {
                const [from, to] = backwards ? [b, a] : [a, b];
                sources.add(from);
                if (!backwards && dropped && dropped.from === from && dropped.to === to) placed.add(to);
                else slides.set(to, from);
            }
            return { slides, sources, placed };
        }

        // Moves `el` (already on toSq) visually from fromSq to toSq in the selected style.
        slide(el, fromSq, toSq) {
            const duration = this.moveDuration();
            const style = this.animationStyle;
            const [fx, fy] = this.center(fromSq);
            const [tx, ty] = this.center(toSq);
            const dx = (fx - tx) * 100; // offsets in % of a square (= the piece element)
            const dy = (fy - ty) * 100;
            const distance = Math.hypot(fx - tx, fy - ty);
            let keyframes = [{ transform: `translate(${dx}%, ${dy}%)` }, { transform: 'translate(0, 0)' }];
            let easing = MOVE_EASING;

            if (style === 'snap') easing = SPRING_EASING;
            if (style === 'hop') {
                // Sampled parabola: lifted and slightly enlarged at the top, with a growing shadow.
                const lift = Math.min(70, 30 + distance * 12);
                keyframes = Array.from({ length: 11 }, (_, i) => {
                    const t = i / 10;
                    const arc = 4 * t * (1 - t);
                    return {
                        transform: `translate(${dx * (1 - t)}%, ${dy * (1 - t) - lift * arc}%) scale(${1 + 0.18 * arc})`,
                        filter: `drop-shadow(0 ${(1.6 * arc).toFixed(2)}cqw ${(1.2 * arc).toFixed(2)}cqw rgba(0, 0, 0, ${(0.45 * arc).toFixed(2)}))`,
                    };
                });
                easing = 'ease-in-out';
            }
            if (style === 'blink') {
                keyframes = [
                    { opacity: 0, transform: 'scale(0.4)' },
                    { opacity: 1, transform: 'scale(1.12)', offset: 0.7 },
                    { opacity: 1, transform: 'scale(1)' },
                ];
                easing = 'ease-out';
                this.fxGhost(el, fromSq, [
                    { opacity: 1, transform: 'scale(1)' },
                    { opacity: 0, transform: 'scale(0.3)' },
                ], { duration: duration * 0.6, easing: 'ease-in' });
            }

            el.classList.add('moving');
            const animation = el.animate(keyframes, { duration, easing });
            animation.onfinish = animation.oncancel = () => el.classList.remove('moving');

            if (style === 'comet') this.fxComet(el, toSq, dx, dy, duration);
            if (style === 'light') this.fxLight(fromSq, toSq, duration);
            if (style === 'sparks') this.fxSparks(fromSq, toSq, duration);
        }

        fade(el, fadeIn) {
            const animation = el.animate([{ opacity: fadeIn ? 0 : 1 }, { opacity: fadeIn ? 1 : 0 }], {
                duration: this.moveDuration(),
                easing: 'ease-out',
            });
            if (!fadeIn) animation.onfinish = animation.oncancel = () => el.remove();
        }

        // --- Trail effects. They live in .board-fx above the pieces and remove themselves when done.

        squareBox(sq) {
            const [c, r] = this.center(sq);
            return { left: (c - 0.5) * 12.5, top: (r - 0.5) * 12.5 };
        }

        fxGhost(pieceEl, sq, keyframes, timing) {
            const ghost = pieceEl.cloneNode(true);
            const box = this.squareBox(sq);
            ghost.className = `${pieceEl.className.replace(/\bmoving\b/, '')} fx-ghost`;
            Object.assign(ghost.style, { left: `${box.left}%`, top: `${box.top}%` });
            this.fxLayer.appendChild(ghost);
            const animation = ghost.animate(keyframes, Object.assign({ fill: 'backwards' }, timing));
            animation.onfinish = animation.oncancel = () => ghost.remove();
        }

        fxComet(pieceEl, toSq, dx, dy, duration) {
            const count = 6;
            for (let k = 1; k <= count; k++) {
                const opacity = 0.8 * (1 - k / (count + 1));
                this.fxGhost(pieceEl, toSq, [
                    { transform: `translate(${dx}%, ${dy}%) scale(${1 - k * 0.04})`, opacity },
                    { transform: `translate(${dx * 0.4}%, ${dy * 0.4}%) scale(${1 - k * 0.04})`, opacity: opacity * 0.8, offset: 0.55 },
                    { transform: `translate(0, 0) scale(${1 - k * 0.06})`, opacity: 0 },
                ], { duration: duration * 1.1, delay: k * duration * 0.06, easing: MOVE_EASING });
            }
        }

        fxLight(fromSq, toSq, duration) {
            const [x1, y1] = this.center(fromSq);
            const [x2, y2] = this.center(toSq);
            const streak = svg('svg', { class: 'fx-streak', viewBox: '0 0 8 8' });
            ['glow', 'core'].forEach((part) => {
                streak.appendChild(svg('line', { class: `fx-streak-${part}`, x1, y1, x2, y2, pathLength: '1' }));
            });
            this.fxLayer.appendChild(streak);
            // Draw the streak alongside the piece, then let it fade from the tail.
            streak.querySelectorAll('line').forEach((line) => {
                line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration, easing: MOVE_EASING });
            });
            const fadeOut = streak.animate([{ opacity: 1 }, { opacity: 0 }], {
                duration: duration * 0.9,
                delay: duration * 0.55,
                easing: 'ease-in',
                fill: 'forwards',
            });
            fadeOut.onfinish = fadeOut.oncancel = () => streak.remove();
        }

        fxSparks(fromSq, toSq, duration) {
            const [x1, y1] = this.center(fromSq);
            const [x2, y2] = this.center(toSq);
            const count = Math.round(8 + Math.hypot(x2 - x1, y2 - y1) * 4);
            for (let i = 0; i < count; i++) {
                const t = (i + 0.5) / count;
                const spark = document.createElement('span');
                spark.className = 'fx-spark';
                const size = 1.3 + Math.random() * 1.5;
                Object.assign(spark.style, {
                    left: `${(x1 + (x2 - x1) * t + (Math.random() - 0.5) * 0.35) * 12.5}%`,
                    top: `${(y1 + (y2 - y1) * t + (Math.random() - 0.5) * 0.35) * 12.5}%`,
                    width: `${size}cqw`,
                    height: `${size}cqw`,
                });
                this.fxLayer.appendChild(spark);
                const driftX = (Math.random() - 0.5) * 6;
                const driftY = (Math.random() - 0.2) * 6;
                // The piece eases out, so it passes fraction t of the path at roughly 1 - sqrt(1 - t) of the time.
                const animation = spark.animate([
                    { opacity: 1, transform: 'translate(-50%, -50%) scale(1.2)' },
                    { opacity: 0.9, transform: `translate(calc(-50% + ${driftX * 0.4}cqw), calc(-50% + ${driftY * 0.4}cqw)) scale(0.9)`, offset: 0.35 },
                    { opacity: 0, transform: `translate(calc(-50% + ${driftX}cqw), calc(-50% + ${driftY}cqw)) scale(0.2)` },
                ], {
                    duration: 520 + Math.random() * 420,
                    delay: duration * (1 - Math.sqrt(1 - t)) * 0.9,
                    easing: 'ease-out',
                });
                animation.onfinish = animation.oncancel = () => spark.remove();
            }
        }

        center(sq) {
            let c = sq & 7;
            let r = sq >> 3;
            if (this.orientation === 'b') {
                c = 7 - c;
                r = 7 - r;
            }
            return [c + 0.5, r + 0.5];
        }

        renderArrows() {
            this.arrowLayer.querySelectorAll('.arrow').forEach((n) => n.remove());
            for (const arrow of this.arrows) {
                const [x1, y1] = this.center(arrow.from);
                const [x2, y2] = this.center(arrow.to);
                const length = Math.hypot(x2 - x1, y2 - y1);
                const shorten = 0.45 / length;
                this.arrowLayer.appendChild(svg('line', {
                    class: 'arrow',
                    x1, y1,
                    x2: x2 - (x2 - x1) * shorten,
                    y2: y2 - (y2 - y1) * shorten,
                    'marker-end': 'url(#chessly-arrowhead)',
                }));
            }
        }

        squareAt(x, y) {
            const rect = this.grid.getBoundingClientRect();
            const col = Math.floor(((x - rect.left) / rect.width) * 8);
            const row = Math.floor(((y - rect.top) / rect.height) * 8);
            if (col < 0 || col > 7 || row < 0 || row > 7) return null;
            const i = row * 8 + col;
            return this.orientation === 'w' ? i : 63 - i;
        }

        isTarget(sq) {
            return this.targets.some((m) => m.to === sq);
        }

        handlePointerDown(e) {
            if (e.button !== 0 || !this.game || this.promotionPending) return;
            const sq = this.squareAt(e.clientX, e.clientY);
            if (sq === null) return;
            e.preventDefault();
            this.dropped = null;
            if (this.selected !== null && this.isTarget(sq)) {
                this.attemptMove(this.selected, sq);
                return;
            }
            const piece = this.game.board[sq];
            if (!piece || piece[0] !== this.game.turn || !this.canMove(piece[0])) {
                this.clearSelection();
                this.render();
                return;
            }
            const reselect = this.selected === sq;
            this.select(sq);
            this.startDrag(sq, e, reselect);
        }

        startDrag(sq, e, reselect) {
            const pieceEl = this.pieceEls[sq];
            if (!pieceEl) return;
            const rect = this.squares[sq].getBoundingClientRect();
            const ghost = pieceEl.cloneNode(true);
            ghost.classList.add('piece-ghost');
            ghost.style.width = rect.width + 'px';
            ghost.style.height = rect.height + 'px';
            ghost.style.fontSize = getComputedStyle(pieceEl).fontSize;
            document.body.appendChild(ghost);
            this.drag = { sq, ghost, reselect, moved: false, startX: e.clientX, startY: e.clientY, over: null };
        }

        handlePointerMove(e) {
            const drag = this.drag;
            if (!drag) return;
            if (!drag.moved) {
                if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
                drag.moved = true;
                drag.ghost.style.visibility = 'visible';
                if (this.pieceEls[drag.sq]) this.pieceEls[drag.sq].classList.add('drag-origin');
            }
            drag.ghost.style.left = e.clientX + 'px';
            drag.ghost.style.top = e.clientY + 'px';
            const over = this.squareAt(e.clientX, e.clientY);
            if (over !== drag.over) {
                if (drag.over !== null) this.squares[drag.over].classList.remove('drag-over');
                if (over !== null && this.isTarget(over)) this.squares[over].classList.add('drag-over');
                drag.over = over;
            }
        }

        handlePointerUp(e) {
            const drag = this.drag;
            if (!drag) return;
            this.endDrag();
            const target = this.squareAt(e.clientX, e.clientY);
            if (target === drag.sq) {
                // A plain click on the already selected piece toggles the selection off.
                if (drag.reselect && !drag.moved) {
                    this.clearSelection();
                    this.render();
                }
                return;
            }
            if (target !== null && this.isTarget(target)) {
                if (drag.moved) this.dropped = { from: drag.sq, to: target };
                this.attemptMove(drag.sq, target);
                return;
            }
            this.clearSelection();
            this.render();
        }

        endDrag() {
            const drag = this.drag;
            if (!drag) return;
            drag.ghost.remove();
            if (this.pieceEls[drag.sq]) this.pieceEls[drag.sq].classList.remove('drag-origin');
            if (drag.over !== null) this.squares[drag.over].classList.remove('drag-over');
            this.drag = null;
        }

        attemptMove(from, to) {
            const candidates = this.targets.filter((m) => m.from === from && m.to === to);
            const color = this.game.turn;
            this.clearSelection();
            if (!candidates.length) {
                this.render();
                return;
            }
            if (candidates.some((m) => m.promotion)) {
                this.render();
                this.askPromotion(color).then((choice) => {
                    if (choice) this.onMove(from, to, choice);
                    this.render();
                });
                return;
            }
            this.onMove(from, to, null);
            this.render();
        }

        askPromotion(color) {
            return new Promise((resolve) => {
                const layer = this.promoLayer;
                const finish = (choice) => {
                    layer.classList.add('hidden');
                    layer.innerHTML = '';
                    layer.onclick = null;
                    this.promotionPending = false;
                    resolve(choice);
                };
                const box = document.createElement('div');
                box.className = 'promo-box';
                ['Q', 'R', 'B', 'N'].forEach((type) => {
                    const button = document.createElement('button');
                    button.className = 'promo-choice';
                    button.type = 'button';
                    button.appendChild(createPieceElement(color + type, this.pieceSet));
                    button.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        finish(type);
                    });
                    box.appendChild(button);
                });
                layer.appendChild(box);
                layer.onclick = () => finish(null);
                layer.classList.remove('hidden');
                this.promotionPending = true;
            });
        }
    }

    BoardView.ANIMATION_STYLES = ANIMATION_STYLES;
    BoardView.ANIMATION_SPEEDS = Object.keys(ANIMATION_SPEEDS);
    root.BoardView = BoardView;
    root.createChessPiece = createPieceElement;
})(window);
