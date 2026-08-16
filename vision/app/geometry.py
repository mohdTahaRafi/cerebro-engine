# Rectangle union-area sweep (phase 4 §2.1). Used by classifier.py to compute image
# coverage from a page's embedded image bounding boxes without double-counting overlaps —
# a plain sum of individual rect areas over-counts whenever two images overlap, which is a
# common scanner-software artifact (a full-page scan layered under a stamped logo).
import fitz


def union_area(rects: list[fitz.Rect], clip: fitz.Rect) -> float:
    """Area of the union of `rects`, each first clipped to `clip`.

    Coordinate-compression sweep: collect every distinct x-boundary across the clipped
    rects, walk the resulting vertical strips left to right, and within each strip merge
    the y-intervals of every rect spanning it. Strip width times merged-interval height,
    summed over all strips, is the union area with zero double-counting regardless of how
    the rects overlap. O(n^2) in the number of rects, which is fine here — a page carries
    at most a handful of embedded images, never hundreds.
    """
    clipped = []
    for r in rects:
        c = fitz.Rect(r) & clip   # intersection; empty Rect if disjoint from the page
        if not c.is_empty and c.width > 0 and c.height > 0:
            clipped.append(c)

    if not clipped:
        return 0.0

    xs = sorted({c.x0 for c in clipped} | {c.x1 for c in clipped})

    total = 0.0
    for i in range(len(xs) - 1):
        x0, x1 = xs[i], xs[i + 1]
        strip_width = x1 - x0
        if strip_width <= 0:
            continue
        mid = (x0 + x1) / 2   # sample point — rect edges only change at strip boundaries,
                               # so any point strictly inside the strip gives the same
                               # membership answer for every rect

        intervals = sorted((c.y0, c.y1) for c in clipped if c.x0 <= mid <= c.x1)

        covered = 0.0
        cur_start = cur_end = None
        for y0, y1 in intervals:
            if cur_start is None:
                cur_start, cur_end = y0, y1
            elif y0 <= cur_end:
                cur_end = max(cur_end, y1)
            else:
                covered += cur_end - cur_start
                cur_start, cur_end = y0, y1
        if cur_start is not None:
            covered += cur_end - cur_start

        total += strip_width * covered

    return total
