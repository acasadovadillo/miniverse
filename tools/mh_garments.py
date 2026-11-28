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

    def loft(self, L, regions, part_of=None, seams=(), u_scale=None, open_front=None, cap_end=False, slit=None):
        """Adds a loft as a ring mesh. seams: angles (radians) with a seam down them. open_front: half width (radians) of a
        front opening (a vest), none if None. part_of(k, j) -> part."""
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
                edge = min(abs(alongs[k] - alongs[0]), abs(alongs[-1] - alongs[k])) * M
                if open_front is not None:
                    da = abs(math.atan2(math.sin(a), math.cos(a))) - open_front
                    edge = min(edge, max(0.0, da) * mean_r * M)
                self.rv.append([base + k * nseg + (j % nseg), a * mean_r * M, alongs[k] * M, part_of(k, j) if part_of else 0, seam, edge, 1.0])
        for k in range(nr - 1):
            for j in range(nseg):
                if j in skip or ((j + 1) % nseg) in skip:   # (a vest's front opening)
                    continue
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
            for j in range(nseg):
                self.tri.append((last + j, cid, last + j + 1))
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

    def patch(self, body, verts_of, tris, top, ease, regions, seams=(), slit=None, collar=0.12):
        """A garment piece that is the skin's own helper surface pushed out by ease (the yoke over the shoulders: it falls
        from the collar to the shoulder as the body does). tris: helper triangles to take; vertices above top come down to it
        (a round neckline); slit: (depth, half angle) of a slit at the front of the neck; collar: the band of part 1."""
        v = body.v
        used = sorted({i for t in tris for i in t})
        nrm = {i: [0.0, 0.0, 0.0] for i in used}
        for a, b, c in tris:
            n = cross(sub(v[b], v[a]), sub(v[c], v[a]))
            for i in (a, b, c):
                nrm[i][0] += n[0]; nrm[i][1] += n[1]; nrm[i][2] += n[2]
        idx = {}
        mean_r = sum(math.hypot(v[i][0], v[i][2]) for i in used) / len(used)
        for i in used:
            n = norm(tuple(nrm[i]))
            p = add(v[i], mul(n, ease))
            if p[1] > top:   # (the neckline: a level ring round the neck)
                p = (p[0], top, p[2])
            idx[i] = len(self.v)
            self.v.append(p)
            self.region.append((regions, 'tights'))
        base = len(self.rv)
        for i in used:
            p = self.v[idx[i]]
            a = math.atan2(p[0], p[2])
            seam = min([abs(math.atan2(math.sin(a - s_), math.cos(a - s_))) * mean_r * M for s_ in seams] + [9.0])
            edge = (top - p[1]) * M
            # (u: across, the front and the back apart at the side seams, where the cloth is cut anyway)
            u = p[0] * M if p[2] >= 0.1 else 1.0 - p[0] * M
            self.rv.append([idx[i], u, (top - p[1]) * M, 1 if top - p[1] < collar else 0, seam, edge, 1.0])
        rid = {i: base + k for k, i in enumerate(used)}
        t0 = len(self.tri)
        for a, b, c in tris:
            if slit:
                pts = [self.v[idx[i]] for i in (a, b, c)]
                if all(abs(math.atan2(q[0], q[2])) < slit[1] and q[2] > 0 and top - q[1] < slit[0] for q in pts):
                    continue
            self.tri.append((rid[a], rid[b], rid[c]))
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
        occ = {}
        for i, ns in nb.items():
            c = [sum(self.v[j][k] for j in ns) / len(ns) for k in range(3)]
            d = sub(self.v[i], c)
            occ[i] = math.sqrt(dot(d, d))
        for r in self.rv:
            r[6] = max(0.55, 1.0 - occ.get(r[0], 0.0) * 1.6)


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

    def torso_loft(name, top, hem, ease, nseg=28, flare=0.0, fold_amp=0.0, rings=None, band=0.12, blouse=0.0):
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

    # --- shirt (camisa): neck to the hips, long sleeves with cuffs, a collar band
    def shirt(name, hem, ease, sleeve_ease, collar=True, fold=0.0, flare=0.0, extra_rings=None, blouse=0.0, yoke_ease=0.15, nseg=28):
        g = Garment(name)
        top = neck - 0.04   # (a round neck at the base of the neck, with a short slit in front)
        # (the yoke: the shoulders and the neckline, following the body; the rest lofted from under it, overlapping it)
        g.patch(body, v, yoke_tris(top, sh_y - 0.62), top, yoke_ease, {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, slit=(0.6, 0.13), collar=0.0)
        L = torso_loft(name, sh_y - 0.5, hem, ease, nseg=nseg, flare=flare, fold_amp=fold, rings=extra_rings, blouse=blouse)
        g.loft(L, {'torso', 'leg_l', 'leg_r', 'head'}, seams=SIDES)
        sleeves(g, sleeve_ease)
        # (the skin of the slit at the neck stays: it shows through it)
        slit_skin = lambda p: p[1] > top - 0.62 and p[2] > 0 and abs(math.atan2(p[0], p[2])) < 0.2
        cover(g, lambda i, p, r: (r == 'torso' and hem + 0.25 < p[1] < top - 0.12 and not slit_skin(p)) or (r.startswith('leg') and hem + 0.25 < p[1] < top - 0.25)
              or (r.startswith('arm') and arm_t(i, r[-1]) < 0.9))
        return g

    out['camisa'] = shirt('camisa', waist - 1.6, 0.08, 0.1, fold=0.05, blouse=0.05)
    out['tunica'] = shirt('tunica', lerp(crotch, knee, 0.45), 0.09, 0.11, fold=0.2, flare=0.35, blouse=0.09)
    out['tunica_larga'] = shirt('tunica_larga', ankle + 0.25, 0.1, 0.11, fold=0.3, flare=1.35, blouse=0.09, nseg=24)

    # --- waistcoat (chaleco): over the shirt, no sleeves, open at the front
    g = Garment('chaleco')
    top = neck - 0.12
    # (over the shirt's yoke, open down the front)
    g.patch(body, v, yoke_tris(top, sh_y - 0.62, arm=0.55), top, 0.22, {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, slit=(9.0, 0.2), collar=0.0)
    L = torso_loft('chaleco', sh_y - 0.5, waist - 1.2, 0.24, nseg=28)
    g.loft(L, {'torso', 'head'}, seams=SIDES, open_front=0.2)
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
    g.patch(body, v, yoke_tris(top, sh_y - 0.62), top, 0.3, {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, collar=0.25)
    L = torso_loft('abrigo', sh_y - 0.5, knee - 0.3, 0.32, flare=0.6, fold_amp=0.22)
    # (closed, its front edge a band of the second colour down the middle, and its collar)
    g.loft(L, {'torso', 'leg_l', 'leg_r', 'head'}, part_of=lambda k, j: 1 if j in (0, 1) else 0, seams=SIDES)
    sleeves(g, 0.22, t1=0.95, flare=0.18)
    cover(g, lambda i, p, r: False)
    out['abrigo'] = g

    # --- sheepskin jacket (zamarra): to the hips, the fleece showing at the collar, the cuffs, the hem and the front edge
    g = Garment('zamarra')
    top = neck + 0.02
    g.patch(body, v, yoke_tris(top, sh_y - 0.62), top, 0.3, {'torso', 'head', 'arm_l', 'arm_r'}, seams=SIDES, collar=0.3)
    L = torso_loft('zamarra', sh_y - 0.5, waist - 0.9, 0.3, fold_amp=0.06, flare=0.1)
    n = len(L.rings)
    g.loft(L, {'torso', 'leg_l', 'leg_r', 'head'}, part_of=lambda k, j, n=n: 1 if k >= n - 2 else 0, seams=SIDES)
    sleeves(g, 0.25, t1=0.93, flare=0.14)
    cover(g, lambda i, p, r: False)
    out['zamarra'] = g

    # --- boots (botas): the leg from mid-calf, and the foot from the heel to the toe, with a flat sole
    g = Garment('botas')
    for side in ('l', 'r'):
        L = limb_loft('shaft_' + side, J['%s-upper-leg' % side], J['%s-knee' % side], J['%s-ankle' % side], 0.74, 1.0, 0.17,
                      body.pts({'leg_' + side, 'foot_' + side}), nseg=16, rings=6, band=0.16)
        g.loft(L, {'leg_' + side, 'foot_' + side}, part_of=lambda k, j: 1 if k == 0 else 0)
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
        g.loft(L, {'foot_' + side, 'leg_' + side}, part_of=lambda k, j: 1 if math.sin(2 * math.pi * j / 16) < -0.85 else 0, cap_end=True)
    cover(g, lambda i, p, r: r.startswith('foot') or (r.startswith('leg') and p[1] < lerp(knee, ankle, 0.55)))
    out['botas'] = g

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
