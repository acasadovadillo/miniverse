"""mh_hair.py: our own hair and beards of cards for the new character creator (plan CR, P4), made on MakeHuman's CC0
base mesh and bound to it, and the strand texture they are drawn with. Everything here is ours (CC0): no hair mesh or
texture of MakeHuman or MPFB is read, only the base body of assets/mh/mh.bin.gz (tools/mh_pack.py).

Runs inside Blender, in the background, for its BVH tree (nearest point on the head, many thousand times per style):
  nice -n 10 /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/mh_hair.py -- [--only corto,largo]
Writes assets/mh/hair.bin.gz and assets/mh/hair-strands.png. src/three/mh/hair.js reads them.

How a style is made: roots are scattered over the scalp inside a hairline (or over the face's beard zones); from each,
a strand is walked in small steps along the style's comb (a direction field: away from the parting, towards a tie, down
the back), pulled by gravity once it leaves the head, kept at its layer's height over the skin and pushed out of the
head, neck and shoulders. Each strand is cut where the style says, resampled to a few points and becomes a card (a
ribbon two vertices wide) lying over the head. Tied styles add a tail, a bun or a braid of cards. Every style is walked
twice with the same randomness, as cut and as grown (hair.js mixes the two: three growth steps), so both have the same
points. Cards are written inner layers first, which is the order they are drawn in (no flicker: the order never changes).

Binding (the same concept as the clothes' "bind to skin", to be shared with it later): each card point is the nearest
point of one body triangle (its barycentric weights) plus an offset in that triangle's own frame (edge, normal, their
cross), so the hair follows the shape of the head, its age and its weight.
"""
import gzip
import json
import math
import os
import struct
import sys
import zlib

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, 'assets', 'mh')
VERSION = 1
OFF_Q = 1000.0      # offsets in int16: thousandths of a decimetre (0.1 mm), up to 3.2 dm from the triangle
V_Q = 8000.0        # the texture's v along a card in uint16 (up to 8 tiles)
W_Q = 400.0         # a card's width in uint8: 1/400 dm (0.25 mm), up to 6.4 cm
TILE = 1.0          # one texture height every decimetre of strand
COLS = 8            # texture columns (kinds of strands)
COL = {'dense': 0, 'clump': 1, 'fine': 2, 'wavy': 3, 'curly': 4, 'beard': 5, 'coarse': 6, 'fuzz': 7}
TEX_W, TEX_H = 512, 512
DOWN = Vector((0, -1, 0))
UP = Vector((0, 1, 0))
BACK = Vector((0, 0, -1))
FWD = Vector((0, 0, 1))


def sm(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


# ---------------------------------------------------------------- the body

class Body:
    def __init__(self, path):
        raw = gzip.open(path).read()
        hl = struct.unpack('<I', raw[4:8])[0]
        h = json.loads(raw[8:8 + hl])
        st = 8 + hl

        def view(n, dt):
            o, l = h['blobs'][n]
            return np.frombuffer(raw[st + o:st + o + l], dtype=dt)
        self.nb = h['nbody']
        pos = view('pos', '<i2').astype(np.float64).reshape(-1, 3) / h['posq']
        self.pos = pos
        rmap = view('body.rmap', '<u2')
        self.tri = rmap[view('body.idx', '<u2')].reshape(-1, 3).astype(np.int64)
        self.ntri = len(self.tri)
        arm = view('body.arm', 'u1').reshape(-1, 2).astype(np.int64)
        J = {k: pos[v].mean(0) for k, v in h['joints'].items()}
        self.J = J
        P = pos[:self.nb]
        self.P = P
        # Landmarks: the eyes' height, the nose's tip, the mouth, the chin (as src/three/mh/person.js faceMaps measures them)
        e = J['joint-l-eye']
        self.ye, self.ez = e[1], e[2]

        def tip(lo, hi):
            m = (np.abs(P[:, 0]) < 0.04) & (P[:, 1] > lo) & (P[:, 1] < hi)
            i = np.where(m)[0][np.argmax(P[m, 2])]
            return P[i]
        self.nose = tip(self.ye - 0.9, self.ye - 0.2)
        self.chin = tip(self.nose[1] - 1.3, self.nose[1] - 0.55)
        self.mouth = self.nose[1] - 0.27
        self.top = P[:, 1].max()
        band = P[np.abs(P[:, 1] - (self.ye + 0.3)) < 0.06]
        self.zb, self.zf = band[:, 2].min(), band[:, 2].max()
        self.C = Vector((0.0, self.ye + 0.28, (self.zb + self.zf) / 2))
        # The triangles hair may touch and be bound to: head, neck, shoulders and the upper body, not the arms
        okv = (arm[:, 0] + arm[:, 1] < 110)
        keep = [t for t in range(self.ntri) if okv[self.tri[t]].all() and P[self.tri[t], 1].min() > 2.6]
        self.keep = np.array(keep)
        verts = [Vector(p) for p in P]
        self.bvh = BVHTree.FromPolygons(verts, [tuple(int(i) for i in self.tri[t]) for t in keep])
        # (the face's: the beard is bound only to it, never to the neck under it, which the collar of the clothes hides)
        print('body: %d triangles kept of %d; eyes at %.3f, head top %.3f, centre %s' % (len(keep), self.ntri, self.ye, self.top, tuple(round(x, 3) for x in self.C)))

    def nearest(self, x, dist=2.0):
        loc, n, i, d = self.bvh.find_nearest(x, dist)
        if loc is None:
            return None, None, None
        return loc, n, int(self.keep[i])

    def frame(self, t):
        a, b, c = (Vector(self.P[i]) for i in self.tri[t])
        e1 = (b - a).normalized()
        n = (b - a).cross(c - a).normalized()
        return a, b, c, e1, n, n.cross(e1)

    def bind(self, p0, p1, T, N):
        """A point (and its grown twin) as triangle, barycentric weights and offsets in the triangle's frame."""
        loc, n, t = self.nearest(p0, 5.0)
        a, b, c, e1, nn, e2 = self.frame(t)
        v0, v1, v2 = b - a, c - a, loc - a
        d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        wb, wc = clamp(wb), clamp(wc)
        if wb + wc > 1:
            s = wb + wc
            wb, wc = wb / s, wc / s
        base = a * (1 - wb - wc) + b * wb + c * wc
        loc3 = lambda v: (v.dot(e1), v.dot(nn), v.dot(e2))
        return t, wb, wc, loc3(p0 - base), loc3(p1 - base), loc3(T), loc3(N)

    def head_angle(self, x):
        """Round the head: 0 in front, 90 at the sides, 180 behind (degrees)."""
        return abs(math.degrees(math.atan2(x[0], x[2] - self.C[2])))


# ---------------------------------------------------------------- the hairline

# The lowest the hair grows, by the angle round the head (degrees from the front), in decimetres over the eyes: a
# forehead about 7 cm over the eyes, the temples a little back, sideburns in front of the ears, over the ears, the nape
HAIRLINE = [(0, 0.74), (18, 0.72), (32, 0.62), (44, 0.46), (54, 0.26), (60, 0.04), (68, -0.12), (75, -0.12), (82, 0.12),
            (96, 0.3), (108, 0.18), (116, -0.3), (135, -0.62), (160, -0.82), (180, -0.86)]


def hairline(a):
    for (a0, y0), (a1, y1) in zip(HAIRLINE, HAIRLINE[1:]):
        if a <= a1:
            t = (a - a0) / (a1 - a0)
            return y0 + (y1 - y0) * (t * t * (3 - 2 * t))
    return HAIRLINE[-1][1]


def wobble(x):
    """A small irregularity of the hairline (fixed, made of sines): no ruler-straight edge."""
    return 0.012 * math.sin(x[0] * 23.0 + x[2] * 7.0) + 0.008 * math.sin(x[0] * 51.0 - x[2] * 37.0 + 1.3)


# ---------------------------------------------------------------- strands

class Ctx:
    def __init__(self, B, seed):
        self.B = B
        self.rng = np.random.default_rng(seed)

    def scalp_roots(self, n, region, spacing, seed=0):
        """n roots scattered over the body triangles inside region(point, angle, height over the eyes) -> 0..1, as evenly
        as a dart throw with a minimum spacing allows. Returns (point, normal) pairs."""
        B, rng = self.B, np.random.default_rng(seed)
        P = B.P
        cand, area = [], []
        for t in B.keep:
            a, b, c = P[B.tri[t]]
            cen = (a + b + c) / 3
            if cen[1] < B.ye - 1.4:
                continue
            ar = 0.5 * np.linalg.norm(np.cross(b - a, c - a))
            cand.append(t)
            area.append(ar)
        area = np.array(area)
        area /= area.sum()
        out, grid = [], {}
        cell = max(spacing, 1e-3)
        tries = 0
        while len(out) < n and tries < n * 400:
            tries += 1
            t = cand[rng.choice(len(cand), p=area)]
            u, v = rng.random(), rng.random()
            if u + v > 1:
                u, v = 1 - u, 1 - v
            a, b, c = (Vector(P[i]) for i in B.tri[t])
            x = a + (b - a) * u + (c - a) * v
            ang = B.head_angle(x)
            w = region(x, ang, x[1] - B.ye)
            if w <= 0 or rng.random() > w:
                continue
            k = (int(x[0] // cell), int(x[1] // cell), int(x[2] // cell))
            ok = True
            for i in (-1, 0, 1):
                for j in (-1, 0, 1):
                    for l in (-1, 0, 1):
                        for q in grid.get((k[0] + i, k[1] + j, k[2] + l), ()):
                            if (q - x).length < spacing:
                                ok = False
                                break
            if not ok:
                continue
            grid.setdefault(k, []).append(x)
            n_ = (b - a).cross(c - a).normalized()
            out.append((x, n_))
        return out

    def walk(self, x0, n0, flow, L, height, grav, hug=1.0, cut=None, ds=0.03, collide=True, shield=True):
        """A strand from x0 (on the skin, normal n0): its points every ds until L or cut. flow(x, t) is where the style
        combs it, grav(t) how much it hangs, height(t) how far over the skin it stays."""
        B = self.B
        x = x0 + n0 * height(0)
        pts = [x.copy()]
        f = flow(x, 0.0)
        d = (f - n0 * f.dot(n0))
        d = d.normalized() if d.length > 1e-6 else f.normalized()
        s = 0.0
        while s < L - 1e-6:
            t = s / L
            f = flow(x, t)
            loc, n, _ = B.nearest(x, 1.0)
            if loc is not None and hug > 0:
                sd = (x - loc).dot(n)
                k = hug * (1 - sm(height(t), height(t) + 0.3, sd))
                f = f - n * (f.dot(n) * k)
            g = grav(t)
            want = f.normalized() * (1 - g) + DOWN * g if f.length > 1e-6 else DOWN
            d = (d * 0.55 + want.normalized() * 0.45).normalized()
            step = min(ds, L - s)
            x = x + d * step
            if collide:
                loc, n, _ = B.nearest(x, 1.0)
                if loc is not None:
                    sd = (x - loc).dot(n)
                    h = height(min(1.0, (s + step) / L))
                    if sd < h:
                        x = loc + n * h
                    # (a combed strand stays on the scalp: over it, it is pulled back to its height; past the hairline it
                    # is free and hangs)
                    elif hug >= 0.6 and loc[1] - B.ye > hairline(B.head_angle(loc)) - 0.08:
                        x = x - n * ((sd - h) * hug)
            # (nothing hangs in front of the face: a strand that would, slides round it to the side)
            if shield and abs(x[0]) < 0.6 and x[2] > B.C[2] + 0.25 and B.ye - 1.6 < x[1] < B.ye + 0.62:
                x[0] = 0.6 if x[0] >= 0 else -0.6
            s += step
            pts.append(x.copy())
            if cut and cut(x, s):
                break
        return pts


def resample(pts, n):
    """n + 1 points evenly along a polyline (a strand shorter than 2 mm comes back as one point repeated)."""
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    total = sum(seg)
    if total < 0.02:
        return [pts[0].copy() for _ in range(n + 1)], 0.0
    out, acc, i = [], 0.0, 0
    for k in range(n + 1):
        target = total * k / n
        while i < len(seg) - 1 and acc + seg[i] < target:
            acc += seg[i]
            i += 1
        f = 0.0 if seg[i] == 0 else clamp((target - acc) / seg[i])
        out.append(pts[i].lerp(pts[i + 1], f))
    return out, total


class Card:
    __slots__ = ('p0', 'p1', 'nrm', 'width', 'col', 'ao', 'rand', 'v0', 'len0', 'taper')

    def __init__(self, p0, p1, nrm, width, col, ao, rand, len0, taper=(0.75, 1.0, 0.35)):
        self.p0, self.p1, self.nrm, self.width, self.col, self.ao, self.rand, self.len0, self.taper = p0, p1, nrm, width, col, ao, rand, len0, taper
        self.v0 = rand * 3.0


def nseg_for(L):
    return int(clamp(round(L / 0.22) + 2, 3, 12))


def outward(B, x, centre=None):
    """The way out of the hair at x: the skin's normal near the head, from the head's centre farther away."""
    loc, n, _ = B.nearest(x, 0.6)
    r = (x - (centre or B.C)).normalized()
    if loc is None:
        return r
    d = (x - loc).length
    return n.lerp(r, sm(0.1, 0.5, d)).normalized()


def strand_card(ctx, root, nrm, flow, L0, L1, height, grav, width, col, ao, seed, hug=1.0, cut0=None, cut1=None, nseg=None,
                post=None, taper=(0.75, 1.0, 0.35), shield=True):
    """One card, cut (L0, cut0) and grown (L1, cut1), walked with the same flow; post(points, along, grown) bends it (waves,
    curls) after resampling."""
    rng = np.random.default_rng(seed)
    rand = float(rng.random())
    a = ctx.walk(root, nrm, flow, L0, height, grav, hug, cut0, shield=shield) if L0 > 0.005 else [root + nrm * height(0)]
    b = ctx.walk(root, nrm, flow, L1, height, grav, hug, cut1, shield=shield)
    n = nseg or nseg_for(L1)
    p0, l0 = resample(a, n)
    p1, l1 = resample(b, n)
    if post:
        p0 = post(p0, l0, rand)
        p1 = post(p1, l1, rand)
    nr = [outward(ctx.B, p) for p in p1]
    # (a strand cut short, at the temples or round the ears, is a narrow card: never a slab wider than it is long)
    w = min(width * (0.8 + 0.4 * rng.random()), max(0.06, 0.9 * max(l0, 0.6 * l1)))
    return Card(p0, p1, nr, w, col, ao, rand, l0, taper)


# ---------------------------------------------------------------- shapes that hang: tails, buns, braids

def frame_of(t):
    u = t.cross(UP if abs(t.dot(UP)) < 0.9 else FWD).normalized()
    return u, t.cross(u).normalized()


def transport(pts):
    """A frame (u, v) at every point of a curve, each turned as little as possible from the one before (no flips)."""
    n = len(pts)
    tans = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tans.append(t.normalized() if t.length > 1e-7 else (tans[-1] if tans else DOWN.copy()))
    u, _ = frame_of(tans[0])
    out = []
    for t in tans:
        u = (u - t * u.dot(t))
        u = u.normalized() if u.length > 1e-6 else frame_of(t)[0]
        out.append((u, t.cross(u).normalized()))
    return out


def tail_axis(ctx, start, d0, L, radius, grav_from=0.05):
    """The axis of a ponytail or a braid: from the tie, hanging, kept a radius out of the neck and the back."""
    return ctx.walk(start, d0.normalized(), lambda x, t: d0, L, lambda t: radius(t), lambda t: sm(grav_from, grav_from + 0.25, t), hug=0.0)


def tail_cards(ctx, axis0, axis1, radius, n_around, col, width_k, seed, ao=(0.55, 1.0), twist=0.6, nseg=None):
    """Cards round a tail's axis (cut and grown axes of the same points), each a ribbon at the tail's radius."""
    rng = np.random.default_rng(seed)
    n = nseg or len(axis0) - 1
    a0, l0 = resample(axis0, n)
    a1, l1 = resample(axis1, n)
    cards = []
    for ring, rk, aok in ((0, 0.45, ao[0]), (1, 1.0, ao[1])):
        m = max(3, n_around // 2) if ring == 0 else n_around
        for k in range(m):
            ph = 2 * math.pi * (k + 0.5 * ring + rng.random() * 0.3) / m
            pts = []
            for A in (a0, a1):
                out = []
                fr = transport(A)
                for i in range(n + 1):
                    u, v = fr[i]
                    f = i / n
                    an = ph + twist * f
                    r = radius(f) * rk
                    out.append(A[i] + (u * math.cos(an) + v * math.sin(an)) * r)
                pts.append(out)
            nr = []
            for i in range(n + 1):
                c = a1[i]
                nr.append((pts[1][i] - c).normalized() if (pts[1][i] - c).length > 1e-5 else UP)
            w = 2 * math.pi * radius(0.4) * max(rk, 0.6) / m * width_k
            cards.append(Card(pts[0], pts[1], nr, w, col, aok, float(rng.random()), l0, (0.9, 1.0, 0.5)))
    return cards


def bun_cards(ctx, centre, axis, R, n_rings, col, seed, grow=0.0):
    """A bun: rings of cards coiled round a ball at centre (its axis out of the head), the outer ones smaller."""
    rng = np.random.default_rng(seed)
    u, v = frame_of(axis)
    cards = []
    for k in range(n_rings):
        lat = -0.9 + 1.8 * k / max(1, n_rings - 1)          # from the head to the bun's top
        rr = R * math.cos(lat * 1.2)
        h = R * math.sin(lat) * 0.85
        for arc in range(2):
            ph0 = arc * math.pi + rng.random() * 0.6
            pts0, pts1, nr = [], [], []
            n = 6
            for i in range(n + 1):
                an = ph0 + math.pi * 1.15 * i / n
                for lst, g in ((pts0, 0.0), (pts1, grow)):
                    r2 = rr * (1 + 0.18 * g)
                    lst.append(centre + axis * (h + R * 0.45) + (u * math.cos(an) + v * math.sin(an)) * r2)
                nr.append((u * math.cos(an) + v * math.sin(an) + axis * math.sin(lat)).normalized())
            cards.append(Card(pts0, pts1, nr, R * 0.62, col, 0.75 + 0.25 * k / n_rings, float(rng.random()), math.pi * rr, (1.0, 1.0, 1.0)))
    return cards


def braid_cards(ctx, axis0, axis1, radius, col, seed, lobes_per_dm=2.1):
    """A three-strand braid along an axis: each strand a pair of crossed ribbons weaving left, back and right."""
    rng = np.random.default_rng(seed)
    out = []
    for A, key in ((axis0, 0), (axis1, 1)):
        pts, L = resample(A, 40)
        out.append((pts, L))
    (a0, l0), (a1, l1) = out
    n = 40
    cards = []
    for k in range(3):
        for cross in (0, 1):
            P = [[], []]
            nr = []
            for which, (A, L) in enumerate(((a0, l0), (a1, l1))):
                fr = transport(A)
                for i in range(n + 1):
                    u, v = fr[i]
                    f = i / n
                    th = 2 * math.pi * (L * f * lobes_per_dm) + 2 * math.pi * k / 3
                    r = radius(f)
                    off = u * (math.sin(th) * r * 0.9) + v * (math.sin(2 * th) * r * 0.45)
                    P[which].append(A[i] + off)
                    if which == 1:   # (lit as the lobe's outside: away from the braid's axis)
                        nr.append(off.normalized() if off.length > 1e-6 else u)
            cards.append(Card(P[0], P[1], nr, radius(0.3) * 1.6, col, 1.0, float(rng.random()), l0, (0.9, 1.0, 0.6)))
    return cards


# ---------------------------------------------------------------- the styles

def region_scalp(extra=0.0):
    return lambda x, a, y: sm(-0.02, 0.03, y - hairline(a) - wobble(x) + extra)


def in_ear(B, x):
    """The ear's own skin (no roots on it)."""
    a = B.head_angle(x)
    return 76 < a < 116 and abs(x[0]) > 0.66 and B.ye - 0.48 < x[1] < B.ye + 0.26


def scalp_layers(ctx, flow, length, height, grav, layers, seed, cut=None, hug=1.0, post=None, region=None, nseg=None):
    """The usual body of a style: per layer (count, spacing, width, base height, kind, ao), roots on the scalp and a
    card from each. length(root, grown) and cut(root, grown) give each strand its end."""
    B = ctx.B
    reg = region or region_scalp()
    cards = []
    for li, (count, spacing, width, h0, col, ao) in enumerate(layers):
        roots = ctx.scalp_roots(count, lambda x, a, y: 0 if in_ear(B, x) else reg(x, a, y), spacing, seed + li * 1000)
        for ri, (x, n) in enumerate(roots):
            hh = lambda t, h0=h0: height(t, h0)
            c0 = cut(x, 0) if cut else None
            c1 = cut(x, 1) if cut else None
            hg = hug(x) if callable(hug) else hug
            cards.append(strand_card(ctx, x, n, (lambda r: (lambda p, t: flow(p, t, r)))(x), length(x, 0), length(x, 1), hh, grav,
                                     width, COL[col], ao, seed + li * 1000 + ri, hg, c0, c1, post=post, nseg=nseg))
    return cards


def hairline_wisps(ctx, flow, L0, L1, n, seed, height=0.012, grav=lambda t: 0.0, region=None, col='fine'):
    """Fine short cards along the hairline. Tried and left out (2026-11-28): lying on the forehead they read as dark specks;
    the scalp's soft paint and the cards' faded roots make the edge instead."""
    return []
    B = ctx.B
    reg = region or (lambda x, a, y: max(0.0, 1 - abs(y - hairline(a) - wobble(x) - 0.03) / 0.06))
    roots = ctx.scalp_roots(n, lambda x, a, y: 0 if in_ear(B, x) else reg(x, a, y), 0.05, seed)
    return [strand_card(ctx, x, nn, (lambda r: (lambda p, t: flow(p, t, r)))(x), L0, L1, lambda t: height, grav, 0.1, COL[col], 0.95,
                        seed + i, 1.0, nseg=2 if L1 < 0.3 else 3, taper=(0.5, 1.0, 0.4)) for i, (x, nn) in enumerate(roots)]


def fuzz_layer(ctx, seed, count=200, region=None):
    """Very short hair lying flat all over the scalp, under the style: where the long cards leave a gap (the sideburns,
    over the ears, the nape) it still reads as hair, not paint."""
    flow = lambda p, t, r: (DOWN * 0.75 + BACK * 0.55).normalized()
    return scalp_layers(ctx, flow, lambda r, g: 0.07 + 0.04 * g, lambda t, h0: h0, lambda t: 0.0, [(count, 0.07, 0.13, 0.006, 'fuzz', 0.85)], seed,
                        region=region, nseg=2)


def tang(v, n):
    return v - n * v.dot(n)


class Styles:
    def __init__(self, B):
        self.B = B
        b = B
        self.ye = b.ye
        self.crown = Vector((0.0, b.top - 0.12, b.zb + 0.35))
        self.mask = {}   # (a style whose hair grows on less than the whole scalp: its region, for the scalp's paint)

    def edge_cut(self, over0, over1, keep=None):
        """Strands that run over the head until they pass the hairline by over0 (cut) or over1 (grown) decimetres: long
        cards whose ends are only at the edges, no scales of short cards on the head. keep(root) True: not cut so."""
        B, ye = self.B, self.ye

        def cut(r, g):
            if keep and keep(r):
                return None
            over = over0 + (over1 - over0) * g
            return lambda x, s: s > 0.05 and (x[1] - ye) < hairline(B.head_angle(x)) + wobble(x) - over
        return cut

    def side_part(self, x, xp):
        return 1.0 if x[0] >= xp else -1.0

    # ---- short, combed to one side from a parting on the left (corto, flequillo, mullet)
    def corto(self, ctx):
        B, ye, xp = self.B, self.ye, 0.3

        def flow(p, t, r):
            y = r[1] - ye
            s = self.side_part(r, xp)
            if y > 0.62 and r[2] > B.C[2] - 0.2:
                return (Vector((0.9 * s, -0.1, 0)) + BACK * 0.55 + (Vector((-0.6, 0, 0)) if s < 0 else Vector())).normalized()
            if y > 0.5:
                return (BACK * 0.8 + Vector((0.4 * s, -0.4, 0))).normalized()
            return (DOWN * 0.8 + BACK * 0.45).normalized()

        def height(t, h0):
            return h0 + 0.035 * sm(0, 0.3, t)
        cards = fuzz_layer(ctx, 3329) + scalp_layers(ctx, flow, lambda r, g: 2.4, height, lambda t: 0.0, [(100, 0.1, 0.26, 0.015, 'dense', 0.82), (90, 0.11, 0.2, 0.04, 'clump', 0.93),
                                                                              (80, 0.12, 0.15, 0.065, 'clump', 1.0)], 101, cut=self.edge_cut(0.06, 0.26), nseg=7)
        cards += hairline_wisps(ctx, lambda p, t, r: flow(p, t, r), 0.08, 0.14, 50, 191)
        return cards

    # ---- straight and long, a centre parting, to the middle of the back (largo; ondas with waves; melena shorter)
    def long_(self, ctx, xp=0.0, L=3.4, cut_y=None, waves=0.0, seed=201, fringe=False, curl=0.0, vol=0.05, kinds=None, counts=(80, 75, 60)):
        B, ye = self.B, self.ye

        def flow(p, t, r):
            s = self.side_part(r, xp)
            y, a = r[1] - ye, B.head_angle(r)
            if fringe and a < 40 and y > 0.55:
                return (DOWN + FWD * 0.6).normalized()
            side = (1 - sm(80, 130, a)) * sm(0.2, 0.5, y)
            return (Vector((s * side, 0, 0)) + DOWN * (0.25 + 0.75 * (1 - side)) + BACK * (0.15 + 0.45 * sm(40, 90, a))).normalized()

        def length(r, g):
            a = B.head_angle(r)
            front = 1 - sm(30, 90, a)
            return (L - 0.5 * front) * (1 + 0.18 * g)

        def cut(r, g):
            if cut_y is None:
                return None
            yc = cut_y - 0.4 * g
            return lambda x, s: x[1] < yc and s > 0.4

        def height(t, h0):
            return h0 + vol * sm(0, 0.12, t)

        def post(p, l, rand):
            if not waves and not curl:
                return p
            out = []
            for i, q in enumerate(p):
                s = l * i / (len(p) - 1)
                k = sm(0.35, 0.9, s) * waves
                if i == 0 or i == len(p) - 1:
                    t = p[min(i + 1, len(p) - 1)] - p[max(i - 1, 0)]
                else:
                    t = p[i + 1] - p[i - 1]
                n = outward(B, q)
                w = t.cross(n).normalized() if t.length > 1e-6 else Vector((1, 0, 0))
                if curl:
                    k = curl * sm(0.05, 0.3, s)
                    ph = s * 2 * math.pi / 0.4 + rand * 6.28
                    out.append(q + w * (k * math.sin(ph)) + n * (k * 0.7 * math.cos(ph)))
                else:
                    out.append(q + w * (k * math.sin(s * 2 * math.pi / 0.95 + rand * 6.28)) + n * (0.4 * k * math.cos(s * 2 * math.pi / 0.95 + rand * 6.28)))
            return out
        grav = lambda t: sm(0.03, 0.2, t)
        nseg = 10 if L > 2 else 8
        kinds = kinds or (('wavy', 'wavy', 'clump') if waves else ('dense', 'clump', 'clump'))
        cards = []
        for li, (count, spacing, width, h0, col, ao) in enumerate([(counts[0], 0.11, 0.32, 0.02, kinds[0], 0.9), (counts[1], 0.12, 0.24, 0.02 + vol * 0.7, kinds[1], 0.96), (counts[2], 0.13, 0.17, 0.02 + vol * 1.4, kinds[2], 1.0)]):
            roots = ctx.scalp_roots(count, lambda x, a, y: 0 if in_ear(B, x) else region_scalp()(x, a, y), spacing, seed + li * 1000)
            for ri, (x, n) in enumerate(roots):
                c = cut(x, 0), cut(x, 1)
                cards.append(strand_card(ctx, x, n, (lambda r: (lambda p, t: flow(p, t, r)))(x), length(x, 0), length(x, 1),
                                         lambda t, h0=h0: height(t, h0), grav, width, COL[col], ao, seed + li * 1000 + ri, 1.0, c[0], c[1], nseg=nseg, post=post))
        cards += hairline_wisps(ctx, lambda p, t, r: flow(p, t, r), 0.1, 0.18, 40, seed + 90, col='curly' if curl else 'fine')
        return cards

    def largo(self, ctx):
        return self.long_(ctx, 0.0, 3.4, None, 0.0, 201)

    def ondas(self, ctx):
        return self.long_(ctx, 0.28, 3.6, None, 0.065, 301, counts=(85, 80, 60))

    def melena(self, ctx):
        return self.long_(ctx, 0.0, 2.2, self.ye - 1.72, 0.0, 401)

    # ---- the bowl: all round from the crown, a straight fringe and the sides cut over the ears (tazon)
    def tazon(self, ctx):
        B, ye, K = self.B, self.ye, self.crown

        def flow(p, t, r):
            d = (r - K)
            d[1] = min(d[1], 0) - 0.15
            return (d.normalized() + DOWN * 0.35).normalized()

        def cutline(x, g):
            a = B.head_angle(x)
            return ye + 0.36 - 0.5 * sm(40, 80, a) - 0.12 * sm(100, 170, a) - 0.12 * g

        def cut(r, g):
            return lambda x, s: x[1] < cutline(x, g) and s > 0.1

        def height(t, h0):
            return h0 + 0.05 * sm(0, 0.4, t)
        layers = [(120, 0.1, 0.3, 0.015, 'dense', 0.8), (100, 0.11, 0.22, 0.05, 'clump', 0.92), (80, 0.12, 0.17, 0.085, 'clump', 1.0)]
        reg = lambda x, a, y: region_scalp()(x, a, y) * sm(-0.06, 0.0, x[1] - cutline(x, 0))
        self.mask['tazon'] = lambda x, a, y: region_scalp(0.03)(x, a, y) * sm(-0.1, 0.0, x[1] - cutline(x, 0))
        cards = scalp_layers(ctx, flow, lambda r, g: 1.6 + g * 0.3, height, lambda t: 0.25 * t, layers, 501, cut=cut, nseg=8, region=reg)
        cards += hairline_wisps(ctx, lambda p, t, r: flow(p, t, r), 0.06, 0.1, 30, 591)
        return cards

    # ---- curly, medium (rizado)
    def rizado(self, ctx):
        return self.long_(ctx, 0.0, 1.5, self.ye - 1.25, 0.0, 601, curl=0.065, vol=0.14, kinds=('curly', 'curly', 'curly'), counts=(90, 85, 70))

    # ---- the afro: shells of curly cards round the head
    def afro(self, ctx):
        B = self.B
        rng = np.random.default_rng(701)
        cards = []
        shells = [(0.05, 180, 0.3, 0.75), (0.2, 200, 0.26, 0.85), (0.36, 200, 0.24, 0.93), (0.5, 200, 0.2, 1.0)]
        for si, (r0, count, width, ao) in enumerate(shells):
            roots = ctx.scalp_roots(count, lambda x, a, y: 0 if in_ear(B, x) else region_scalp()(x, a, y), 0.085 - 0.008 * si, 701 + si * 100)
            for ri, (x, n) in enumerate(roots):
                rad = (x - B.C).normalized()
                sp = sm(-0.9, 0.2, x[1] - B.ye)             # (less out low on the nape and round the ears)
                c0 = x + rad * (r0 * (0.35 + 0.65 * sp))
                c1 = x + rad * ((r0 * 1.3 + 0.12) * (0.35 + 0.65 * sp))
                tdir = rad.cross(Vector((rng.random() - 0.5, rng.random() - 0.5, rng.random() - 0.5))).normalized()
                L = 0.3
                p0, p1, nr = [], [], []
                for i in range(3):
                    f = (i / 2 - 0.5) * L
                    for lst, c in ((p0, c0), (p1, c1)):
                        q = c + tdir * f
                        q = B.C + (q - B.C).normalized() * ((c - B.C).length)
                        lst.append(q)
                    nr.append((p1[-1] - B.C).normalized())
                cards.append(Card(p0, p1, nr, width, COL['curly'], ao, float(rng.random()), L, (0.6, 1.0, 0.6)))
        return cards

    # ---- shaved to a few millimetres; grown, a crop (rapado)
    def rapado(self, ctx):
        B, K = self.B, self.crown

        def flow(p, t, r):
            d = r - K
            d[1] = min(d[1], 0) - 0.2
            return d.normalized()
        layers = [(420, 0.06, 0.15, 0.008, 'fuzz', 0.8)]
        return scalp_layers(ctx, flow, lambda r, g: 0.05 + 0.14 * g, lambda t, h0: h0 + 0.01 * t, lambda t: 0.0, layers, 801, nseg=3)

    # ---- bald on top, the sides and the back short (calvo)
    def calvo(self, ctx):
        B, ye = self.B, self.ye
        reg = lambda x, a, y: region_scalp()(x, a, y) * sm(0.48, 0.3, y + 0.25 * sm(120, 180, a)) * sm(50, 64, a)
        self.mask['calvo'] = lambda x, a, y: region_scalp(0.03)(x, a, y) * sm(0.52, 0.34, y + 0.25 * sm(120, 180, a)) * sm(46, 60, a)

        def flow(p, t, r):
            return (DOWN * 0.7 + BACK * 0.6).normalized()
        layers = [(110, 0.08, 0.22, 0.01, 'dense', 0.85), (80, 0.09, 0.17, 0.028, 'clump', 1.0)]
        return scalp_layers(ctx, flow, lambda r, g: 1.2, lambda t, h0: h0 + 0.01 * t, lambda t: 0.0, layers, 901, region=reg, cut=self.edge_cut(0.03, 0.18), nseg=5)

    # ---- spikes up (pinchos, cresta)
    def pinchos(self, ctx):
        B, ye = self.B, self.ye

        def flow(p, t, r):
            y = r[1] - ye
            if y > 0.45:
                return ((r - B.C).normalized() + UP * 0.6 + FWD * 0.2).normalized()
            return (DOWN * 0.6 + BACK * 0.6).normalized()

        def length(r, g):
            y = r[1] - ye
            return 0.18 + 0.32 * sm(0.4, 0.9, y) + g * 0.15
        def length(r, g):
            y = r[1] - ye
            return (0.18 + 0.32 * sm(0.4, 0.9, y) + g * 0.15) if y > 0.45 else 2.0
        layers = [(130, 0.09, 0.24, 0.015, 'dense', 0.8), (110, 0.1, 0.16, 0.04, 'clump', 0.92), (80, 0.12, 0.12, 0.06, 'clump', 1.0)]
        cards = fuzz_layer(ctx, 3604) + scalp_layers(ctx, flow, length, lambda t, h0: h0 + 0.02 * t, lambda t: 0.0, layers, 1001, hug=lambda r: 0.3 if r[1] - ye > 0.45 else 1.0,
                             cut=self.edge_cut(0.04, 0.2, keep=lambda r: r[1] - ye > 0.45), nseg=6)
        cards += hairline_wisps(ctx, lambda p, t, r: flow(p, t, r), 0.06, 0.1, 40, 1091)
        return cards

    # ---- the quiff: the front up and back, the sides flat back (tupe)
    def tupe(self, ctx):
        B, ye = self.B, self.ye

        def flow(p, t, r):
            y = r[1] - ye
            a = B.head_angle(r)
            if y > 0.55 and a < 70:
                k = sm(0, 0.5, t)
                return (UP * (1 - k) * 1.1 + FWD * 0.45 * (1 - k) + BACK * (0.3 + 1.5 * k)).normalized()
            if y > 0.4:
                return (BACK + DOWN * 0.15).normalized()
            return (BACK * 0.5 + DOWN * 0.8).normalized()

        def length(r, g):
            y, a = r[1] - ye, B.head_angle(r)
            front = sm(0.5, 0.8, y) * (1 - sm(50, 90, a))
            return 0.25 + 0.55 * front + 0.2 * sm(0.4, 0.8, y) + g * 0.18
        layers = [(110, 0.1, 0.28, 0.015, 'dense', 0.8), (100, 0.11, 0.22, 0.045, 'clump', 0.92), (80, 0.12, 0.16, 0.07, 'clump', 1.0)]
        front = lambda r: r[1] - ye > 0.55 and B.head_angle(r) < 70
        cards = fuzz_layer(ctx, 3776, 185) + scalp_layers(ctx, flow, lambda r, g: length(r, g) if front(r) else 2.4, lambda t, h0: h0 + 0.05 * sm(0, 0.4, t), lambda t: 0.05, layers, 1101, hug=lambda r: 0.5 if front(r) else 1.0,
                             cut=self.edge_cut(0.05, 0.24, keep=front), nseg=7)
        cards += hairline_wisps(ctx, lambda p, t, r: flow(p, t, r), 0.07, 0.12, 40, 1191)
        return cards

    # ---- tied: the scalp combed to the tie, then a tail, a bun or a braid
    def tied(self, ctx, ties, seed, tail='tail', loose=True):
        """ties: list of (tie point, the tail's first direction); every root combs to the nearest tie."""
        B, ye = self.B, self.ye

        def nearest_tie(r):
            return min(ties, key=lambda T: (T[0] - r).length)[0]

        def flow(p, t, r):
            T = nearest_tie(r)
            return (T - p).normalized()

        def cut(r, g):
            T = nearest_tie(r)
            return lambda x, s: (x - T).length < 0.12

        def length(r, g):
            return (nearest_tie(r) - r).length * 1.8

        layers = [(100, 0.1, 0.34, 0.012, 'dense', 0.9), (85, 0.11, 0.26, 0.035, 'clump', 0.96), (55, 0.14, 0.2, 0.055, 'clump', 1.0)]
        cards = fuzz_layer(ctx, seed + 7, 160) + scalp_layers(ctx, flow, length, lambda t, h0: h0, lambda t: 0.0, layers, seed, cut=cut, hug=1.0, nseg=7)
        for k, (T, d0) in enumerate(ties):
            if tail == 'tail':
                L0, L1 = 2.3, 2.9
                rad = lambda f: 0.1 + 0.16 * sm(0, 0.15, f) - 0.14 * sm(0.5, 1, f)
                a0 = tail_axis(ctx, T, d0, L0, lambda t: 0.2, 0.0)
                a1 = tail_axis(ctx, T, d0, L1, lambda t: 0.2, 0.0)
                cards += tail_cards(ctx, a0, a1, rad, 16, COL['dense'], 1.4, seed + 50 + k, nseg=9, twist=0.25)
            elif tail == 'bun':
                axis = (T - B.C).normalized()
                cards += bun_cards(ctx, T, axis, 0.34, 6, COL['coarse'], seed + 60 + k, 0.4)
            elif tail == 'braid':
                L0, L1 = 2.6, 3.2
                rad = lambda f: 0.15 - 0.06 * sm(0.6, 1, f)
                a0 = tail_axis(ctx, T, d0, L0, lambda t: 0.14, 0.0)
                a1 = tail_axis(ctx, T, d0, L1, lambda t: 0.14, 0.0)
                cards += braid_cards(ctx, a0, a1, rad, COL['coarse'], seed + 70 + k)
                # (the brush under the last tie)
                e0, e1 = a0[-1], a1[-1]
                b0 = tail_axis(ctx, e0, DOWN, 0.35, lambda t: 0.1)
                b1 = tail_axis(ctx, e1, DOWN, 0.42, lambda t: 0.1)
                cards += tail_cards(ctx, b0, b1, lambda f: 0.08 + 0.05 * f, 6, COL['clump'], 1.4, seed + 80 + k, nseg=3)
        # (the tie itself: a few dark turns of hair round it)
        if tail in ('tail', 'braid'):
            for k, (T, d0) in enumerate(ties):
                ax = d0.normalized()
                u, v = frame_of(ax)
                rr = 0.1
                p = [T + ax * 0.05 + (u * math.cos(2 * math.pi * i / 8) + v * math.sin(2 * math.pi * i / 8)) * rr for i in range(9)]
                cards.append(Card(p, [q.copy() for q in p], [(q - T - ax * 0.05).normalized() for q in p], 0.07, COL['coarse'], 0.35, 0.5, 0.6, (1.0, 1.0, 1.0)))
        if loose:
            # (grown, loose strands fall round the face: nothing while cut)
            reg = lambda x, a, y: max(0.0, 1 - abs(y - hairline(a) - 0.06) / 0.08) * (1 - sm(50, 75, a))
            roots = ctx.scalp_roots(10, reg, 0.12, seed + 95)
            for i, (x, n) in enumerate(roots):
                cards.append(strand_card(ctx, x, n, lambda p, t: (DOWN + FWD * 0.2).normalized(), 0.0, 0.9, lambda t: 0.03, lambda t: sm(0, 0.3, t),
                                         0.12, COL['fine'], 1.0, seed + 96 + i, 1.0, nseg=5))
        cards += hairline_wisps(ctx, lambda p, t, r: flow(p, t, r), 0.07, 0.1, 40, seed + 99)
        return cards

    def coleta(self, ctx):
        T = Vector((0.0, self.ye + 0.12, self.B.zb - 0.06))
        return self.tied(ctx, [(T, Vector((0, -1, -0.6)))], 1201)

    def coletas(self, ctx):
        B = self.B
        ties = [(Vector((s * 0.66, B.ye - 0.12, B.C[2] - 0.62)), Vector((s * 0.7, -1, -0.2))) for s in (1, -1)]
        return self.tied(ctx, ties, 1301)

    def mono(self, ctx):
        T = Vector((0.0, self.ye + 0.32, self.B.zb - 0.12))
        return self.tied(ctx, [(T, BACK)], 1401, tail='bun')

    def trenza(self, ctx):
        T = Vector((0.0, self.ye - 0.25, self.B.zb + 0.12))
        return self.tied(ctx, [(T, Vector((0, -1, -0.35)))], 1501, tail='braid')

    # ---- beards: roots on the face's zones, combed down; cut and grown (two steps of hair.js)
    def beard_zone(self, kind):
        B = self.B
        nose, chin, mouth, ye = B.nose, B.chin, B.mouth, B.ye

        def z(x, a, y):
            X, Y, Z = abs(x[0]), x[1], x[2]
            front = sm(-0.95, -0.6, Z - chin[2])
            lips = (1 - sm(0.2, 0.3, X)) * (1 - sm(0.06, 0.1, abs(Y - mouth + 0.02)))
            nostr = (1 - sm(0.16, 0.24, X)) * sm(nose[1] - 0.16, nose[1] - 0.1, Y)
            bare = max(lips, nostr)
            m = sm(mouth + 0.05, mouth + 0.09, Y) * (1 - sm(nose[1] - 0.12, nose[1] - 0.06, Y)) * (1 - sm(0.24, 0.32, X)) * front
            c = sm(chin[1] - 0.32, chin[1] - 0.24, Y) * (1 - sm(mouth - 0.13, mouth - 0.09, Y)) * (1 - sm(0.18, 0.26, X)) * front
            j = sm(chin[1] - 0.62, chin[1] - 0.5, Y) * (1 - sm(ye - 0.66, ye - 0.56, Y)) * (1 - sm(0.66, 0.76, X)) * sm(-1.3, -1.05, Z - chin[2])
            # (the cheek's upper edge slants up to the sideburn)
            j *= 1 - sm(0, 0.08, Y - (mouth + 0.05 + 0.5 * sm(0.2, 0.7, X)))
            corners = (1 - sm(0.26, 0.32, X)) * sm(chin[1] - 0.2, chin[1] - 0.1, Y) * (1 - sm(mouth + 0.06, mouth + 0.1, Y)) * front
            parts = {'bigote': m, 'perilla': c, 'candado': max(m, c, corners), 'completa': max(m, c, j), 'larga': max(m, c, j)}[kind]
            return parts * (1 - bare)
        return z

    def beard(self, ctx, kind, L0, L1, seed):
        B = self.B
        reg = self.beard_zone(kind)

        def flow(p, t, r):
            X = r[0]
            if r[1] > B.mouth + 0.03:                     # (the moustache: down and outwards)
                return (DOWN + Vector((0.8 * math.copysign(1, X), 0, 0))).normalized()
            return (DOWN + FWD * 0.15).normalized()
        long_ = kind == 'larga'
        n = {'bigote': 0.4, 'perilla': 0.45, 'candado': 0.65, 'completa': 1.0, 'larga': 1.0}[kind]
        layers = [(int(190 * n), 0.042, 0.17, 0.006, 'beard', 0.85), (int(160 * n), 0.045, 0.15, 0.017, 'beard', 0.95),
                  (int(80 * n), 0.06, 0.11, 0.028, 'fine', 1.0)]
        cards = []
        for li, (count, spacing, width, h0, col, ao) in enumerate(layers):
            roots = ctx.scalp_roots(count, reg, spacing, seed + li * 100)
            for ri, (x, n) in enumerate(roots):
                grav = (lambda t: sm(0.2, 0.6, t)) if long_ else (lambda t: 0.3 * t)
                cards.append(strand_card(ctx, x, n, (lambda r: (lambda p, t: flow(p, t, r)))(x), L0, L1, lambda t, h0=h0: h0 + (0.05 if long_ else 0.015) * t,
                                         grav, width * (1.5 if long_ else 1.0), COL[col], ao, seed + li * 100 + ri, 0.8, nseg=5 if long_ else 2, taper=(0.7, 1.0, 0.45), shield=False))
        return cards


HAIR_STYLES = ['corto', 'largo', 'coleta', 'rizado', 'mono', 'rapado', 'calvo', 'pinchos', 'melena', 'coletas', 'trenza', 'tupe', 'afro', 'ondas', 'tazon']
BEARDS = {'bigote': (0.12, 0.26), 'perilla': (0.14, 0.34), 'candado': (0.12, 0.28), 'completa': (0.1, 0.3), 'larga': (0.55, 1.05)}


# ---------------------------------------------------------------- the scalp's paint: where the hair grows, per body vertex

def scalp_mask(B, region):
    """How much each head vertex is under hair (the skin is darkened there with the hair's colour): the style's region,
    softened a little past the hairline."""
    P = B.P
    sel = np.where((P[:, 1] > B.ye - 1.3) & (P[:, 1] < B.top + 1))[0]
    out_i, out_w = [], []
    for i in sel:
        x = Vector(P[i])
        a = B.head_angle(x)
        w = 0.0 if in_ear(B, x) else region(x, a, x[1] - B.ye)
        if w > 0.02:
            out_i.append(i)
            out_w.append(int(round(w * 255)))
    return out_i, out_w


# ---------------------------------------------------------------- the strand texture (ours, made here)

def strand_texture():
    """8 columns of strands, 64 x 512 each, tiling up and down: luminance and alpha. Each strand has a depth: the ones
    behind are drawn first and darker, so the card has volume and shade between its strands. Denser in the middle of the
    column and fading to its sides, so a card never shows a straight edge."""
    W, H, cw = TEX_W, TEX_H, TEX_W // COLS
    lum = np.zeros((H, W), np.float32)
    alp = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(42)
    v = np.arange(H, dtype=np.float32)
    xs = np.arange(cw, dtype=np.float32)
    # (kind: strands, their width (px, sigma), alpha, waves (cycles per tile, amplitude px), clumps (how many, pull),
    # spread of the roots across the column (sigma, in columns), gaps (how much of the tile a strand may miss))
    spec = {
        'dense': dict(n=320, w=(0.45, 0.75), a=(0.35, 0.75), wave=(1, 1.5), clumps=(4, 0.35), spread=0.24, gap=0.12),
        'clump': dict(n=240, w=(0.45, 0.75), a=(0.35, 0.8), wave=(1, 2.0), clumps=(4, 0.6), spread=0.2, gap=0.25),
        'fine': dict(n=70, w=(0.35, 0.6), a=(0.3, 0.65), wave=(2, 3.0), clumps=(0, 0), spread=0.22, gap=0.4),
        'wavy': dict(n=260, w=(0.45, 0.75), a=(0.4, 0.8), wave=(4, 5.0), clumps=(4, 0.45), spread=0.22, gap=0.15),
        'curly': dict(n=200, w=(0.5, 0.85), a=(0.45, 0.85), wave=(14, 6.0), clumps=(5, 0.5), spread=0.2, gap=0.2),
        'beard': dict(n=240, w=(0.5, 0.8), a=(0.45, 0.85), wave=(5, 2.5), clumps=(0, 0), spread=0.27, gap=0.25),
        'coarse': dict(n=260, w=(0.5, 0.85), a=(0.45, 0.85), wave=(2, 2.0), clumps=(3, 0.3), spread=0.25, gap=0.1),
        'fuzz': dict(n=200, w=(0.4, 0.7), a=(0.45, 0.8), wave=(24, 1.5), clumps=(0, 0), spread=0.26, gap=0.82),
    }
    for name, ci in COL.items():
        S = spec[name]
        L = np.zeros((H, cw), np.float32)
        A = np.zeros((H, cw), np.float32)
        nc, pull = S['clumps']
        centres = rng.uniform(12, cw - 12, nc) if nc else None
        strands = []
        for k in range(S['n']):
            x0 = float(np.clip(cw / 2 + rng.normal() * cw * S['spread'], 3, cw - 4))
            strands.append((rng.random(), x0, k))
        strands.sort()
        for d, x0, k in strands:
            cyc = S['wave'][0] * (rng.choice([1, 1, 2]) if name not in ('curly', 'fuzz', 'beard') else 1)
            amp = S['wave'][1] * rng.uniform(0.5, 1.2)
            ph = rng.uniform(0, 2 * math.pi)
            x = x0 + amp * np.sin(2 * math.pi * cyc * v / H + ph)
            if centres is not None:
                c = centres[np.argmin(np.abs(centres - x0))]
                # (strands gather into the clump and part again along the tile)
                pk = pull * (0.6 + 0.4 * np.sin(2 * math.pi * 2 * v / H + c))
                x = x + (c - x) * pk
            w = rng.uniform(*S['w'])
            a = rng.uniform(*S['a'])
            b = 0.55 + 0.45 * d
            on = np.ones(H, np.float32)
            if S['gap'] > 0:
                g0 = rng.uniform(0, H)
                gl = S['gap'] * H * rng.uniform(0.3, 1.0)
                on = np.where((v - g0) % H < gl, 0.0, 1.0).astype(np.float32)
                ramp = np.clip(np.minimum((v - g0 - gl) % H, (g0 - v) % H) / 35.0, 0, 1)
                on *= ramp
            if name == 'curly':
                lit = b * (0.8 + 0.2 * np.cos(2 * math.pi * cyc * v / H + ph + 1.0))
            else:
                lit = b * (0.92 + 0.08 * np.sin(v / 18.5 + k))
            prof = np.exp(-((xs[None, :] - x[:, None]) ** 2) / (2 * w * w)) * (a * on)[:, None]
            L = L * (1 - prof) + lit[:, None] * prof
            A = 1 - (1 - A) * (1 - prof)
        side = np.clip(np.minimum(xs, cw - 1 - xs) / 9.0, 0, 1) ** 1.5
        lum[:, ci * cw:(ci + 1) * cw] = np.where(A > 0.02, L / np.maximum(A, 1e-3), 0.7)
        A *= side[None, :]
        alp[:, ci * cw:(ci + 1) * cw] = A
    lum = np.clip(lum, 0, 1)
    rows = []
    l8 = (lum * 255 + 0.5).astype(np.uint8)
    a8 = (np.clip(alp, 0, 1) * 255 + 0.5).astype(np.uint8)
    la = np.stack([l8, a8], axis=2).reshape(H, W * 2)
    for y in range(H):
        rows.append(la[y].tobytes())
    return W, H, rows


def png_write_la(path, w, h, rows):
    raw = b''.join(b'\0' + r for r in rows)

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 4, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


# ---------------------------------------------------------------- packing

class Blob:
    def __init__(self):
        self.parts, self.index, self.size = [], {}, 0

    def add(self, name, data):
        pad = (-self.size) % 4
        if pad:
            self.parts.append(b'\0' * pad)
            self.size += pad
        self.index[name] = [self.size, len(data)]
        self.parts.append(data)
        self.size += len(data)


def q16(x, k):
    return max(-32767, min(32767, int(round(x * k))))


def pack_style(B, blob, name, cards, kind, mask):
    tri, bary, o0, o1, tn, wa, vv, cd = [], [], [], [], [], [], [], []
    npts = 0
    for c in cards:
        n = len(c.p0)
        acc = 0.0
        for i in range(n):
            j0, j1 = max(i - 1, 0), min(i + 1, n - 1)
            T = (c.p1[j1] - c.p1[j0])
            T = T.normalized() if T.length > 1e-6 else DOWN.copy()
            N = c.nrm[i]
            t, wb, wc, a, b, tl, nl = B.bind(c.p0[i], c.p1[i], T, N)
            tri.append(t)
            bary += [int(round(wb * 65535)), int(round(wc * 65535))]
            o0 += [q16(x, OFF_Q) for x in a]
            o1 += [q16(x, OFF_Q) for x in b]
            tn += [max(-127, min(127, int(round(x * 127)))) for x in tl + nl]
            f = i / (n - 1)
            tp = c.taper
            wk = tp[0] + (tp[1] - tp[0]) * sm(0, 0.3, f) if f < 0.3 else tp[1] + (tp[2] - tp[1]) * sm(0.3, 1, f)
            wa += [min(255, int(round(c.width * wk * W_Q))), int(round(f * 255))]
            if i:
                acc += (c.p0[i] - c.p0[i - 1]).length if c.len0 > 0.02 else (c.p1[i] - c.p1[i - 1]).length
            vv.append(min(65535, int(round((c.v0 + acc / TILE) % 8.0 * V_Q))))
        cd += [n, c.col, int(c.rand * 255), int(round(c.ao * 255))]
        npts += n
    p = 's.%s.' % name
    blob.add(p + 'tri', np.array(tri, '<u2').tobytes())
    blob.add(p + 'bary', np.array(bary, '<u2').tobytes())
    blob.add(p + 'o0', np.array(o0, '<i2').tobytes())
    blob.add(p + 'o1', np.array(o1, '<i2').tobytes())
    blob.add(p + 'tn', np.array(tn, 'i1').tobytes())
    blob.add(p + 'wa', np.array(wa, 'u1').tobytes())
    blob.add(p + 'v', np.array(vv, '<u2').tobytes())
    blob.add(p + 'cards', np.array(cd, 'u1').tobytes())
    if mask:
        blob.add(p + 'mi', np.array(mask[0], '<u2').tobytes())
        blob.add(p + 'mw', np.array(mask[1], 'u1').tobytes())
    tris = sum(2 * (len(c.p0) - 1) for c in cards)
    return {'kind': kind, 'npts': npts, 'ncards': len(cards), 'tris': tris, 'mask': len(mask[0]) if mask else 0}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    B = Body(os.path.join(OUT, 'mh.bin.gz'))
    S = Styles(B)
    ctx = Ctx(B, 1)
    head = {'version': VERSION, 'ntri': B.ntri, 'offq': OFF_Q, 'vq': V_Q, 'wq': W_Q, 'cols': COLS, 'styles': {}}
    blob = Blob()
    old = None
    dst = os.path.join(OUT, 'hair.bin.gz')
    if only and os.path.isfile(dst):
        old = gzip.open(dst).read()
    for name in HAIR_STYLES:
        if only and name not in only and old:
            continue
        cards = getattr(S, name)(ctx)
        mask = scalp_mask(B, S.mask.pop(name, None) or region_scalp(0.03))
        if name == 'rapado':   # (shaved: the scalp shows through, the paint is lighter)
            mask = (mask[0], [int(w * 0.62) for w in mask[1]])
        head['styles'][name] = pack_style(B, blob, name, cards, 'hair', mask)
        print('%-9s %4d cards %5d tris' % (name, len(cards), head['styles'][name]['tris']))
    for name, (L0, L1) in BEARDS.items():
        key = 'beard_' + name
        if only and key not in only and name not in only and old:
            continue
        cards = S.beard(ctx, name, L0, L1, 2000 + len(name) * 37)
        head['styles'][key] = pack_style(B, blob, key, cards, 'beard', None)
        print('%-9s %4d cards %5d tris' % (key, len(cards), head['styles'][key]['tris']))
    # (styles not made again this time: copied from the file as they were)
    if old:
        hl = struct.unpack('<I', old[4:8])[0]
        oh = json.loads(old[8:8 + hl])
        st = 8 + hl
        for name, info in oh['styles'].items():
            if name in head['styles']:
                continue
            head['styles'][name] = info
            for k, (o, l) in oh['blobs'].items():
                if k.startswith('s.%s.' % name):
                    blob.add(k, old[st + o:st + o + l])
    head['blobs'] = blob.index
    hj = json.dumps(head, separators=(',', ':')).encode()
    hj += b' ' * ((-len(hj)) % 4)   # (the blobs start on a multiple of 4: typed arrays over them)
    data = b'MHH1' + struct.pack('<I', len(hj)) + hj + b''.join(blob.parts)
    with open(dst, 'wb') as fh:
        fh.write(gzip.compress(data, 9, mtime=0))
    print('hair.bin.gz: %d bytes (raw %d)' % (os.path.getsize(dst), len(data)))
    if '--no-tex' not in argv:
        w, h, rows = strand_texture()
        png_write_la(os.path.join(OUT, 'hair-strands.png'), w, h, rows)
        print('hair-strands.png: %d bytes' % os.path.getsize(os.path.join(OUT, 'hair-strands.png')))


main()
