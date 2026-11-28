"""mh_garments.py: the medieval clothes of the new creator (plan CR, P3), made by code on MakeHuman's base mesh (hm08) and
bound to its skin, for tools/mh_pack.py. Python 3 standard library only.

Each garment is lofted from rings: a ring is the convex hull of the body's own points in a thin slice (across the torso,
round both legs for a skirt, round one arm or one leg for a sleeve or a trouser leg, along the foot for a boot), widened
by the garment's ease, with folds where cloth hangs. So it bridges hollows as cloth does, and fits this body. Then every
garment vertex is bound to the nearest skin triangle: a barycentric point on it plus an offset along its normal (the
concept MakeHuman documents for its MHCLO clothes; our own code). The game rebuilds each garment on any body from those
numbers, so it follows weight, muscle, height, age and chest.

Per garment it also gives: the uv in metres (round and along, for the cloth's weave), the parts (0 its colour, 1 a second
colour: cuffs, collar, a belt's buckle), the distance to the nearest seam and to its border (for stitches and the frayed
hem), a little ambient occlusion in the folds, and the skin vertices it covers (the skin there is not drawn).
"""
import math

M = 0.1   # decimetres (MakeHuman's units) to metres


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    n = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def hull(pts):
    """Convex hull of 2D points (monotone chain), counter-clockwise."""
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts

    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and (out[-1][0] - out[-2][0]) * (p[1] - out[-2][1]) - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0]) <= 0:
                out.pop()
            out.append(p)
        return out
    lo, hi = half(pts), half(reversed(pts))
    return lo[:-1] + hi[:-1]


def hull_radius(h, cx, cy, ang):
    """Where the ray from (cx, cy) at ang leaves the hull h (its distance)."""
    dx, dy = math.cos(ang), math.sin(ang)
    best = None
    n = len(h)
    for i in range(n):
        x1, y1 = h[i]
        x2, y2 = h[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        wx, wy = x1 - cx, y1 - cy
        t = (wx * ey - wy * ex) / den
        u = (wx * dy - wy * dx) / den
        if t > 0 and -1e-9 <= u <= 1 + 1e-9:
            best = t if best is None else max(best, t)
    return best


class Body:
    """The base mesh with what the garments need: its vertices, triangles, regions (by the rig's CC0 weights) and joints."""

    def __init__(self, verts, faces, groups_faces, weights, nbody):
        self.v = verts
        self.nb = nbody
        self.tris = []
        for g, corners in faces:
            if g != 'body':
                continue
            ids = [c[0] for c in corners]
            for i in range(1, len(ids) - 1):
                self.tris.append((ids[0], ids[i], ids[i + 1]))
        self.joint = {}
        for name, fis in groups_faces.items():
            if name.startswith('joint-'):
                ids = set(c[0] for fi in fis for c in faces[fi][1])
                self.joint[name[6:]] = tuple(sum(verts[i][k] for i in ids) / len(ids) for k in range(3))
        # (each body vertex's region: the bones that weigh most on it, grouped)
        acc = [dict() for _ in range(len(verts))]   # (every vertex: the helpers are weighed too)
        group = {}
        for side in ('l', 'r'):
            for b in ('upperarm', 'lowerarm', 'hand', 'thumb_01', 'thumb_02', 'thumb_03', 'index_01', 'index_02', 'index_03', 'middle_01',
                      'middle_02', 'middle_03', 'ring_01', 'ring_02', 'ring_03', 'pinky_01', 'pinky_02', 'pinky_03'):
                group['%s_%s' % (b, side)] = 'arm_' + side
            for b in ('thigh', 'calf'):
                group['%s_%s' % (b, side)] = 'leg_' + side
            for b in ('foot', 'ball'):
                group['%s_%s' % (b, side)] = 'foot_' + side
        for b in ('head', 'neck_01'):
            group[b] = 'head'
        for bone, vw in weights.items():
            g = group.get(bone, 'torso')
            for vi, w in vw:
                acc[vi][g] = acc[vi].get(g, 0.0) + w
        self.region = [max(a, key=a.get) if a else 'torso' for a in acc]
        self.rw = acc
        ys = [verts[i][1] for i in range(nbody)]
        self.ground = min(ys)
        self.crotch = min(verts[i][1] for i in range(nbody) if abs(verts[i][0]) < 0.04 and -4 < verts[i][1] < 1)
        # (triangles by region, for binding a sleeve to its arm and a skirt to the legs)
        # (the surfaces the clothes are bound to: MakeHuman's own helpers, a smooth skin made for clothes. "tights" hugs the
        # body and the limbs; "skirt" hangs from the hips round both legs, for what hangs below them)
        self.surf = {}
        for sname, gname in (('tights', 'helper-tights'), ('skirt', 'helper-skirt')):
            tris = []
            for fi in groups_faces[gname]:
                ids = [c[0] for c in faces[fi][1]]
                for i in range(1, len(ids) - 1):
                    tris.append((ids[0], ids[i], ids[i + 1]))
            reg = [self.region[a] if self.region[a] == self.region[b] else (self.region[a] if self.region[a] == self.region[c] else self.region[b]) for a, b, c in tris]
            tn = [norm(cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]))) for a, b, c in tris]
            self.surf[sname] = (tris, reg, tn)
        # (and the skin itself, for what lies on the head: a headscarf; the helpers do not reach above the neck)
        reg = [self.region[a] if self.region[a] == self.region[b] else (self.region[a] if self.region[a] == self.region[c] else self.region[b]) for a, b, c in self.tris]
        self.surf['skin'] = (self.tris, reg, [norm(cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]))) for a, b, c in self.tris])

    def pts(self, regions):
        return [i for i in range(self.nb) if self.region[i] in regions]


# ---------- Rings and lofts ----------
def ring_slice(body, ids, origin, axis, e1, e2, t, band):
    """The 2D points (in e1, e2) of the body vertices ids within band of the plane through origin + axis * t."""
    out = []
    for i in ids:
        p = body.v[i]
        d = sub(p, origin)
        if abs(dot(d, axis) - t) <= band:
            out.append((dot(d, e1), dot(d, e2)))
    return out


class Loft:
    """A tube of rings along an axis: per ring its centre, frame and radius per angle; lofted into a mesh."""

    def __init__(self, name, nseg):
        self.name = name
        self.nseg = nseg
        self.rings = []   # (centre, e1, e2, axis, radii[nseg], along (dm), meta)

    def add_ring(self, centre, e1, e2, axis, radii, along, meta=None):
        self.rings.append((centre, e1, e2, axis, radii, along, meta or {}))

    def point(self, k, j):
        c, e1, e2, axis, radii, along, meta = self.rings[k]
        a = 2 * math.pi * j / self.nseg
        r = radii[j % self.nseg]
        return add(c, add(mul(e1, r * math.cos(a)), mul(e2, r * math.sin(a))))


def frame(axis):
    """Two unit vectors across an axis: e1 toward the person's front (+z) as far as it can, e2 = axis x e1."""
    up = (0.0, 0.0, 1.0) if abs(axis[2]) < 0.9 else (1.0, 0.0, 0.0)
    e1 = norm(sub(up, mul(axis, dot(up, axis))))
    e2 = norm(cross(axis, e1))
    return e1, e2


def section(body, ids, origin, axis, t, band, nseg, ease, flare=0.0, folds=None, centre_of=None):
    """One ring: the hull of the slice, its radius at nseg angles (from the hull's own centre unless given), plus ease."""
    e1, e2 = frame(axis)
    pts = ring_slice(body, ids, origin, axis, e1, e2, t, band)
    if len(pts) < 3:
        return None
    h = hull(pts)
    if len(h) < 3:
        return None
    cx = sum(p[0] for p in h) / len(h)
    cy = sum(p[1] for p in h) / len(h)
    if centre_of is not None:
        cx, cy = centre_of
    radii = []
    for j in range(nseg):
        a = 2 * math.pi * j / nseg
        r = hull_radius(h, cx, cy, a)
        if r is None:
            r = max(math.hypot(p[0] - cx, p[1] - cy) for p in h)
        r += ease + flare
        if folds:
            k, amp, ph = folds
            r += amp * (0.5 + 0.5 * math.sin(k * a + ph))
        radii.append(r)
    centre = add(origin, add(mul(axis, t), add(mul(e1, cx), mul(e2, cy))))
    return centre, e1, e2, radii


def smooth_radii(loft, passes=2):
    """Soften each ring round itself and between rings (the hulls of thin slices jump)."""
    for _ in range(passes):
        new = []
        for k, ring in enumerate(loft.rings):
            r = ring[4]
            n = len(r)
            rr = [(r[(j - 1) % n] + 2 * r[j] + r[(j + 1) % n]) / 4 for j in range(n)]
            new.append(rr)
        for k in range(len(loft.rings)):
            if 0 < k < len(loft.rings) - 1 and not loft.rings[k][6].get('keep'):
                a, b = new[k - 1], new[k + 1]
                new[k] = [(a[j] + 2 * new[k][j] + b[j]) / 4 for j in range(len(new[k]))]
        loft.rings = [ring[:4] + (new[k],) + ring[5:] for k, ring in enumerate(loft.rings)]


# ---------- The mesh of a garment ----------
class Garment:
    def __init__(self, name):
        self.name = name
        self.v = []        # bound vertices (base frame, dm)
        self.rv = []       # render vertices: (vertex, u, v (metres), part, seam (m), edge (m), ao)
        self.tri = []      # triangles of render vertices
        self.region = []   # per bound vertex: the skin regions it may bind to, and the surface ('tights' or 'skirt')
        self.cover = set() # skin vertices it covers

    def loft(self, L, regions, part_of=None, seams=(), u_scale=None, open_front=None, cap_end=False, slit=None, open_top=False, open_of=None):
        """Adds a loft as a ring mesh. seams: angles (radians) with a seam down them. open_front: half width (radians) of a
        front opening (a vest), none if None. part_of(k, j) -> part. open_top: its first ring is sewn on to something (a
        yoke): no hem there."""
        nseg, nr = L.nseg, len(L.rings)
        base = len(self.v)
        for k in range(nr):
            for j in range(nseg):
                self.v.append(L.point(k, j))
                self.region.append((regions, L.rings[k][6].get('surface', 'tights')))
        # (along: from the first ring; round: the ring's arc in metres, the same u for every ring of the column)
        mean_r = sum(sum(r[4]) / nseg for r in L.rings) / nr
        alongs = [r[5] for r in L.rings]
        rbase = len(self.rv)
        t0 = len(self.tri)
        skip = set()
        if open_front is not None:
            skip = {j for j in range(nseg) if abs(math.atan2(math.sin(2 * math.pi * j / nseg), math.cos(2 * math.pi * j / nseg))) < open_front}
        for k in range(nr):
            for j in range(nseg + 1):
                a = 2 * math.pi * j / nseg
                seam = min([abs(math.atan2(math.sin(a - s), math.cos(a - s))) * mean_r * M for s in seams] + [9.0])
                edge = (abs(alongs[-1] - alongs[k]) if open_top else min(abs(alongs[k] - alongs[0]), abs(alongs[-1] - alongs[k]))) * M
                if open_front is not None:
                    da = abs(math.atan2(math.sin(a), math.cos(a))) - open_front
                    edge = min(edge, max(0.0, da) * mean_r * M)
                self.rv.append([base + k * nseg + (j % nseg), a * mean_r * M, alongs[k] * M, part_of(k, j) if part_of else 0, seam, edge, 1.0])
        for k in range(nr - 1):
            for j in range(nseg):
                if j in skip or ((j + 1) % nseg) in skip:   # (a vest's front opening)
                    continue
                if open_of and any(abs(math.atan2(math.sin(2 * math.pi * jj / nseg), math.cos(2 * math.pi * jj / nseg))) < open_of(kk) for kk in (k, k + 1) for jj in (j, j + 1)):
                    continue   # (an opening whose width changes ring by ring: the face in a headscarf)
                if slit and k < slit[0] and (abs(math.atan2(math.sin(2 * math.pi * j / nseg), math.cos(2 * math.pi * j / nseg))) < slit[1] or abs(math.atan2(math.sin(2 * math.pi * (j + 1) / nseg), math.cos(2 * math.pi * (j + 1) / nseg))) < slit[1]):
                    continue   # (a shirt's slit at the neck)
                a = rbase + k * (nseg + 1) + j
                b = a + 1
                c = a + nseg + 1
                d = c + 1
                self.tri += [(a, c, b), (b, c, d)]
        self.outward(t0, L)
        if cap_end:
            # (a fan closing the last ring: a boot's toe)
            ce = L.rings[-1][0]
            self.v.append(ce)
            self.region.append((regions, 'tights'))
            cid = len(self.rv)
            self.rv.append([len(self.v) - 1, 0.0, alongs[-1] * M + 0.01, part_of(nr - 1, 0) if part_of else 0, 9.0, 0.03, 1.0])
            last = rbase + (nr - 1) * (nseg + 1)
            fan = [(last + j, cid, last + j + 1) for j in range(nseg)]
            # (facing out of the end, along the loft: seen from inside, the toe looked like a hole)
            out_ = sub(ce, L.rings[-2][0]) if nr > 1 else (0.0, 0.0, 1.0)
            n_ = [0.0, 0.0, 0.0]
            for t in fan:
                a_, b_, c_ = (self.v[self.rv[i][0]] for i in t)
                n_ = add(n_, cross(sub(b_, a_), sub(c_, a_)))
            if dot(n_, out_) < 0:
                fan = [(a_, c_, b_) for a_, b_, c_ in fan]
            self.tri += fan
        return self

    def outward(self, t0, L):
        """Turns the triangles added since t0 to face out of the loft (its rings may run either way along the axis)."""
        votes = 0
        for t in self.tri[t0:t0 + 40]:
            a, b, c = (self.v[self.rv[i][0]] for i in t)
            n = cross(sub(b, a), sub(c, a))
            mid = mul(add(add(a, b), c), 1 / 3)
            k = min(range(len(L.rings)), key=lambda k: math.dist(L.rings[k][0], mid))
            votes += 1 if dot(n, sub(mid, L.rings[k][0])) > 0 else -1
        if votes < 0:
            self.tri[t0:] = [(a, c, b) for a, b, c in self.tri[t0:]]

    def patch(self, body, verts_of, tris, top, ease, regions, seams=(), slit=None, collar=0.12, cut=None, arm_cut=None, slit_z=0.0):
        """A garment piece that is the skin's own helper surface pushed out by ease (the yoke over the shoulders: it falls
        from the collar to the shoulder as the body does). tris: helper triangles to take; vertices above top come down to it
        (a round neckline); slit: (depth, half angle) of a slit at the front of the neck; collar: the band of part 1; ease: a
        number or per helper vertex. Its borders are cut clean, not along the triangles' teeth: level at y = cut, across each
        arm by arm_cut {side: (point, axis)} (kept towards the shoulder), and down the slit's two sides."""
        v = body.v
        ease_of = ease if callable(ease) else (lambda i: ease)
        used = sorted({i for t in tris for i in t})
        nrm = {i: [0.0, 0.0, 0.0] for i in used}
        for a_, b_, c_ in tris:
            n = cross(sub(v[b_], v[a_]), sub(v[c_], v[a_]))
            for i in (a_, b_, c_):
                nrm[i][0] += n[0]; nrm[i][1] += n[1]; nrm[i][2] += n[2]
        mean_r = sum(math.hypot(v[i][0], v[i][2]) for i in used) / len(used)
        pos = {}
        for i in used:
            n = norm(tuple(nrm[i]))
            p = add(v[i], mul(n, ease_of(i)))
            if p[1] > top:   # (the neckline: a level ring round the neck)
                p = (p[0], top, p[2])
            pos[i] = p
        # (the planes each triangle is cut by: (origin, normal), the side kept is where the normal points)
        def planes_of(t):
            pts = [pos[i] for i in t]
            c = mul(add(add(pts[0], pts[1]), pts[2]), 1 / 3)
            out_ = []
            if cut is not None:
                out_.append(('cut', (0.0, cut, 0.0), (0.0, 1.0, 0.0)))
            if arm_cut and any(body.region[i].startswith('arm') for i in t):
                side = next(body.region[i][-1] for i in t if body.region[i].startswith('arm'))
                o, ax = arm_cut[side]
                out_.append(('arm' + side, o, mul(ax, -1.0)))
            if slit and c[2] > slit_z and top - c[1] < slit[0]:   # (its sides: planes through the body's axis at slit_z)
                sg = 1.0 if c[0] >= 0 else -1.0
                out_.append(('slit%d' % sg, (0.0, 0.0, slit_z), (sg * math.cos(slit[1]), 0.0, -math.sin(slit[1]))))
            return out_
        verts = {}   # (key) -> render vertex
        name_of = lambda key: key[0] if isinstance(key[0], str) else ''
        def vert(key, p, border):
            if key in verts:
                return verts[key]
            self.v.append(p)
            self.region.append((regions, 'tights'))
            a = math.atan2(p[0], p[2])
            seam = min([abs(math.atan2(math.sin(a - s_), math.cos(a - s_))) * mean_r * M for s_ in seams] + [9.0])
            edge = 0.0 if border else (top - p[1]) * M
            if border and name_of(key).startswith('cut'):
                edge = (top - p[1]) * M   # (the lower border is sewn on to the loft below: no hem there)
            # (u: across, the front and the back apart at the side seams, where the cloth is cut anyway)
            u = p[0] * M if p[2] >= 0.1 else 1.0 - p[0] * M
            verts[key] = len(self.rv)
            # (the collar's band: its part as a fraction, linear in the height, so its border is a level line between the vertices
            # and not the triangles' teeth)
            part = max(0.0, min(1.0, 0.5 + (collar - (top - p[1])) * 2.5)) if collar > 0 else 0
            self.rv.append([len(self.v) - 1, u, (top - p[1]) * M, part, seam, edge, 1.0])
            return verts[key]
        t0 = len(self.tri)
        for t in tris:
            # (a polygon of (key, position, on a border), clipped plane by plane)
            poly = [((i,), pos[i], False) for i in t]
            for name, o, n in planes_of(t):
                d = [dot(sub(q[1], o), n) for q in poly]
                nxt = []
                for k in range(len(poly)):
                    q0, q1, d0, d1 = poly[k], poly[(k + 1) % len(poly)], d[k], d[(k + 1) % len(poly)]
                    if d0 >= 0:
                        nxt.append(q0)
                    if (d0 >= 0) != (d1 >= 0):
                        f = d0 / (d0 - d1)
                        key = (name,) + tuple(sorted((q0[0], q1[0]), key=repr))
                        nxt.append((key, lerp3(q0[1], q1[1], f), True))
                poly = nxt
                if len(poly) < 3:
                    break
            if len(poly) < 3:
                continue
            ids = [vert(q[0], q[1], q[2]) for q in poly]
            for k in range(1, len(ids) - 1):
                self.tri.append((ids[0], ids[k], ids[k + 1]))
        # (facing out: the helper's triangles already do; check one against the outward direction from the body's axis)
        if self.tri[t0:]:
            a, b, c = (self.v[self.rv[i][0]] for i in self.tri[t0])
            n = cross(sub(b, a), sub(c, a))
            mid = mul(add(add(a, b), c), 1 / 3)
            if dot(n, (mid[0], 0.0, mid[2] - 0.1)) < 0:
                self.tri[t0:] = [(a, c, b) for a, b, c in self.tri[t0:]]
        return self

    def ao_folds(self):
        """A little darker in the hollows: each vertex by how far inside the mean of its neighbours it lies."""
        nb = {}
        for t in self.tri:
            for i in range(3):
                a, b = self.rv[t[i]][0], self.rv[t[(i + 1) % 3]][0]
                nb.setdefault(a, set()).add(b)
                nb.setdefault(b, set()).add(a)
        # (along the surface's normal only: at a border the neighbours all lie to one side, which is not a hollow)
        vn = {}
        for t in self.tri:
            a_, b_, c_ = (self.v[self.rv[i][0]] for i in t)
            n = cross(sub(b_, a_), sub(c_, a_))
            for i in t:
                q = vn.setdefault(self.rv[i][0], [0.0, 0.0, 0.0])
                q[0] += n[0]; q[1] += n[1]; q[2] += n[2]
        occ = {}
        for i, ns in nb.items():
            c = [sum(self.v[j][k] for j in ns) / len(ns) for k in range(3)]
            d = sub(self.v[i], c)
            n = norm(tuple(vn.get(i, (0.0, 0.0, 1.0)))) if any(vn.get(i, (0, 0, 0))) else (0.0, 0.0, 0.0)
            occ[i] = abs(dot(d, n))
        for r in self.rv:
            r[6] = max(0.5, 1.0 - occ.get(r[0], 0.0) * 2.4)


    def skin_patch(self, body, tris, ease_of, regions, clips, uv_of, part_of=None, surface='tights'):
        """A piece that is a surface of the body (a helper's or the skin's own triangles) pushed out along its normals by
        ease_of(i, p), cut clean by clips: (name, f) with f(p) the signed distance (dm) to the cut, kept where it is >= 0.
        Its border's hem is where a clip passes; uv_of(p) gives the cloth's uv (metres), part_of(p) its part (0..1)."""
        v = body.v
        used = sorted({i for t in tris for i in t})
        nrm = {i: [0.0, 0.0, 0.0] for i in used}
        for a_, b_, c_ in tris:
            n = cross(sub(v[b_], v[a_]), sub(v[c_], v[a_]))
            for i in (a_, b_, c_):
                nrm[i][0] += n[0]; nrm[i][1] += n[1]; nrm[i][2] += n[2]
        pos = {i: add(v[i], mul(norm(tuple(nrm[i])), ease_of(i, v[i]))) for i in used}
        verts = {}
        def vert(key, p):
            if key in verts:
                return verts[key]
            self.v.append(p)
            self.region.append((regions, surface))
            u, w = uv_of(p)
            edge = min([max(0.0, f(p)) for _, f in clips] + [9.0]) * M
            verts[key] = len(self.rv)
            self.rv.append([len(self.v) - 1, u, w, part_of(p) if part_of else 0, 9.0, edge, 1.0])
            return verts[key]
        for t in tris:
            poly = [((i,), pos[i]) for i in t]
            for name, f in clips:
                d = [f(q[1]) for q in poly]
                if min(d) >= 0:
                    continue
                nxt = []
                for k in range(len(poly)):
                    q0, q1, d0, d1 = poly[k], poly[(k + 1) % len(poly)], d[k], d[(k + 1) % len(poly)]
                    if d0 >= 0:
                        nxt.append(q0)
                    if (d0 >= 0) != (d1 >= 0):
                        fr = d0 / (d0 - d1)
                        nxt.append(((name,) + tuple(sorted((q0[0], q1[0]), key=repr)), lerp3(q0[1], q1[1], fr)))
                poly = nxt
                if len(poly) < 3:
                    break
            if len(poly) < 3:
                continue
            ids = [vert(q[0], q[1]) for q in poly]
            for k in range(1, len(ids) - 1):
                self.tri.append((ids[0], ids[k], ids[k + 1]))
        return self

    def clip_tris(self, t0, name, f):
        """Cuts the triangles added since t0 clean where f (on their bound vertices, the signed distance in dm) is under 0:
        a smooth opening in a loft (the face in a headscarf), not the rings' teeth. New vertices take the mean of their two
        ends (uv, part, seam, occlusion), on the border."""
        tris, self.tri, made = self.tri[t0:], self.tri[:t0], {}
        def cut(a, b, fa, fb):
            key = (name, min(a, b), max(a, b))
            if key in made:
                return made[key]
            fr = fa / (fa - fb)
            ra, rb = self.rv[a], self.rv[b]
            self.v.append(lerp3(self.v[ra[0]], self.v[rb[0]], fr))
            self.region.append(self.region[ra[0]])
            r = [len(self.v) - 1] + [lerp(ra[k], rb[k], fr) for k in range(1, 7)]
            r[5] = 0.0
            self.rv.append(r)
            made[key] = len(self.rv) - 1
            return made[key]
        val = {}
        for t in tris:
            d = [val.setdefault(i, f(self.v[self.rv[i][0]])) for i in t]
            if min(d) >= 0:
                self.tri.append(t)
                continue
            poly = []
            for k in range(3):
                a, b, da, db = t[k], t[(k + 1) % 3], d[k], d[(k + 1) % 3]
                if da >= 0:
                    poly.append(a)
                if (da >= 0) != (db >= 0):
                    poly.append(cut(a, b, da, db))
            for k in range(1, len(poly) - 1):
                self.tri.append((poly[0], poly[k], poly[k + 1]))
        return self

    def hem_from_border(self, k0=0):
        """The distance of each render vertex (from k0 on) to the piece's border (edges of one triangle only), in metres:
        for the hem's stitches and the frayed edge, whatever shape the piece has."""
        count = {}
        for t in self.tri:
            for e in range(3):
                a, b = self.rv[t[e]][0], self.rv[t[(e + 1) % 3]][0]
                key = (min(a, b), max(a, b))
                count[key] = count.get(key, 0) + 1
        border = list({i for (a, b), n in count.items() if n == 1 for i in (a, b)})
        if not border:
            return self
        cell, grid = 0.3, {}
        for i in border:
            p = self.v[i]
            grid.setdefault(tuple(int(math.floor(p[c] / cell)) for c in range(3)), []).append(p)
        for r in self.rv[k0:]:
            p = self.v[r[0]]
            c0 = tuple(int(math.floor(p[c] / cell)) for c in range(3))
            best = 9.0
            for rad in (1, 2, 4, 8):
                for dx in range(-rad, rad + 1):
                    for dy in range(-rad, rad + 1):
                        for dz in range(-rad, rad + 1):
                            for q in grid.get((c0[0] + dx, c0[1] + dy, c0[2] + dz), ()):
                                best = min(best, math.dist(p, q))
                if best < rad * cell:
                    break
            r[5] = min(r[5], best * M)
        return self


# ---------- Binding to the skin ----------
class Binder:
    """Binds to one surface of the body (its triangles, their regions and normals)."""

    def __init__(self, body, surface):
        self.b = body
        self.tris, self.tri_region, self.tri_n = body.surf[surface]
        self.cell = 0.5
        self.grid = {}
        v = body.v
        for ti, (a, b, c) in enumerate(self.tris):
            cx = (v[a][0] + v[b][0] + v[c][0]) / 3
            cy = (v[a][1] + v[b][1] + v[c][1]) / 3
            cz = (v[a][2] + v[b][2] + v[c][2]) / 3
            key = (int(math.floor(cx / self.cell)), int(math.floor(cy / self.cell)), int(math.floor(cz / self.cell)))
            self.grid.setdefault(key, []).append(ti)

    def closest(self, p, a, b, c):
        """Distance from p to the triangle abc (squared), for choosing."""
        ab, ac, ap = sub(b, a), sub(c, a), sub(p, a)
        d1, d2 = dot(ab, ap), dot(ac, ap)
        if d1 <= 0 and d2 <= 0:
            q = a
        else:
            bp = sub(p, b)
            d3, d4 = dot(ab, bp), dot(ac, bp)
            if d3 >= 0 and d4 <= d3:
                q = b
            else:
                vc = d1 * d4 - d3 * d2
                if vc <= 0 and d1 >= 0 and d3 <= 0:
                    q = add(a, mul(ab, d1 / (d1 - d3)))
                else:
                    cp = sub(p, c)
                    d5, d6 = dot(ab, cp), dot(ac, cp)
                    if d6 >= 0 and d5 <= d6:
                        q = c
                    else:
                        vb = d5 * d2 - d1 * d6
                        if vb <= 0 and d2 >= 0 and d6 <= 0:
                            q = add(a, mul(ac, d2 / (d2 - d6)))
                        else:
                            va = d3 * d6 - d5 * d4
                            if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
                                q = add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))))
                            else:
                                den = 1.0 / (va + vb + vc)
                                q = add(a, add(mul(ab, vb * den), mul(ac, vc * den)))
        d = sub(p, q)
        return dot(d, d), q

    def _proj_unused(self, p, ti):
        """p projected along the normal of triangle ti: (barycentric, offset)."""
        v, b = self.b.v, self.b
        ta, tb, tc = self.tris[ti]
        A, B, C = v[ta], v[tb], v[tc]
        n = self.tri_n[ti]
        off = dot(sub(p, A), n)
        q = sub(p, mul(n, off))
        v0, v1, v2 = sub(B, A), sub(C, A), sub(q, A)
        d00, d01, d11, d20, d21 = dot(v0, v0), dot(v0, v1), dot(v1, v1), dot(v2, v0), dot(v2, v1)
        den = d00 * d11 - d01 * d01 or 1e-12
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        return (1 - wb - wc, wb, wc), off

    def bind(self, p, regions):
        """The nearest skin triangle of those regions: the nearest point on it (its barycentric weights, inside it) and the
        offset from there to p in the triangle's own frame (along its first edge, across, along its normal). Rebuilt
        exactly at rest, and stable as the body changes: the weights never reach out, and the offset turns with the skin."""
        b, v = self.b, self.b.v
        cx, cy, cz = (int(math.floor(p[k] / self.cell)) for k in range(3))
        near, nd, nq = None, 1e18, None
        for rad in (1, 2, 3, 5, 8):
            for i in range(cx - rad, cx + rad + 1):
                for j in range(cy - rad, cy + rad + 1):
                    for k in range(cz - rad, cz + rad + 1):
                        for ti in self.grid.get((i, j, k), ()):
                            if regions and self.tri_region[ti] not in regions:
                                continue
                            ta, tb, tc = self.tris[ti]
                            d, q = self.closest(p, v[ta], v[tb], v[tc])
                            if d < nd:
                                nd, near, nq = d, ti, q
            if near is not None and math.sqrt(nd) < rad * self.cell:
                break
        ta, tb, tc = self.tris[near]
        A, B, C = v[ta], v[tb], v[tc]
        v0, v1, v2 = sub(B, A), sub(C, A), sub(nq, A)
        d00, d01, d11, d20, d21 = dot(v0, v0), dot(v0, v1), dot(v1, v1), dot(v2, v0), dot(v2, v1)
        den = d00 * d11 - d01 * d01 or 1e-12
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        n = self.tri_n[near]
        e1 = norm(v0)
        e2 = cross(n, e1)
        o = sub(p, nq)
        return (ta, tb, tc), (1 - wb - wc, wb, wc), (dot(o, e1), dot(o, e2), dot(o, n))


# ---------- The wardrobe ----------
def wardrobe(body):
    """The garments: name -> Garment. Heights from the base mesh's joints (decimetres)."""
    J, v = body.joint, body.v
    neck, sh_y = J['neck'][1], J['l-shoulder'][1]
    waist = lerp(J['pelvis'][1], J['spine-3'][1], 0.75)
    crotch, knee, ankle, ground = body.crotch, J['l-knee'][1], J['l-ankle'][1], body.ground
    # (the torso with the top of the shoulders: the arm's own vertices round the shoulder joint, so the shoulder seam sits
    # over the deltoid, not inside it)
    torso_ids = body.pts({'torso'}) + [i for side in ('l', 'r') for i in body.pts({'arm_' + side})
                                       if math.dist(v[i], J['%s-shoulder' % side]) < 0.75 and v[i][1] > J['%s-shoulder' % side][1] - 0.35]
    head_ids = body.pts({'head'})
    neck_ids = [i for i in head_ids if v[i][1] < neck + 0.25]
    legs_ids = body.pts({'leg_l', 'leg_r', 'torso'})
    UP = (0.0, 1.0, 0.0)
    out = {}

    def torso_loft(name, top, hem, ease, nseg=28, flare=0.0, fold_amp=0.0, rings=None, band=0.12, blouse=0.0, join=None):
        """A loft down the body: torso slices to the crotch, then round both legs (a skirt), widening below the hips. Over
        the shoulders the rings are close and thin, so the cloth slopes from the neck to the shoulder as it does; with blouse,
        the cloth puffs a little over the belt and gathers under it; the skirt hangs in folds that wander and widen down."""
        L = Loft(name, nseg)
        # (rings 1.4 cm apart over the shoulders, 2.8 cm where the body turns, 4.5 cm on a skirt)
        if rings:
            ys = [lerp(top, hem, k / rings) for k in range(rings + 1)]
        else:
            ys, y = [], top
            while y > hem:
                ys.append(y)
                y -= 0.14 if y > sh_y - 0.45 else 0.28 if y > waist - 0.6 else 0.62
            ys.append(hem)
        # (each ring's centre, from a first look at its slice, smoothed down the loft: a jumpy centre makes a zigzag)
        cents = []
        for y in ys:
            idsc = legs_ids if y < waist - 0.3 else torso_ids + neck_ids
            sc = section(body, idsc, (0.0, 0.0, 0.0), UP, y, band, 8, 0.0)
            cents.append(None if sc is None else (sc[0][2], sc[0][0]))
        known = [c for c in cents if c]
        cents = [c or known[0] for c in cents]
        smooth_c = []
        for k in range(len(cents)):
            win = cents[max(0, k - 3):k + 4]
            smooth_c.append((sum(c[0] for c in win) / len(win), sum(c[1] for c in win) / len(win)))
        for y, centre in zip(ys, smooth_c):
            under = y < waist - 0.3   # (from the hips down: round the legs and the seat together)
            ids = legs_ids if under else torso_ids + neck_ids
            depth = max(0.0, (waist - 0.6 - y) / max(0.1, waist - 0.6 - hem))   # (0 at the hips, 1 at the hem)
            # (over the shoulders the cloth stands off a little: the shoulders move with the arms)
            over = min(1.0, max(0.0, (y - (sh_y - 0.7)) / 0.8))
            puff = blouse * (math.exp(-((y - (waist + 0.32)) / 0.28) ** 2) - 0.45 * math.exp(-((y - waist) / 0.12) ** 2))
            thin = y > sh_y - 0.45
            s = section(body, ids, (0.0, 0.0, 0.0), UP, y, 0.07 if thin else band, nseg, ease + flare * depth * depth + puff, centre_of=centre)
            if s is None:
                continue
            c, e1, e2, radii = s
            # (the folds: two waves round, their crests drifting as they go down, deeper toward the hem; and gathers by the belt)
            amp = fold_amp * depth
            gather = blouse * 0.5 * math.exp(-((y - (waist - 0.25)) / 0.3) ** 2)
            if amp or gather:
                ph = 0.7 + 0.9 * math.sin(y * 0.9) + 0.4 * math.sin(y * 2.3)
                for j in range(nseg):
                    a = 2 * math.pi * j / nseg
                    f = 0.6 * (0.5 + 0.5 * math.sin(9 * a + ph)) + 0.4 * (0.5 + 0.5 * math.sin(5 * a - 1.7 * ph))
                    radii[j] += amp * f + gather * (0.5 + 0.5 * math.sin(14 * a + 2.1))
            L.add_ring(c, e1, e2, UP, radii, top - y, {'surface': 'skirt' if y < crotch - 0.3 else 'tights'})
        smooth_radii(L)
        # (sewn on to a yoke: the first ring is the yoke's lower border, a hair inside it; the difference is carried down and
        # fades over 20 cm, so the cloth goes on from the yoke without a crease)
        if join:
            c0 = L.rings[0][0]
            shift = [None if r is None else r - 0.004 - L.rings[0][4][j] for j, r in enumerate(join(c0, 2 * math.pi * j / nseg) for j in range(nseg))]
            for c, e1, e2, axis, radii, along, meta in L.rings:
                w = smooth(0.0, 2.0, along)
                for j in range(nseg):
                    if shift[j] is not None:
                        radii[j] += shift[j] * (1.0 - w)
        return L

    def limb_loft(name, a, b, c, t0, t1, ease, ids, nseg=14, rings=12, flare=0.0, cuff=0.0, band=0.14, crease=0.0, bunch=0.0):
        """A loft along a limb (joints a -> b -> c): from t0 to t1 of its length (0 at a, 1 at c). crease: the cloth's
        wrinkles round the middle joint (elbow, knee); bunch: gathered toward the end (a cuff, the ankle)."""
        L = Loft(name, nseg)
        l1 = math.dist(a, b)
        l2 = math.dist(b, c)
        total = l1 + l2
        d1, d2 = norm(sub(b, a)), norm(sub(c, b))
        for k in range(rings + 1):
            t = lerp(t0, t1, k / rings)
            d = t * total
            p = add(a, mul(d1, d)) if d <= l1 else add(b, mul(d2, d - l1))
            # (the axis turns smoothly round the joint)
            w = min(1.0, max(0.0, (d - (l1 - 0.15 * total)) / (0.3 * total)))
            ax = norm(lerp3(d1, d2, w))
            s = section(body, ids, p, ax, 0.0, band, nseg, ease + flare * (t - t0) / max(1e-6, t1 - t0))
            if s is None:
                continue
            cc, e1, e2, radii = s
            if cuff and k == rings:
                radii = [r + cuff for r in radii]
            nearj = math.exp(-((d - l1) / (0.09 * total)) ** 2)
            endj = max(0.0, (t - (t1 - 0.2)) / 0.2)
            if crease or bunch:
                for j in range(nseg):
                    an = 2 * math.pi * j / nseg
                    radii[j] += crease * nearj * (0.5 + 0.5 * math.sin(2 * an + 1.9 * k)) + bunch * endj * (0.5 + 0.5 * math.sin(3 * an + 2.3 * k))
            L.add_ring(cc, e1, e2, ax, radii, d)
        smooth_radii(L, 1)
        return L

    def sleeves(g, ease, t1=0.97, flare=0.12, part_cuff=True):
        for side in ('l', 'r'):
            a, b, c = J['%s-shoulder' % side], J['%s-elbow' % side], J['%s-hand' % side]
            a = lerp3(J['%s-clavicle' % side], a, 0.72)
            ids = body.pts({'arm_' + side})
            L = limb_loft('sleeve_' + side, a, b, c, 0.0, t1, ease, ids, flare=flare, rings=18, crease=0.07, bunch=0.06)
            n = len(L.rings)
            g.loft(L, {'arm_' + side, 'torso'}, part_of=(lambda k, j, n=n: 1 if part_cuff and k >= n - 2 else 0), seams=(math.pi,))

    def cover(g, test):
        for i in range(body.nb):
            if test(i, v[i], body.region[i]):
                g.cover.add(i)

    def arm_t(i, side):
        a = lerp3(J['%s-clavicle' % side], J['%s-shoulder' % side], 0.72)
        b, c = J['%s-elbow' % side], J['%s-hand' % side]
        l1, l2 = math.dist(a, b), math.dist(b, c)
        p = v[i]
        t1 = dot(sub(p, a), norm(sub(b, a))) / (l1 + l2)
        t2 = (l1 + dot(sub(p, b), norm(sub(c, b)))) / (l1 + l2)
        return t1 if t1 * (l1 + l2) <= l1 else t2

    SIDES = (-math.pi / 2, math.pi / 2)
    tights_tris, tights_reg, _ = body.surf['tights']

    def yoke_tris(top, bottom, arm=1.0):
        """The helper's triangles over the shoulders: torso and neck, and the arm's only round the shoulder cap."""
        out_ = []
        for t, reg in zip(tights_tris, tights_reg):
            ys = [v[i][1] for i in t]
            if max(ys) < bottom or min(ys) > top + 0.35:
                continue
            ok = True
            for i in t:
                r = body.region[i]
                if r.startswith('arm'):
                    side = r[-1]
                    if math.dist(v[i], J['%s-shoulder' % side]) > arm or v[i][1] < J['%s-shoulder' % side][1] - 0.45:
                        ok = False
                elif r not in ('torso', 'head'):
                    ok = False
                elif r == 'head' and v[i][1] > top + 0.35:
                    ok = False
            if ok:
                out_.append(t)
        return out_

    YOKE_CUT = sh_y - 0.8      # (where the body of a garment is sewn on to its yoke: the yoke goes on 4 mm under it, over it)
    YOKE_BOTTOM = YOKE_CUT - 0.2

    def arm_cut(d):
        """Across each arm, d along it from the shoulder: where the yoke's shoulder cap ends."""
        out_ = {}
        for side in ('l', 'r'):
            sh, el = J['%s-shoulder' % side], J['%s-elbow' % side]
            ax = norm(sub(el, sh))
            out_[side] = (add(sh, mul(ax, d)), ax)
        return out_

    def border_of(g, t0, y):
        """The yoke's lower border (its edges level at y, from triangle t0 on) as a function: from a ring's centre, at an
        angle round it (0 to the front, pi/2 to +x), how far the border is (None where there is none: an open front)."""
        segs = []
        for t in g.tri[t0:]:
            for k in range(3):
                pa, pb = g.v[g.rv[t[k]][0]], g.v[g.rv[t[(k + 1) % 3]][0]]
                if abs(pa[1] - y) < 1e-6 and abs(pb[1] - y) < 1e-6:
                    segs.append(((pa[0], pa[2]), (pb[0], pb[2])))
        def f(c, a):
            ox, oz, dx, dz = c[0], c[2], math.sin(a), math.cos(a)
            best = None
            for (ax_, az), (bx, bz) in segs:
                ex, ez = bx - ax_, bz - az
                den = dx * ez - dz * ex
                if abs(den) < 1e-12:
                    continue
                t = ((ax_ - ox) * ez - (az - oz) * ex) / den
                u = ((ax_ - ox) * dz - (az - oz) * dx) / den
                if t > 0 and -1e-6 <= u <= 1 + 1e-6 and (best is None or t > best):
                    best = t
            return best
        return f


    def yoke_ease_of(full, low_body, low_arm=None, arm=1.0):
        """The yoke's ease per helper vertex: full over the shoulders, down to low_body at its lower border, where the body
        of the garment is sewn on (a hair over it), and to low_arm where the sleeve goes in under its shoulder cap."""
        low_arm = low_body if low_arm is None else low_arm
        def f(i):
            p, r = v[i], body.region[i]
            k = smooth(YOKE_CUT, sh_y - 0.46, p[1])
            if r.startswith('arm'):
                sh = J['%s-shoulder' % r[-1]]
                ka = smooth(arm * 0.75, arm * 0.45, math.dist(p, sh))
                return lerp(low_arm, lerp(low_body, full, k), ka)
            return lerp(low_body, full, k)
        return f

    # --- shirt (camisa): neck to the hips, long sleeves with cuffs, a collar band
    def shirt(name, hem, ease, sleeve_ease, collar=True, fold=0.0, flare=0.0, extra_rings=None, blouse=0.0, yoke_ease=0.15, nseg=28, sleeve=0.97):
        yoke_ease_fn = yoke_ease_of
        g = Garment(name)
        top = neck - 0.04   # (a round neck at the base of the neck, with a short slit in front)
        # (the yoke: the shoulders and the neckline, following the body; the rest lofted from under it, overlapping it)
        t0 = len(g.tri)
        g.patch(body, v, yoke_tris(top, YOKE_BOTTOM), top, yoke_ease_fn(yoke_ease, ease + 0.005, sleeve_ease + 0.005), {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, slit=(0.6, 0.13), collar=0.0, cut=YOKE_CUT - 0.04, arm_cut=arm_cut(0.75))
        # (the body sewn on to the yoke's lower border)
        L = torso_loft(name, YOKE_CUT, hem, ease, nseg=nseg, flare=flare, fold_amp=fold, rings=extra_rings, blouse=blouse, join=border_of(g, t0, YOKE_CUT - 0.04))
        g.loft(L, {'torso', 'leg_l', 'leg_r', 'head'}, seams=SIDES, open_top=True)
        sleeves(g, sleeve_ease, t1=sleeve, flare=0.12 if sleeve > 0.6 else 0.05)
        # (the skin of the slit at the neck stays: it shows through it)
        slit_skin = lambda p: p[1] > top - 0.62 and p[2] > 0 and abs(math.atan2(p[0], p[2])) < 0.2
        cover(g, lambda i, p, r: (r == 'torso' and hem + 0.25 < p[1] < top - 0.07 and not slit_skin(p)) or (r.startswith('leg') and hem + 0.25 < p[1] < top - 0.25)
              or (r.startswith('arm') and arm_t(i, r[-1]) < sleeve - 0.07))
        return g

    out['camisa'] = shirt('camisa', waist - 1.6, 0.08, 0.1, fold=0.05, blouse=0.05)
    out['tunica'] = shirt('tunica', lerp(crotch, knee, 0.45), 0.09, 0.11, fold=0.2, flare=0.35, blouse=0.09)
    out['tunica_larga'] = shirt('tunica_larga', ankle + 0.25, 0.1, 0.11, fold=0.3, flare=1.35, blouse=0.09, nseg=22)
    # (the linen shirt: as the shirt, its sleeves to above the elbow)
    out['camisa_corta'] = shirt('camisa_corta', waist - 1.6, 0.08, 0.12, fold=0.05, blouse=0.05, sleeve=0.4)

    # --- waistcoat (chaleco): over the shirt, no sleeves, open at the front
    g = Garment('chaleco')
    top = neck - 0.12
    # (over the shirt's yoke, open down the front)
    # (its front edges in line with the rings' open front, which is cut round the ring's centre)
    zc = section(body, torso_ids, (0.0, 0.0, 0.0), UP, sh_y - 0.7, 0.12, 8, 0.0)[0][2]
    t0 = len(g.tri)
    g.patch(body, v, yoke_tris(top, YOKE_BOTTOM, arm=0.55), top, yoke_ease_of(0.25, 0.245, 0.25), {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, slit=(9.0, 0.2), collar=0.0, cut=YOKE_CUT - 0.04, arm_cut=arm_cut(0.38), slit_z=zc)
    L = torso_loft('chaleco', YOKE_CUT, waist - 1.2, 0.24, nseg=28, join=border_of(g, t0, YOKE_CUT - 0.04))
    g.loft(L, {'torso', 'head'}, seams=SIDES, open_front=0.2, open_top=True)
    cover(g, lambda i, p, r: False)
    out['chaleco'] = g

    # --- trousers (pantalon): the hips to the crotch, then each leg down to the ankle. Under a tunic or a coat only the legs
    # show: those are their own garment (calzas), so nothing of the trousers' seat can cross the tunic's skirt
    def legs(g, top_y):
        for side in ('l', 'r'):
            hip = J['%s-upper-leg' % side]
            a = (hip[0] * 0.85, top_y, hip[2])
            L = limb_loft('leg_' + side, a, J['%s-knee' % side], J['%s-ankle' % side], 0.0, 0.93, 0.07, body.pts({'leg_' + side}), nseg=16, rings=20, crease=0.05, bunch=0.04)
            g.loft(L, {'leg_' + side}, seams=(math.pi / 2, -math.pi / 2))
    g = Garment('pantalon')
    L = torso_loft('pantalon_hips', waist + 0.15, crotch - 0.15, 0.06, rings=8)   # (the seat closes under the crotch)
    g.loft(L, {'torso', 'leg_l', 'leg_r'}, seams=SIDES)
    legs(g, crotch + 0.55)
    cover(g, lambda i, p, r: (r == 'torso' and crotch - 0.5 < p[1] < waist - 0.2) or (r.startswith('leg') and ankle + 0.5 < p[1] < waist - 0.2))
    out['pantalon'] = g
    g = Garment('calzas')
    legs(g, lerp(crotch, knee, 0.22))   # (from well under the tunic's hem, which starts at 0.45 of the thigh)
    cover(g, lambda i, p, r: r.startswith('leg') and ankle + 0.5 < p[1] < lerp(crotch, knee, 0.22) - 0.25)
    out['calzas'] = g

    # --- apron (delantal): a front panel from the waist to below the knee, a band round the waist
    g = Garment('delantal')
    hem = lerp(crotch, knee, 0.85)
    L = Loft('delantal', 28)
    rings = 16
    ays = [lerp(waist + 0.1, hem, k / rings) for k in range(rings + 1)]
    acs = []
    for y in ays:
        sc = section(body, legs_ids if y < waist - 0.3 else torso_ids, (0.0, 0.0, 0.0), UP, y, 0.12, 8, 0.0)
        acs.append((sc[0][2], sc[0][0]) if sc else None)
    known = [c for c in acs if c]
    acs = [c or known[0] for c in acs]
    acs = [(sum(c[0] for c in acs[max(0, k - 3):k + 4]) / len(acs[max(0, k - 3):k + 4]), sum(c[1] for c in acs[max(0, k - 3):k + 4]) / len(acs[max(0, k - 3):k + 4])) for k in range(len(acs))]
    for k in range(rings + 1):
        y = ays[k]
        ids = legs_ids if y < waist - 0.3 else torso_ids
        s = section(body, ids, (0.0, 0.0, 0.0), UP, y, 0.12, 28, 0.33 + 0.05 * (k / rings), folds=(7, 0.04 * k / rings, 0.3), centre_of=acs[k])
        if s:
            L.add_ring(s[0], s[1], s[2], UP, s[3], waist + 0.1 - y, {'surface': 'skirt'})   # (it hangs: bound to the skirt helper)
    smooth_radii(L, 6)
    # (only the front: the columns within 75 degrees of the front)
    keep = [j for j in range(28) if abs(math.atan2(math.sin(2 * math.pi * j / 28), math.cos(2 * math.pi * j / 28))) < math.radians(66)]
    g = panel('delantal', L, keep)
    g.outward(0, L)
    band = torso_loft('delantal_band', waist + 0.08, waist - 0.08, 0.27, rings=1)
    g.loft(band, {'torso'}, part_of=lambda k, j: 1)
    out['delantal'] = g

    # --- belt (cinturon): a band over a tunic, a buckle in front
    g = Garment('cinturon')
    band = torso_loft('cinturon', waist + 0.05, waist - 0.28, 0.14, rings=2)
    g.loft(band, {'torso'}, part_of=lambda k, j: 1 if j in (0, 1, 27) else 0)
    out['cinturon'] = g

    # --- wool coat (abrigo): over everything, to the knee, long sleeves
    g = Garment('abrigo')
    top = neck + 0.05
    t0 = len(g.tri)
    g.patch(body, v, yoke_tris(top, YOKE_BOTTOM), top, yoke_ease_of(0.34, 0.325, 0.225), {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, collar=0.25, cut=YOKE_CUT - 0.04, arm_cut=arm_cut(0.75))
    L = torso_loft('abrigo', YOKE_CUT, knee - 0.3, 0.32, nseg=26, flare=0.6, fold_amp=0.22, join=border_of(g, t0, YOKE_CUT - 0.04))
    # (closed; the second colour on its collar and cuffs)
    g.loft(L, {'torso', 'leg_l', 'leg_r', 'head'}, seams=SIDES, open_top=True)
    sleeves(g, 0.22, t1=0.95, flare=0.18)
    cover(g, lambda i, p, r: False)
    out['abrigo'] = g
    # (the coat lined with a wolf's hide: the coat, its collar and cuffs of fur, and this thick roll of fur round the neck,
    # lying on the coat's collar; only the neck's and the shoulders' tops, never the arms)
    g = Garment('cuello_lobo')
    nids = [i for i in torso_ids + neck_ids if abs(v[i][0]) < 1.0 and v[i][1] > sh_y - 0.2]
    L = Loft('cuello_lobo', 28)
    prof = [(neck + 0.18, 0.4), (neck + 0.08, 0.6), (neck - 0.06, 0.72), (neck - 0.2, 0.72), (neck - 0.32, 0.62), (neck - 0.4, 0.45)]
    for k, (y, e) in enumerate(prof):
        s_ = section(body, nids, (0.0, 0.0, 0.0), UP, y, 0.1, 28, e, folds=(7, 0.05, k * 0.9))
        if s_:
            L.add_ring(s_[0], s_[1], s_[2], UP, s_[3], neck + 0.16 - y)
    smooth_radii(L, 1)
    g.loft(L, {'torso', 'head'}, part_of=lambda k, j: 1)
    out['cuello_lobo'] = g

    # --- sheepskin jacket (zamarra): to the hips, the fleece showing at the collar, the cuffs, the hem and the front edge
    g = Garment('zamarra')
    top = neck + 0.02
    t0 = len(g.tri)
    g.patch(body, v, yoke_tris(top, YOKE_BOTTOM), top, yoke_ease_of(0.32, 0.305, 0.255), {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, collar=0.3, cut=YOKE_CUT - 0.04, arm_cut=arm_cut(0.75))
    L = torso_loft('zamarra', YOKE_CUT, waist - 0.9, 0.3, fold_amp=0.06, flare=0.1, join=border_of(g, t0, YOKE_CUT - 0.04))
    n = len(L.rings)
    g.loft(L, {'torso', 'leg_l', 'leg_r', 'head'}, part_of=lambda k, j, n=n: 1 if k >= n - 2 else 0, seams=SIDES, open_top=True)
    sleeves(g, 0.25, t1=0.93, flare=0.14)
    cover(g, lambda i, p, r: False)
    out['zamarra'] = g

    # --- boots (botas): the leg from mid-calf, and the foot from the heel to the toe, with a flat sole. Lined (botas_forro):
    # a little higher, the fleece turned out over the top as a thick cuff (the second colour), the sole of the boot's own
    def boots(name, lined=False):
        g = Garment(name)
        for side in ('l', 'r'):
            L = limb_loft('shaft_' + side, J['%s-upper-leg' % side], J['%s-knee' % side], J['%s-ankle' % side], 0.71 if lined else 0.74, 1.0, 0.17,
                          body.pts({'leg_' + side, 'foot_' + side}), nseg=16, rings=7 if lined else 6, band=0.16)
            if lined:
                # (the fleece turned out over the top: the first rings stand out, the top one rolled back in a little)
                L.rings = [r[:4] + ([x + d for x in r[4]],) + r[5:] for r, d in zip(L.rings, [0.07, 0.1, 0.05] + [0.0] * len(L.rings))]
            g.loft(L, {'leg_' + side, 'foot_' + side}, part_of=(lambda k, j: 1 if k <= 1 else 0) if lined else (lambda k, j: 1 if k == 0 else 0))
            foot_ids = body.pts({'foot_' + side}) + [i for i in body.pts({'leg_' + side}) if v[i][1] < ankle + 0.3]
            zs = [v[i][2] for i in foot_ids]
            z0, z1 = min(zs) - 0.05, max(zs) + 0.12
            L = Loft('foot_' + side, 16)
            rings = 12
            fwd = (0.0, 0.0, 1.0)
            for k in range(rings + 1):
                z = lerp(z0 + 0.02, z1, k / rings)
                pts = [(v[i][0], v[i][1]) for i in foot_ids if abs(v[i][2] - z) < 0.22]
                if len(pts) < 3:
                    continue
                h = hull(pts)
                cx = sum(p[0] for p in h) / len(h)
                cy = sum(p[1] for p in h) / len(h)
                radii = []
                for j in range(16):
                    a = 2 * math.pi * j / 16
                    r = (hull_radius(h, cx, cy, a) or 0.3) + 0.12
                    # (the sole: flat, just under the foot)
                    dy = math.sin(a)
                    if dy < 0:
                        r = min(r, (cy - (ground - 0.06)) / max(1e-3, -dy))
                    radii.append(r)
                # (frame: e1 = x across the foot, e2 = up; the axis along the foot)
                L.add_ring((cx, cy, z), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), fwd, radii, z - z0)
            smooth_radii(L, 1)
            g.loft(L, {'foot_' + side, 'leg_' + side}, part_of=None if lined else (lambda k, j: 1 if math.sin(2 * math.pi * j / 16) < -0.85 else 0), cap_end=True)
        cover(g, lambda i, p, r: r.startswith('foot') or (r.startswith('leg') and p[1] < lerp(knee, ankle, 0.55)))
        return g
    out['botas'] = boots('botas')
    out['botas_forro'] = boots('botas_forro', lined=True)

    # --- skirt (falda): flared, from the waist to just under the knee, in folds that widen as it falls; a waistband
    g = Garment('falda')
    L = torso_loft('falda', waist + 0.12, knee - 0.35, 0.13, nseg=30, flare=1.0, fold_amp=0.26, rings=18)
    g.loft(L, {'torso', 'leg_l', 'leg_r'}, part_of=lambda k, j: 1 if k == 0 else 0, seams=SIDES)
    hem = knee - 0.35
    cover(g, lambda i, p, r: (r == 'torso' and crotch - 0.5 < p[1] < waist - 0.2) or (r.startswith('leg') and hem + 0.3 < p[1] < waist - 0.25))
    out['falda'] = g

    # --- pieces that lie on the body (MakeHuman's tights helper pushed out a little, cut clean): socks, underwear, the
    # undershirt. Their cloth's uv goes round each limb (or the torso), so the weave never stretches down a side
    tights_on = lambda regs, keep: [t for t, r in zip(tights_tris, tights_reg) if all(body.region[i] in regs for i in t) and keep(t)]

    def round_uv(p):
        """(u, v) in metres: round the nearest limb's axis (or the body's), and down from the top"""
        if abs(p[0]) > 0.45 and p[1] < crotch + 0.6:
            side = 'l' if p[0] > 0 else 'r'
            a, b = J['%s-knee' % side], J['%s-ankle' % side]
            top_, low_ = (J['%s-upper-leg' % side], a) if p[1] > a[1] else (a, b)
            t = max(0.0, min(1.0, (top_[1] - p[1]) / max(1e-6, top_[1] - low_[1])))
            c = lerp3(top_, low_, t)
            if p[1] < b[1] + 0.2:   # (the foot: round its own length)
                c = (b[0], p[1], b[2])
            ang, rr = math.atan2(p[0] - c[0], p[2] - c[2]), 0.6
        else:
            ang, rr = math.atan2(p[0], p[2] - 0.15), 1.4
        return ang * rr * M, -p[1] * M

    def socks(name, top_y, ease):
        g = Garment(name)
        for side in ('l', 'r'):
            tris_ = tights_on({'leg_' + side, 'foot_' + side}, lambda t: min(v[i][1] for i in t) < top_y)
            g.skin_patch(body, tris_, lambda i, p: ease, {'leg_' + side, 'foot_' + side}, [('top', lambda p: top_y - p[1])], round_uv,
                         part_of=lambda p: max(0.0, min(1.0, 0.5 + (0.12 - (top_y - p[1])) * 2.5)))   # (the ribbed top, of its second colour)
        cover(g, lambda i, p, r: (r.startswith('leg') or r.startswith('foot')) and p[1] < top_y - 0.25)
        return g
    out['calcetines'] = socks('calcetines', lerp(knee, ankle, 0.42), 0.03)
    out['medias'] = socks('medias', lerp(knee, ankle, 0.08), 0.05)   # (wool socks, to under the knee)

    # (briefs: the waist low, the legs cut high at the sides and lower behind, over the seat)
    rise = lerp(crotch, waist, 0.72)
    def leg_line(p):
        back = smooth(0.35, -0.45, p[2])
        return (p[1] - (crotch - 0.14 + (0.66 - 0.3 * back) * max(0.0, abs(p[0]) - 0.12))) * 0.83
    g = Garment('bragas')
    tris_ = tights_on({'torso', 'leg_l', 'leg_r'}, lambda t: min(v[i][1] for i in t) < rise + 0.1 and max(v[i][1] for i in t) > crotch - 0.6)
    g.skin_patch(body, tris_, lambda i, p: 0.025, {'torso', 'leg_l', 'leg_r'}, [('top', lambda p: rise - p[1]), ('leg', leg_line)], round_uv,
                 part_of=lambda p: max(0.0, min(1.0, 0.5 + (0.08 - (rise - p[1])) * 3.0)))
    cover(g, lambda i, p, r: r in ('torso', 'leg_l', 'leg_r') and rise - p[1] > 0.2 and leg_line(p) > 0.2)
    out['bragas'] = g
    # (drawers: to mid-thigh, loose, a band at the waist)
    rise2, hem2 = lerp(crotch, waist, 0.82), lerp(crotch, knee, 0.3)
    g = Garment('calzoncillos')
    tris_ = tights_on({'torso', 'leg_l', 'leg_r'}, lambda t: min(v[i][1] for i in t) < rise2 + 0.1 and max(v[i][1] for i in t) > hem2 - 0.1)
    g.skin_patch(body, tris_, lambda i, p: lerp(0.04, 0.11, smooth(crotch + 0.4, hem2, p[1])), {'torso', 'leg_l', 'leg_r'},
                 [('top', lambda p: rise2 - p[1]), ('hem', lambda p: p[1] - hem2)], round_uv,
                 part_of=lambda p: max(0.0, min(1.0, 0.5 + (0.12 - (rise2 - p[1])) * 2.5)))
    cover(g, lambda i, p, r: r in ('torso', 'leg_l', 'leg_r') and hem2 + 0.25 < p[1] < rise2 - 0.2)
    out['calzoncillos'] = g

    # --- undershirt (camiseta_interior): no sleeves, a scoop at the neck (deeper in front), wide armholes, to the hips
    hem3 = waist - 1.0
    def neckline(p):
        k = max(0.0, 1.0 - (p[0] / 0.78) ** 2)
        return (neck - 0.22 - (0.7 if p[2] > 0.1 else 0.3) * k) - p[1]
    def armhole(p):
        ax, ay, bx, by = 1.1, sh_y + 0.45, 1.6, sh_y - 1.05
        nx, ny = by - ay, -(bx - ax)
        ln = math.hypot(nx, ny)
        return ((abs(p[0]) - ax) * nx + (p[1] - ay) * ny) / ln
    g = Garment('camiseta')
    tris_ = tights_on({'torso', 'head', 'arm_l', 'arm_r'}, lambda t: max(v[i][1] for i in t) > hem3 - 0.1 and min(v[i][1] for i in t) < neck)
    g.skin_patch(body, tris_, lambda i, p: 0.03, {'torso', 'head', 'arm_l', 'arm_r'}, [('neck', neckline), ('arm', armhole), ('hem', lambda p: p[1] - hem3)], round_uv)
    cover(g, lambda i, p, r: r == 'torso' and neckline(p) > 0.25 and armhole(p) > 0.25 and p[1] > hem3 + 0.25)
    out['camiseta'] = g

    # --- headscarf (hijab): round the head, loose, the face open from the forehead to under the chin (an oval cut clean),
    # and falling over the neck onto the shoulders and the top of the chest, over the shirt (a coat goes over it). The hood
    # is lofted round the head as the clothes are (so it bridges the ears), the fall is the body's tights pushed out; both
    # bound to the skin
    eye = J['l-eye'][1]
    chin = J['jaw'][1] - 0.1
    brow = eye + 0.52
    yc, hy = (brow + chin) / 2, (brow - chin) / 2
    hid = list(head_ids) + [i for i in body.pts({'torso'}) if v[i][1] > neck - 0.5 and abs(v[i][0]) < 0.9]
    ytop = max(v[i][1] for i in head_ids)
    ybot = neck - 0.12
    L = Loft('hijab', 36)
    ys, y = [], ybot
    while y < ytop - 0.06:
        ys.append(y)
        y += 0.1 if y > ytop - 0.8 else 0.16
    cents = []
    for y in ys:
        sc = section(body, hid, (0.0, 0.0, 0.0), UP, y, 0.1, 8, 0.0)
        cents.append(None if sc is None else (sc[0][2], 0.0))
    known = [c for c in cents if c]
    cents = [c or known[0] for c in cents]
    cents = [(sum(c[0] for c in cents[max(0, k - 2):k + 3]) / len(cents[max(0, k - 2):k + 3]), 0.0) for k in range(len(cents))]
    for y, c in zip(ys, cents):
        s_ = section(body, hid, (0.0, 0.0, 0.0), UP, y, 0.1, 36, 0.0, centre_of=c)
        if s_ is None:
            continue
        cc, e1, e2, radii = s_
        hgt = (y - ybot) / (ytop - ybot)
        for j in range(36):
            a = 2 * math.pi * j / 36
            back = 0.5 - 0.5 * math.cos(a)
            # (loose, never a hood moulded on the skull: the hair gathered under it at the back and the top, and from the
            # jaw down it falls away from the neck, wide, onto the fall)
            side = abs(math.sin(a))
            radii[j] += 0.17 + 0.26 * back * smooth(0.25, 0.7, hgt) + 0.04 * smooth(0.6, 1.0, hgt) + (0.5 + 0.15 * side) * smooth(0.42, 0.0, hgt)
        L.add_ring(cc, e1, e2, UP, radii, y - ybot, {'surface': 'skin'})
    smooth_radii(L, 3)
    c0, e1, e2, axis, radii, along, meta = L.rings[-1]
    L.add_ring(add(c0, (0.0, 0.12, 0.0)), e1, e2, UP, [r * 0.5 for r in radii], along + 0.12, meta)
    g = Garment('hijab')
    g.loft(L, {'head', 'torso'}, cap_end=True)
    zc = sum(c[0] for c in cents) / len(cents)
    def face_open(p):
        a = math.atan2(p[0], p[2] - zc) / math.radians(62)
        b = (p[1] - yc) / hy
        return (math.sqrt(a * a + b * b) - 1.0) * 0.75 if p[2] > zc else 1.0
    g.clip_tris(0, 'face', face_open)
    # (the fall over the neck and the shoulders, lower in front and behind than at the sides)
    def fall_hem(p):
        k = (p[0] / 1.25) ** 2
        return p[1] - (sh_y - 0.62 + (0.05 if p[2] < 0.1 else 0.0) + 1.0 * k)
    t0 = len(g.tri)
    tris_ = tights_on({'torso', 'head', 'arm_l', 'arm_r'}, lambda t: max(v[i][1] for i in t) > sh_y - 0.8 and min(v[i][1] for i in t) < neck + 0.1)
    g.skin_patch(body, tris_, lambda i, p: lerp(0.62, 0.3, smooth(neck, sh_y, p[1])), {'torso', 'head'}, [('hem', fall_hem), ('top', lambda p: neck + 0.02 - p[1])], round_uv)
    g.hem_from_border()
    def in_face(p):
        return face_open(p) < 0.25
    cover(g, lambda i, p, r: r == 'head' and p[1] > neck - 0.1 and not in_face(p))
    out['hijab'] = g

    for g in out.values():
        g.ao_folds()
    return out


def lerp3(a, b, t):
    return (lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))


def panel(name, L, keep):
    """A garment of only some columns of a loft (an apron): its own vertices, render vertices and triangles."""
    nseg = L.nseg
    g = Garment(name)
    keep = sorted(keep)
    remap = {}
    nr = len(L.rings)
    for k in range(nr):
        for j in keep:
            remap[(k, j)] = len(g.v)
            g.v.append(L.point(k, j))
            g.region.append(({'torso', 'leg_l', 'leg_r'}, L.rings[k][6].get('surface', 'tights')))
    mean_r = sum(sum(r[4]) / nseg for r in L.rings) / nr
    alongs = [r[5] for r in L.rings]
    j0, j1 = keep[0], keep[-1]
    for k in range(nr):
        for j in keep:
            a = 2 * math.pi * j / nseg
            a = math.atan2(math.sin(a), math.cos(a))
            side = min(abs(j - j0), abs(j1 - j)) * 2 * math.pi / nseg * mean_r * M
            edge = min(side, abs(alongs[-1] - alongs[k]) * M)
            g.rv.append([remap[(k, j)], a * mean_r * M, alongs[k] * M, 0, 9.0, edge, 1.0])
    cols = len(keep)
    for k in range(nr - 1):
        for c in range(cols - 1):
            if keep[c + 1] != keep[c] + 1 and not (keep[c] == nseg - 1 and keep[c + 1] == 0):
                continue
            a = k * cols + c
            b = a + 1
            cc = a + cols
            d = cc + 1
            g.tri += [(a, cc, b), (b, cc, d)]
    # (the columns are kept in index order, so the front's two halves meet across 0: join the last and the first)
    if 0 in keep and nseg - 1 in keep:
        ia, ib = keep.index(nseg - 1), keep.index(0)
        for k in range(nr - 1):
            a, b = k * cols + ia, k * cols + ib
            g.tri += [(a, a + cols, b), (b, a + cols, b + cols)]
    return g


def build(verts, faces, groups, weights, nbody):
    """All the garments, bound: name -> dict(v, binds (refs, bary, off), rv, tri, cover)."""
    body = Body(verts, faces, groups, weights, nbody)
    binders = {k: Binder(body, k) for k in body.surf}
    out = {}
    for name, g in wardrobe(body).items():
        binds = [binders[surf].bind(p, regs) for p, (regs, surf) in zip(g.v, g.region)]
        out[name] = {'v': g.v, 'binds': binds, 'rv': g.rv, 'tri': g.tri, 'cover': sorted(g.cover)}
    return out
