"""Build js/puzzles-data.js from the Lichess puzzle database.

The full database (https://database.lichess.org/#puzzles, CC0) has millions of puzzles and is far too big
for a static app, so this script picks a curated sample: only well-tested, well-liked puzzles, spread
evenly over the rating range.

Usage:
    curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
    python3 tools/build_puzzles.py lichess_db_puzzle.csv.zst            # needs: pip install zstandard
    zstd -dc lichess_db_puzzle.csv.zst | python3 tools/build_puzzles.py -   # or decompress with zstd
"""
import argparse
import csv
import io
import json
import random
import sys
from collections import Counter
from pathlib import Path

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "js" / "puzzles-data.js"

# Quality filter: rating is settled, players liked the puzzle, and it was played often.
MAX_RATING_DEVIATION = 90
MIN_POPULARITY = 85
MIN_PLAYS = 300

# Ratings are grouped into 100-point bands; everything below / above the edges joins the edge band.
BAND_SIZE = 100
LOWEST_BAND = 500
HIGHEST_BAND = 2800


def open_rows(source):
    """Yields the CSV rows of the database as dicts, from a .zst file, a plain CSV or stdin ('-')."""
    if source == "-":
        stream = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
    elif source.endswith(".zst"):
        import zstandard

        raw = open(source, "rb")
        stream = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding="utf-8")
    else:
        stream = open(source, encoding="utf-8", newline="")
    yield from csv.DictReader(stream)


def band_of(rating):
    band = (rating // BAND_SIZE) * BAND_SIZE
    return min(max(band, LOWEST_BAND), HIGHEST_BAND)


def passes_filter(row):
    return (
        int(row["RatingDeviation"]) <= MAX_RATING_DEVIATION
        and int(row["Popularity"]) >= MIN_POPULARITY
        and int(row["NbPlays"]) >= MIN_PLAYS
    )


def sample_puzzles(rows, per_band, seed):
    """Reservoir-samples up to `per_band` puzzles per rating band in a single pass."""
    rng = random.Random(seed)
    reservoirs = {}
    seen = Counter()
    for row in rows:
        if not passes_filter(row):
            continue
        rating = int(row["Rating"])
        band = band_of(rating)
        seen[band] += 1
        puzzle = (row["PuzzleId"], row["FEN"], row["Moves"], rating, row["Themes"].split())
        reservoir = reservoirs.setdefault(band, [])
        if len(reservoir) < per_band:
            reservoir.append(puzzle)
        else:
            slot = rng.randrange(seen[band])
            if slot < per_band:
                reservoir[slot] = puzzle
    return reservoirs, seen


def build_payload(reservoirs):
    puzzles = sorted((p for band in reservoirs.values() for p in band), key=lambda p: (p[3], p[0]))
    theme_counts = Counter(t for p in puzzles for t in p[4])
    themes = [theme for theme, _ in theme_counts.most_common()]
    index = {theme: i for i, theme in enumerate(themes)}
    rows = [
        [pid, fen, moves, rating, [index[t] for t in tags]]
        for pid, fen, moves, rating, tags in puzzles
    ]
    return {
        "source": "Lichess puzzle database (https://database.lichess.org/#puzzles), CC0",
        "themes": themes,
        "puzzles": rows,
    }


def write_js(payload, output):
    body = json.dumps(payload, separators=(",", ":"))
    output.write_text(
        "/*\n"
        " * Chessly puzzles: a curated sample of the Lichess puzzle database (CC0), built by tools/build_puzzles.py.\n"
        " * puzzles: [id, fen, moves (UCI, the first one is the opponent's setup move), rating, theme indices]\n"
        " */\n"
        f"window.CHESSLY_PUZZLES = {body};\n",
        encoding="utf-8",
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="lichess_db_puzzle.csv.zst, a decompressed CSV, or - for stdin")
    parser.add_argument("--per-band", type=int, default=200, help="puzzles per 100-point rating band")
    parser.add_argument("--seed", type=int, default=1, help="random seed, for a reproducible sample")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    reservoirs, seen = sample_puzzles(open_rows(args.source), args.per_band, args.seed)
    payload = build_payload(reservoirs)
    write_js(payload, args.output)

    for band in sorted(reservoirs):
        print(f"{band:>5}: {len(reservoirs[band]):>4} of {seen[band]:>7} eligible")
    size_kb = args.output.stat().st_size / 1024
    print(f"{len(payload['puzzles'])} puzzles, {len(payload['themes'])} themes -> {args.output} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
