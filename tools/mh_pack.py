#!/usr/bin/env python3
"""mh_pack.py: packs MakeHuman's CC0 base mesh, shapes and system assets for the new character creator (plan CR, option E).

Writes assets/mh/mh.bin.gz (one gzip file: the hm08 body mesh, the macro and face targets as sparse int16 deltas, the
arm weights for the standing pose, and the bound meshes for eyes, brows, lashes, hair and the provisional clothes) and the
textures next to it (skins, irises, cards), resized with macOS's own `sips`. The game blends the targets on the CPU once
per look (src/three/mh/shape.js); nothing here runs in the browser.

Our own code, written from the documented concepts (a body is the base mesh plus a linear blend of target offsets; a
bound mesh vertex is a barycentric point on three base vertices plus an offset scaled by the body's size). No MakeHuman
or MPFB code is read or copied. Every text input must carry MakeHuman's CC0 header (or, for the rig weights, a "CC0"
licence field) and every system asset must be listed as CC0 in MPFB's pack index, or the script stops. It refuses
genitals, expressions and anything not in its allow-list.

Python 3 standard library only. Usage:
  python3 -I tools/mh_pack.py --src DIR [--assets DIR] [--rig DIR] [--no-tex]   writes assets/mh/
  python3 -I tools/mh_pack.py --src DIR --check                                  rebuilds in memory, compares, prints sizes
DIR (--src) has makehuman/data's layout (3dobjs/base.obj, targets/...): docs/pruebas-arte/mh/src in the main copy, not in git.
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)   # (our own garments module, next to this script)
import mh_garments  # noqa: E402
OUT = os.path.join(REPO, 'assets', 'mh')
MPFB_USER = os.path.expanduser('~/Library/Application Support/Blender/4.5/extensions/.user/user_default/mpfb/data')
MPFB_SYS = os.path.expanduser('~/Library/Application Support/Blender/4.5/extensions/user_default/mpfb/data')
CC0 = 'explicitly released as CC0'
VERSION = 1
N_BODY = 13380            # hm08's own vertices; the rest are helpers and joint cubes
POS_Q = 1000.0            # positions: MakeHuman units (decimetres) x 1000 = tenths of a millimetre, in int16
T_Q = 0.001               # target offsets: 0.001 decimetres = a tenth of a millimetre
W_Q = 4096.0              # a bound vertex's weights in int16 (-8..8)
UV_Q = 16000.0            # a bound mesh's uv in int16 (-2..2)

SEXES = ('female', 'male')
AGES = ('young', 'old')
ORIGINS = ('african', 'asian', 'caucasian')
LEVELS = ('min', 'average', 'max')

# ---- The face sliders: (group, id, targets for -1, targets for +1). {s} is l and r, merged into one shape ----
# About 40, grouped as the creator shows them. Each id has its text in src/lang (mh.slider.<id>)
FACE = [
    ('eyes', 'eye_size', ['eyes/{s}-eye-scale-decr'], ['eyes/{s}-eye-scale-incr']),
    ('eyes', 'eye_spacing', ['eyes/{s}-eye-trans-in'], ['eyes/{s}-eye-trans-out']),
    ('eyes', 'eye_height', ['eyes/{s}-eye-trans-down'], ['eyes/{s}-eye-trans-up']),
    ('eyes', 'eye_tilt', ['eyes/{s}-eye-corner2-down'], ['eyes/{s}-eye-corner2-up']),
    ('eyes', 'eye_open', ['eyes/{s}-eye-height2-decr'], ['eyes/{s}-eye-height2-incr']),
    ('eyes', 'eye_fold', ['eyes/{s}-eye-eyefold-up'], ['eyes/{s}-eye-eyefold-down']),
    ('eyes', 'eye_epicanthus', ['eyes/{s}-eye-epicanthus-out'], ['eyes/{s}-eye-epicanthus-in']),
    ('eyes', 'eye_bags', ['eyes/{s}-eye-bag-decr'], ['eyes/{s}-eye-bag-incr']),
    ('brows', 'brow_height', ['eyebrows/eyebrows-trans-down'], ['eyebrows/eyebrows-trans-up']),
    ('brows', 'brow_angle', ['eyebrows/eyebrows-angle-down'], ['eyebrows/eyebrows-angle-up']),
    ('brows', 'brow_ridge', ['eyebrows/eyebrows-trans-backward'], ['eyebrows/eyebrows-trans-forward']),
    ('nose', 'nose_length', ['nose/nose-scale-vert-decr'], ['nose/nose-scale-vert-incr']),
    ('nose', 'nose_width', ['nose/nose-scale-horiz-decr'], ['nose/nose-scale-horiz-incr']),
    ('nose', 'nose_projection', ['nose/nose-scale-depth-decr'], ['nose/nose-scale-depth-incr']),
    ('nose', 'nose_hump', ['nose/nose-hump-decr'], ['nose/nose-hump-incr']),
    ('nose', 'nose_tip', ['nose/nose-point-down'], ['nose/nose-point-up']),
    ('nose', 'nose_nostrils', ['nose/nose-nostrils-width-decr'], ['nose/nose-nostrils-width-incr']),
    ('nose', 'nose_bridge', ['nose/nose-width1-decr'], ['nose/nose-width1-incr']),
    ('nose', 'nose_height', ['nose/nose-trans-down'], ['nose/nose-trans-up']),
    ('mouth', 'mouth_width', ['mouth/mouth-scale-horiz-decr'], ['mouth/mouth-scale-horiz-incr']),
    ('mouth', 'mouth_height', ['mouth/mouth-trans-down'], ['mouth/mouth-trans-up']),
    ('mouth', 'lip_upper', ['mouth/mouth-upperlip-volume-decr'], ['mouth/mouth-upperlip-volume-incr']),
    ('mouth', 'lip_lower', ['mouth/mouth-lowerlip-volume-decr'], ['mouth/mouth-lowerlip-volume-incr']),
    ('mouth', 'mouth_corners', ['mouth/mouth-angles-down'], ['mouth/mouth-angles-up']),
    ('mouth', 'cupid_bow', ['mouth/mouth-cupidsbow-decr'], ['mouth/mouth-cupidsbow-incr']),
    ('jaw', 'jaw_width', ['chin/chin-bones-decr'], ['chin/chin-bones-incr']),
    ('jaw', 'chin_width', ['chin/chin-width-decr'], ['chin/chin-width-incr']),
    ('jaw', 'chin_height', ['chin/chin-height-decr'], ['chin/chin-height-incr']),
    ('jaw', 'chin_forward', ['chin/chin-prominent-decr'], ['chin/chin-prominent-incr']),
    ('jaw', 'chin_cleft', ['chin/chin-cleft-decr'], ['chin/chin-cleft-incr']),
    ('jaw', 'jaw_jut', ['chin/chin-prognathism-decr'], ['chin/chin-prognathism-incr']),
    ('cheeks', 'cheek_bones', ['cheek/{s}-cheek-bones-decr'], ['cheek/{s}-cheek-bones-incr']),
    ('cheeks', 'cheek_volume', ['cheek/{s}-cheek-volume-decr'], ['cheek/{s}-cheek-volume-incr']),
    ('cheeks', 'cheek_height', ['cheek/{s}-cheek-trans-down'], ['cheek/{s}-cheek-trans-up']),
    ('forehead', 'forehead_height', ['forehead/forehead-scale-vert-decr'], ['forehead/forehead-scale-vert-incr']),
    ('forehead', 'forehead_slope', ['forehead/forehead-trans-backward'], ['forehead/forehead-trans-forward']),
    ('ears', 'ear_size', ['ears/{s}-ear-scale-decr'], ['ears/{s}-ear-scale-incr']),
    ('ears', 'ear_out', ['ears/{s}-ear-wing-decr'], ['ears/{s}-ear-wing-incr']),
    ('ears', 'ear_height', ['ears/{s}-ear-trans-down'], ['ears/{s}-ear-trans-up']),
    ('ears', 'ear_lobe', ['ears/{s}-ear-lobe-decr'], ['ears/{s}-ear-lobe-incr']),
    ('head', 'head_width', ['head/head-scale-horiz-decr'], ['head/head-scale-horiz-incr']),
    ('head', 'head_height', ['head/head-scale-vert-decr'], ['head/head-scale-vert-incr']),
    ('head', 'head_shape', ['head/head-round'], ['head/head-square']),
    ('head', 'head_fat', ['head/head-fat-decr'], ['head/head-fat-incr']),
    ('head', 'neck_width', ['neck/neck-scale-horiz-decr'], ['neck/neck-scale-horiz-incr']),
]

# ---- Expressions (MakeHuman's expression units, one set per origin): id, units merged into it ----
EXPR = [
    ('blink', ['eye-left-closure', 'eye-right-closure']), ('squint', ['eye-left-slit', 'eye-right-slit']),
    ('wide', ['eye-left-opened-up', 'eye-right-opened-up']), ('brow_up', ['eyebrows-left-up', 'eyebrows-right-up']),
    ('brow_inner', ['eyebrows-left-inner-up', 'eyebrows-right-inner-up']), ('brow_down', ['eyebrows-left-down', 'eyebrows-right-down']),
    ('jaw_open', ['mouth-open']), ('smile', ['mouth-corner-puller']), ('smile_up', ['mouth-upward-retraction']),
    ('frown', ['mouth-depression']), ('pucker', ['mouth-pursing']), ('stretch', ['mouth-retraction']),
    ('lip_up', ['mouth-elevation']), ('press', ['mouth-compression']), ('sneer', ['nose-left-elevation', 'nose-right-elevation']),
]

# ---- Bound meshes (MPFB system assets, CC0): kind, folder, file stem, texture(s) ----
PROXIES = [
    ('eyes', 'eyes/high-poly', 'high-poly'), ('teeth', 'teeth/teeth_base', 'teeth_base'), ('tongue', 'tongue/tongue01', 'tongue01'),
    ('brows', 'eyebrows/eyebrow001', 'eyebrow001'), ('brows', 'eyebrows/eyebrow002', 'eyebrow002'),
    ('brows', 'eyebrows/eyebrow004', 'eyebrow004'), ('brows', 'eyebrows/eyebrow006', 'eyebrow006'),
    ('brows', 'eyebrows/eyebrow009', 'eyebrow009'), ('brows', 'eyebrows/eyebrow010', 'eyebrow010'),
    ('lashes', 'eyelashes/eyelashes01', 'eyelashes01'), ('lashes', 'eyelashes/eyelashes02', 'eyelashes02'),
    # (plan CR P5: the game's middle distance, LOD1: MakeHuman's own low bodies, about 3,100 triangles, on the same skin)
    ('lod', 'proxymeshes/female1605', 'female1605'), ('lod', 'proxymeshes/male1591', 'male1591'),
]
# The provisional clothes' two parts:
# the trousers of the shirt-and-trousers suit and the skirt of the blouse-and-skirt one. Everything else is the upper part
# the trousers of the shirt-and-trousers suit (denim: bluer than red) and the skirt of the blouse-and-skirt one (grey-green,
# not light), told by the texel under each face. Everything else is the upper part
LOWER = {}   # (P1's MakeHuman clothes are gone: P3's own garments have their parts from tools/mh_garments.py)

# ---- Textures: (source under MPFB's user data, output name, longest side, format) ----
TEXTURES = [
    ('skins/young_caucasian_female/young_lightskinned_female_diffuse.png', 'skin-female-young.jpg', 2048, 'jpeg'),
    ('skins/old_caucasian_female/old_lightskinned_female_diffuse.png', 'skin-female-old.jpg', 2048, 'jpeg'),
    ('skins/young_caucasian_male/young_lightskinned_male_diffuse.png', 'skin-male-young.jpg', 2048, 'jpeg'),
    ('skins/old_caucasian_male/old_lightskinned_male_diffuse.png', 'skin-male-old.jpg', 2048, 'jpeg'),
    ('eyes/materials/brown_eye.png', 'iris.png', 512, 'png'),
    ('teeth/teeth_base/teeth.png', 'teeth.jpg', 256, 'jpeg'), ('tongue/tongue01/tongue01_diffuse.png', 'tongue.jpg', 256, 'jpeg'),   # (with its alpha: the cornea's window over the iris)
    ('eyebrows/eyebrow001/eyebrow001.png', 'brow-eyebrow001.png', 256, 'png'),
    ('eyebrows/eyebrow002/eyebrow002.png', 'brow-eyebrow002.png', 256, 'png'),
    ('eyebrows/eyebrow004/eyebrow004.png', 'brow-eyebrow004.png', 256, 'png'),
    ('eyebrows/eyebrow006/eyebrow006.png', 'brow-eyebrow006.png', 256, 'png'),
    ('eyebrows/eyebrow009/eyebrow009.png', 'brow-eyebrow009.png', 256, 'png'),
    ('eyebrows/eyebrow010/eyebrow010.png', 'brow-eyebrow010.png', 256, 'png'),
    ('eyelashes/eyelashes01/eyelashes01.png', 'lash-eyelashes01.png', 256, 'png'),
    ('eyelashes/eyelashes02/eyelashes02.png', 'lash-eyelashes02.png', 256, 'png'),
]
# The joints the runtime needs (the mean of each cube's vertices): the arm chain for the pose, the head and eyes to frame
JOINTS = ['joint-ground', 'joint-pelvis', 'joint-neck', 'joint-head', 'joint-head-2', 'joint-l-eye', 'joint-r-eye', 'joint-mouth',
          'joint-l-clavicle', 'joint-l-shoulder', 'joint-l-elbow', 'joint-l-hand', 'joint-r-clavicle', 'joint-r-shoulder',
          'joint-r-elbow', 'joint-r-hand',
          # (plan CR P5: the rest of the game's 23 bones, src/three/mh/rig.js)
          'joint-spine-1', 'joint-spine-2', 'joint-spine-3', 'joint-spine-4', 'joint-l-hand-3', 'joint-r-hand-3',
          'joint-l-upper-leg', 'joint-l-knee', 'joint-l-ankle', 'joint-l-foot-1', 'joint-r-upper-leg', 'joint-r-knee',
          'joint-r-ankle', 'joint-r-foot-1']
# The game's bones (the names actors.js writes: real/persona.js) and the CC0 game-engine bones folded onto each (plan CR P5)
GAME_BONES = ['body', 'spine', 'torso', 'neck', 'head', 'clavL', 'armL', 'foreL', 'handL', 'legL', 'shinL', 'footL', 'toeL',
              'clavR', 'armR', 'foreR', 'handR', 'legR', 'shinR', 'footR', 'toeR']
FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')
def game_bone(b):
    if b in ('Root', 'pelvis', 'spine_01'):
        return 'body'
    side = b[-1].upper() if b.endswith(('_l', '_r')) else ''
    stem = b[:-2] if side else b
    if stem.startswith(FINGERS):
        stem = 'hand'
    return {'spine_02': 'spine', 'spine_03': 'torso', 'neck_01': 'neck', 'head': 'head', 'clavicle': 'clav', 'upperarm': 'arm',
            'lowerarm': 'fore', 'hand': 'hand', 'thigh': 'leg', 'calf': 'shin', 'foot': 'foot', 'ball': 'toe'}[stem] + side
ARM_UP = ('upperarm',)
ARM_LOW = ('lowerarm', 'hand', 'thumb_01', 'thumb_02', 'thumb_03', 'index_01', 'index_02', 'index_03', 'middle_01', 'middle_02',
           'middle_03', 'ring_01', 'ring_02', 'ring_03', 'pinky_01', 'pinky_02', 'pinky_03')


def die(msg):
    sys.stderr.write('mh_pack: ' + msg + '\n')
    sys.exit(2)


class Ledger:
    """Every input opened once, its licence checked and its hash kept for assets/LICENCIAS.md."""

    def __init__(self, src, user, sysdir):
        self.src, self.user, self.sys = src, user, sysdir
        self.used = {}
        pack = os.path.join(user, 'packs', 'makehuman_system_assets.json')
        if not os.path.isfile(pack):
            die('missing MPFB pack index: ' + pack)
        with open(pack, encoding='utf-8') as fh:
            self.pack = json.load(fh)

    def _read(self, path, label, how):
        if not os.path.isfile(path):
            die('missing input: ' + path)
        with open(path, 'rb') as fh:
            raw = fh.read()
        self.used[label] = (hashlib.sha256(raw).hexdigest()[:12], how)
        return raw

    def text(self, rel):
        """A file of makehuman/data (base.obj, targets): CC0 header required."""
        low = rel.lower()
        if 'genital' in low or ('expression' in low and '/expression/units/' not in low) or not (rel == '3dobjs/base.obj' or rel.startswith('targets/')):
            die('not in the allow-list: ' + rel)
        raw = self._read(os.path.join(self.src, rel), 'makehuman/data/' + rel, 'header')
        text = raw.decode('utf-8')
        if not any(CC0 in ln for ln in text.splitlines()[:40] if ln.startswith('#')):
            die('no CC0 header, refused: ' + rel)
        return text

    def asset(self, rel, header=True):
        """A file of MPFB's system assets: its asset listed as CC0 in the pack index, and the CC0 header on text files."""
        name = rel.split('/')[1] if rel.split('/')[0] != 'eyes' else 'brown'
        if rel.startswith('eyes/high-poly'):
            name = None   # (the eye mesh has no pack entry of its own: its header is the check)
        if name is not None and self.pack.get(name, {}).get('license') != 'CC0':
            die('not CC0 in the pack index: ' + rel)
        raw = self._read(os.path.join(self.user, rel), 'mpfb/system_assets/' + rel, 'header' if header else ('its .mhclo header' if name is None else 'pack index'))
        if header:
            text = raw.decode('utf-8', 'replace')
            if not any(CC0 in ln for ln in text.splitlines()[:40] if ln.startswith('#')):
                die('no CC0 header, refused: ' + rel)
        return raw

    def rig_weights(self):
        rel = 'rigs/standard/weights.game_engine.json'
        raw = self._read(os.path.join(self.sys, rel), 'mpfb/data/' + rel, 'licence field')
        d = json.loads(raw.decode('utf-8'))
        if d.get('license') != 'CC0':
            die('rig weights not CC0: ' + rel)
        return d['weights']


def parse_obj(text):
    v, vt, faces, groups, g = [], [], [], {}, None
    for ln in text.splitlines():
        if ln.startswith('v '):
            v.append([float(x) for x in ln.split()[1:4]])
        elif ln.startswith('vt '):
            vt.append([float(x) for x in ln.split()[1:3]])
        elif ln.startswith('g '):
            g = ln.split()[1]
            groups.setdefault(g, [])
        elif ln.startswith('f '):
            corners = []
            for tok in ln.split()[1:]:
                p = tok.split('/')
                corners.append((int(p[0]) - 1, int(p[1]) - 1 if len(p) > 1 and p[1] else -1))
            faces.append((g, corners))
            if g is not None:
                groups[g].append(len(faces) - 1)
    return v, vt, faces, groups


def parse_target(text):
    out = []
    for ln in text.splitlines():
        if not ln.strip() or ln.startswith('#'):
            continue
        p = ln.split()
        out.append((int(p[0]), float(p[1]), float(p[2]), float(p[3])))
    return out


def parse_mhclo(text):
    """The binding of a bound mesh: per obj vertex its base vertices, weights and offset; the scale pairs; the base
    vertices it hides."""
    info, binds, deleted, mode = {}, [], [], None
    for ln in text.splitlines():
        s = ln.strip()
        if not s or s.startswith('#'):
            continue
        p = s.split()
        if p[0] == 'verts':
            mode = 'verts'
            continue
        if p[0] == 'delete_verts':
            mode = 'delete'
            continue
        if mode == 'verts' and (p[0].lstrip('-').isdigit()) and len(p) in (1, 9):
            if len(p) == 1:
                binds.append(((int(p[0]), int(p[0]), int(p[0])), (1.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
            else:
                binds.append(((int(p[0]), int(p[1]), int(p[2])), (float(p[3]), float(p[4]), float(p[5])), (float(p[6]), float(p[7]), float(p[8]))))
            continue
        if mode == 'delete' and p[0].isdigit():
            toks, k = ' '.join(p).replace('-', ' - ').split(), 0   # (single vertices and ranges "a - b")
            while k < len(toks):
                if k + 2 < len(toks) and toks[k + 1] == '-':
                    deleted.extend(range(int(toks[k]), int(toks[k + 2]) + 1))
                    k += 3
                else:
                    deleted.append(int(toks[k]))
                    k += 1
            continue
        if p[0] in ('x_scale', 'y_scale', 'z_scale'):
            info[p[0]] = (int(p[1]), int(p[2]), float(p[3]))
        elif p[0] in ('name', 'obj_file', 'z_depth'):
            info[p[0]] = p[1]
    return info, binds, deleted


class Blob:
    def __init__(self):
        self.parts, self.size, self.index = [], 0, {}

    def add(self, name, data):
        pad = (-self.size) % 4
        if pad:
            self.parts.append(b'\0' * pad)
            self.size += pad
        self.index[name] = [self.size, len(data)]
        self.parts.append(data)
        self.size += len(data)


def i16(vals):
    return struct.pack('<%dh' % len(vals), *vals)


def u16(vals):
    return struct.pack('<%dH' % len(vals), *vals)


def clamp16(x):
    return max(-32767, min(32767, int(round(x))))


def build(args):
    L = Ledger(args.src, args.assets, args.rig)
    base_v, base_vt, base_f, base_g = parse_obj(L.text('3dobjs/base.obj').replace('\r', ''))
    joint_ids = {}
    for name, fis in base_g.items():
        if name.startswith('joint-'):
            ids = set()
            for fi in fis:
                ids.update(c[0] for c in base_f[fi][1])
            joint_ids[name] = sorted(ids)

    # The proxies first: their bindings say which helper vertices must stay
    proxies = []
    for kind, folder, stem in PROXIES:
        mh = L.asset('%s/%s.%s' % (folder, stem, 'proxy' if kind == 'lod' else 'mhclo')).decode('utf-8')
        info, binds, deleted = parse_mhclo(mh)
        obj = L.asset('%s/%s' % (folder, info.get('obj_file', stem + '.obj')), header=False).decode('utf-8')
        pv, pvt, pf, _ = parse_obj(obj)
        if len(binds) != len(pv):
            die('binding and mesh differ: %s (%d, %d)' % (stem, len(binds), len(pv)))
        proxies.append({'kind': kind, 'folder': folder, 'name': stem, 'info': info, 'binds': binds, 'deleted': deleted, 'v': pv, 'vt': pvt, 'f': pf})

    # (the clothes, made now: their skin is MakeHuman's helper surfaces, whose vertices must be kept)
    W = L.rig_weights()
    garments = mh_garments.build(base_v, base_f, base_g, W, N_BODY)
    keep = set(range(N_BODY))
    for g in garments.values():
        for b in g['binds']:
            keep.update(b[0])
    for p in proxies:
        for refs, _, _ in p['binds']:
            keep.update(refs)
        for k in ('x_scale', 'y_scale', 'z_scale'):
            if k in p['info']:
                keep.update(p['info'][k][:2])
    for j in JOINTS:
        keep.update(joint_ids[j])
    order = sorted(keep)
    new = {old: i for i, old in enumerate(order)}
    NV = len(order)

    blob = Blob()
    head = {'version': VERSION, 'nv': NV, 'nbody': N_BODY, 'posq': POS_Q, 'uvq': UV_Q, 'wq': W_Q, 'tq': T_Q, 'targets': {}, 'face': [], 'proxies': [], 'joints': {}}
    blob.add('pos', i16([clamp16(base_v[o][k] * POS_Q) for o in order for k in range(3)]))
    for j in JOINTS:
        head['joints'][j] = [new[i] for i in joint_ids[j]]

    # The body's render vertices: one per (vertex, uv) pair of its faces, triangles from its quads
    pairs, rmap, ruv, tris = {}, [], [], []
    for g, corners in base_f:
        if g != 'body':
            continue
        ids = []
        for vi, ti in corners:
            key = (vi, ti)
            if key not in pairs:
                pairs[key] = len(rmap)
                rmap.append(new[vi])
                u, w = base_vt[ti]
                ruv.extend((int(round(u * 65535)), int(round(w * 65535))))
            ids.append(pairs[key])
        for i in range(1, len(ids) - 1):
            tris.extend((ids[0], ids[i], ids[i + 1]))
    if len(rmap) > 65535:
        die('too many body render vertices for uint16')
    blob.add('body.rmap', u16(rmap))
    blob.add('body.uv', u16(ruv))
    blob.add('body.idx', u16(tris))
    head['body'] = {'nr': len(rmap), 'ntri': len(tris) // 3}

    # Arm weights for the standing pose (upper arm; forearm with hand and fingers), from the CC0 game-engine weights
    up, low = [0.0] * NV, [0.0] * NV   # (every kept vertex: the clothes are bound to the helpers, which the rig weighs too)
    for side in ('l', 'r'):
        for names, acc in ((ARM_UP, up), (ARM_LOW, low)):
            for b in names:
                for vi, w in W.get('%s_%s' % (b, side), []):
                    if vi in new:
                        acc[new[vi]] += w
    blob.add('body.arm', bytes(min(255, int(round(x * 255))) for pair in zip(up, low) for x in pair))
    # The skin weights of the game's skeleton (plan CR P5): per kept vertex its four heaviest game bones and their weights,
    # summing 255 (a bound mesh takes its three base vertices'; src/three/mh/rig.js)
    acc = [dict() for _ in range(NV)]
    for b, lst in W.items():
        gb = GAME_BONES.index(game_bone(b))
        for vi, w in lst:
            if vi in new and w > 0:
                a = acc[new[vi]]
                a[gb] = a.get(gb, 0.0) + w
    skin = bytearray(NV * 8)
    for i, a in enumerate(acc):
        top = sorted(a.items(), key=lambda kv: -kv[1])[:4] or [(0, 1.0)]
        tot = sum(w for _, w in top)
        q = [int(round(w / tot * 255)) for _, w in top]
        q[0] += 255 - sum(q)
        for k, (gb, _) in enumerate(top):
            skin[i * 8 + k] = gb
            skin[i * 8 + 4 + k] = q[k]
    blob.add('body.skin', bytes(skin))
    head['bones'] = GAME_BONES

    # Targets: macro (sex x age x muscle x weight corners, origins, height and proportions at the average corner, adults
    # only) and the face sliders (left and right merged)
    def put_target(name, offs):
        acc = {}
        for vi, dx, dy, dz in offs:
            if vi in new:
                a = acc.setdefault(new[vi], [0.0, 0.0, 0.0])
                a[0] += dx
                a[1] += dy
                a[2] += dz
        acc = {k: d for k, d in acc.items() if max(abs(d[0]), abs(d[1]), abs(d[2])) > 2e-5}
        if not acc:
            return False
        ks = sorted(acc)
        # (indices as gaps, one byte each with 255 carrying on; offsets in tenths of a millimetre, each axis as the
        # difference from the entry before, low bytes then high bytes: gzip packs that three times better)
        gaps, prev = bytearray(), -1
        for k in ks:
            g, prev = k - prev - 1, k
            while g >= 255:
                gaps.append(255)
                g -= 255
            gaps.append(g)
        planes = []
        for c in range(3):
            last, lo, hi = 0, bytearray(), bytearray()
            for k in ks:
                q = clamp16(acc[k][c] / T_Q)
                d, last = (q - last) & 0xFFFF, q
                lo.append(d & 255)
                hi.append(d >> 8)
            planes += [bytes(lo), bytes(hi)]
        blob.add('t.' + name + '.i', bytes(gaps))
        blob.add('t.' + name + '.d', b''.join(planes))
        head['targets'][name] = {'n': len(ks)}
        return True

    for sex in SEXES:
        for age in AGES:
            for mus in LEVELS:
                for wt in LEVELS:
                    rel = 'universal-%s-%s-%smuscle-%sweight' % (sex, age, mus, wt)
                    put_target(rel, parse_target(L.text('targets/macrodetails/%s.target' % rel)))
            for o in ORIGINS:
                rel = '%s-%s-%s' % (o, sex, age)
                put_target(rel, parse_target(L.text('targets/macrodetails/%s.target' % rel)))
            for h in ('min', 'max'):
                rel = '%s-%s-averagemuscle-averageweight-%sheight' % (sex, age, h)
                put_target('height-' + rel, parse_target(L.text('targets/macrodetails/height/%s.target' % rel)))
            for pr in ('ideal', 'uncommon'):
                rel = '%s-%s-averagemuscle-averageweight-%sproportions' % (sex, age, pr)
                put_target('prop-' + rel, parse_target(L.text('targets/macrodetails/proportions/%s.target' % rel)))

    # The chest (women): MakeHuman's breast size at each age, muscle and weight corner, the cup min and max
    for age in AGES:
        for mus in LEVELS:
            for wt in LEVELS:
                for cup in ('min', 'max'):
                    rel = 'female-%s-%smuscle-%sweight-%scup-averagefirmness' % (age, mus, wt, cup)
                    put_target('breast-' + rel, parse_target(L.text('targets/breast/%s.target' % rel)))
    # The expressions, per origin (blended by the look's origin, like the body)
    head['expr'] = [e for e, _ in EXPR]
    for eid, units in EXPR:
        for o in ORIGINS:
            offs = []
            for u in units:
                offs.extend(parse_target(L.text('targets/expression/units/%s/%s.target' % (o, u))))
            put_target('expr.%s.%s' % (eid, o), offs)

    for group, sid, neg, pos in FACE:
        entry = {'id': sid, 'group': group}
        for sign, files in (('neg', neg), ('pos', pos)):
            offs = []
            for f in files:
                for s in (('l', 'r') if '{s}' in f else ('',)):
                    offs.extend(parse_target(L.text('targets/%s.target' % f.replace('{s}', s))))
            if put_target('face.%s.%s' % (sid, sign), offs):
                entry[sign] = 'face.%s.%s' % (sid, sign)
        head['face'].append(entry)

    # The chest: no breast targets yet (a download for P2), so a soft bulge of our own on the two breast areas; the weight
    # of each body vertex, found on the base mesh from the nipple height and the chest's front
    sh = [(base_v[i][0], base_v[i][1], base_v[i][2]) for i in joint_ids['joint-l-shoulder']]
    shy = sum(p[1] for p in sh) / len(sh)
    shx = sum(abs(p[0]) for p in sh) / len(sh)
    cy, cx = shy - 1.25, shx * 0.52
    front = max(base_v[i][2] for i in range(N_BODY) if abs(base_v[i][1] - cy) < 0.15 and abs(abs(base_v[i][0]) - cx) < 0.15)
    chest = []
    for i in range(N_BODY):
        x, y, z = base_v[i]
        d2 = ((abs(x) - cx) / 0.85) ** 2 + ((y - cy) / 0.75) ** 2
        w = math.exp(-d2 * 2.2) if z > front - 1.2 and abs(x) > 0.08 else 0.0
        chest.append(min(255, int(round(w * 255))))
    blob.add('body.chest', bytes(chest))
    head['chest'] = {'cx': cx, 'cy': cy, 'front': front}

    # Bound meshes
    waist = sum(base_v[i][1] for i in joint_ids['joint-pelvis']) / len(joint_ids['joint-pelvis']) + 1.8
    for p in proxies:
        info, binds = p['info'], p['binds']
        refs = [new[r] for b in binds for r in b[0]]
        ws = [clamp16(w * W_Q) for b in binds for w in b[1]]   # (raw: some go past 1 or below 0, the mesh reaching out)
        m = max(max(abs(x) for x in b[2]) for b in binds) or 1e-6
        sc = m / 32767.0
        offs = [clamp16(b[2][c] / sc) for b in binds for c in range(3)]
        pairs, prmap, puv, ptri, part = {}, [], [], [], []
        lower = None
        if p['name'] in LOWER:
            fname, rule = LOWER[p['name']]
            lower = (texels(L, '%s/%s' % (p['folder'], fname), 128), rule)
        for _, corners in p['f']:
            ids = []
            us = [p['vt'][ti] for _, ti in corners if ti >= 0]
            cu = sum(u for u, _ in us) / max(1, len(us))
            cv = sum(v for _, v in us) / max(1, len(us))
            lo = 0
            if lower:
                (tw, th, rows), rule = lower
                row = rows[min(th - 1, max(0, int((1 - cv) * th)))]
                x = min(tw - 1, max(0, int(cu * tw))) * 3
                # (and below the waist: a blue collar or cuff of the shirt stays the shirt's)
                cy = sum(sum(w * base_v[r][1] for r, w in zip(*p['binds'][vi][:2])) for vi, _ in corners) / len(corners)
                lo = 1 if rule(row[x], row[x + 1], row[x + 2]) and cy < waist else 0
            for vi, ti in corners:
                key = (vi, ti, lo)
                if key not in pairs:
                    pairs[key] = len(prmap)
                    prmap.append(vi)
                    u, w = p['vt'][ti] if ti >= 0 else (0.0, 0.0)
                    puv.extend((clamp16(u * UV_Q), clamp16(w * UV_Q)))   # (some cards wrap past 1)
                    part.append(lo)
                ids.append(pairs[key])
            for i in range(1, len(ids) - 1):
                ptri.extend((ids[0], ids[i], ids[i + 1]))
        key = 'p.' + p['name']
        blob.add(key + '.refs', u16(refs))
        blob.add(key + '.w', i16(ws))
        blob.add(key + '.off', i16(offs))
        blob.add(key + '.rmap', u16(prmap))
        blob.add(key + '.uv', i16(puv))
        blob.add(key + '.idx', u16(ptri))
        if lower:
            blob.add(key + '.part', bytes(part))
        dels = sorted(new[d] for d in set(p['deleted']) if d in new and d < N_BODY)
        if dels:
            blob.add(key + '.del', u16(dels))
        scale = {k: [new[info[k][0]], new[info[k][1]], info[k][2]] for k in ('x_scale', 'y_scale', 'z_scale') if k in info}
        head['proxies'].append({'kind': p['kind'], 'name': p['name'], 'nv': len(binds), 'nr': len(prmap), 'ntri': len(ptri) // 3,
                                'off': sc, 'scale': scale, 'del': len(dels), 'part': bool(lower)})

    # The medieval clothes (P3), made by tools/mh_garments.py on the base mesh and bound to its skin: per vertex a skin
    # triangle, the barycentric point on it and an offset along its normal
    head['garments'] = []
    for name, g in garments.items():
        key = 'g.' + name
        blob.add(key + '.refs', u16([new[r] for b in g['binds'] for r in b[0]]))
        blob.add(key + '.w', i16([clamp16(w * W_Q) for b in g['binds'] for w in b[1]]))
        m = max(max(abs(x) for x in b[2]) for b in g['binds']) or 1e-6
        blob.add(key + '.off', i16([clamp16(x / (m / 32767.0)) for b in g['binds'] for x in b[2]]))   # (along the first edge, across, along the normal)
        blob.add(key + '.rmap', u16([r[0] for r in g['rv']]))
        blob.add(key + '.uv', i16([clamp16(x * UV_Q) for r in g['rv'] for x in (r[1], r[2])]))
        blob.add(key + '.idx', u16([i for t in g['tri'] for i in t]))
        # (part, distance to a seam and to the border in millimetres, ambient occlusion)
        blob.add(key + '.att', bytes(x for r in g['rv'] for x in (r[3], min(255, int(r[4] * 1000)), min(255, int(r[5] * 1000)), int(r[6] * 255))))
        if g['cover']:
            blob.add(key + '.del', u16([new[i] for i in g['cover']]))
        head['garments'].append({'name': name, 'nv': len(g['binds']), 'nr': len(g['rv']), 'ntri': len(g['tri']), 'off': m / 32767.0, 'del': len(g['cover'])})

    head['blobs'] = blob.index
    hj = json.dumps(head, separators=(',', ':'), sort_keys=True).encode('utf-8')
    hj += b' ' * ((-len(hj)) % 4)
    data = b'MHP1' + struct.pack('<I', len(hj)) + hj + b''.join(blob.parts)
    return data, L


def png_read(path):
    """An 8-bit, non-interlaced PNG (what sips writes) as (width, height, channels, rows of bytes)."""
    with open(path, 'rb') as fh:
        raw = fh.read()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        die('not a PNG: ' + path)
    pos, idat, w = 8, [], 0
    while pos < len(raw):
        n, kind = struct.unpack('>I4s', raw[pos:pos + 8])
        body = raw[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, lace = struct.unpack('>IIBBBBB', body)
            if depth != 8 or lace:
                die('unsupported PNG: ' + path)
            ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
        elif kind == b'IDAT':
            idat.append(body)
        pos += 12 + n
    data, stride, rows, prev = zlib.decompress(b''.join(idat)), w * ch, [], bytearray(w * ch)
    for y in range(h):
        f, line = data[y * (stride + 1)], bytearray(data[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                line[i] = (line[i] + ((line[i - ch] if i >= ch else 0) + prev[i]) // 2) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b, c = prev[i], prev[i - ch] if i >= ch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, ch, rows


def png_write(path, w, h, ch, rows):
    ctype = {1: 0, 3: 2}[ch]
    raw = b''.join(b'\0' + bytes(r) for r in rows)
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
                 + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def split_alpha(png, color_out, alpha_out, tmp):
    """A card texture with alpha as two smaller files: the colour as JPEG (the see-through texels filled with the mean
    colour, so nothing of MakeHuman's magenta bleeds at the edges) and the alpha as a grey PNG."""
    w, h, ch, rows = png_read(png)
    if ch != 4:
        die('no alpha: ' + png)
    sr = sg = sb = n = 0
    for r in rows:
        for x in range(w):
            if r[x * 4 + 3] > 200:
                sr += r[x * 4]; sg += r[x * 4 + 1]; sb += r[x * 4 + 2]; n += 1
    mean = (sr // max(1, n), sg // max(1, n), sb // max(1, n))
    rgb, alpha = [], []
    for r in rows:
        line, al = bytearray(w * 3), bytearray(w)
        for x in range(w):
            a = r[x * 4 + 3]
            al[x] = a
            if a < 128:
                line[x * 3:x * 3 + 3] = bytes(mean)
            else:
                line[x * 3:x * 3 + 3] = r[x * 4:x * 4 + 3]
        rgb.append(line)
        alpha.append(al)
    png_write(alpha_out, w, h, 1, alpha)
    png_write(tmp, w, h, 3, rgb)
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', tmp, '--out', color_out], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.remove(tmp)


def texels(L, rel, side):
    """A texture, small, as rows of RGB bytes (to tell the parts of a garment apart)."""
    L.asset(rel, header=False)
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, '.tmp-texels')
    for cmd in (['sips', '-s', 'format', 'tiff', '-Z', str(side), os.path.join(L.user, rel), '--out', tmp + '.tiff'], ['sips', '-s', 'format', 'png', tmp + '.tiff', '--out', tmp + '.png']):
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    w, h, ch, rows = png_read(tmp + '.png')
    os.remove(tmp + '.tiff')
    os.remove(tmp + '.png')
    return w, h, [bytes(r[x * ch + k] for x in range(w) for k in range(3)) for r in rows]


def textures(L, out):
    """Resized copies with sips (macOS's own image tool): skins as JPEG, cards with their alpha as PNG."""
    made = []
    for rel, name, side, fmt in TEXTURES:
        L.asset(rel, header=False)
        src = os.path.join(L.user, rel)
        dst = os.path.join(out, name)
        if fmt == 'split':
            # (resized first by sips, then split: colour .jpg and alpha .a.png)
            # (by way of TIFF: sips keeps a PNG's interlacing, and a TIFF made into PNG comes out plain)
            tmp, tif = os.path.join(out, '.tmp-' + name + '.png'), os.path.join(out, '.tmp-' + name + '.tiff')
            for cmd in (['sips', '-s', 'format', 'tiff', '-Z', str(side), src, '--out', tif], ['sips', '-s', 'format', 'png', tif, '--out', tmp]):
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            os.remove(tif)
            split_alpha(tmp, dst + '.jpg', dst + '.a.png', tmp + '.rgb.png')
            os.remove(tmp)
            made += [(name + '.jpg', os.path.getsize(dst + '.jpg')), (name + '.a.png', os.path.getsize(dst + '.a.png'))]
            continue
        cmd = ['sips', '-s', 'format', fmt, '-Z', str(side)]
        if fmt == 'jpeg':
            cmd += ['-s', 'formatOptions', '82']
        subprocess.run(cmd + [src, '--out', dst], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        made.append((name, os.path.getsize(dst)))
    return made


LEDGER_BEGIN, LEDGER_END = '<!-- mh_pack:begin -->', '<!-- mh_pack:end -->'
GITHUB = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/'
HOW = {'header': 'cabecera CC0 ("This asset was explicitly released as CC0 in september 2020")',
       'pack index': 'CC0 en el índice de MPFB (`packs/makehuman_system_assets.json`: "license": "CC0")',
       'its .mhclo header': 'cabecera CC0 de su `.mhclo`', 'licence field': 'campo `"license": "CC0"` del propio archivo'}


def ledger(used):
    """The licence ledger of every input, in assets/LICENCIAS.md between its markers (written again on every run)."""
    rows = []
    for label, (sha, how) in sorted(used.items()):
        if label.startswith('makehuman/data/'):
            rel = label[len('makehuman/data/'):]
            day = '2026-11-26' if rel.startswith(('3dobjs/', 'targets/macrodetails/')) else '2026-11-27'
            origin = '[GitHub](%s%s), %s' % (GITHUB, rel, day)
        elif label.startswith('mpfb/system_assets/'):
            rel = label[len('mpfb/system_assets/'):]
            origin = 'MPFB 2.0.18, paquete "MakeHuman system assets" (`mpfb/data/%s`)' % rel
        else:
            rel = label[len('mpfb/data/'):]
            origin = 'MPFB 2.0.18 (`mpfb/data/%s`)' % rel
        rows.append('| `%s` | %s | %s | `%s` |' % (rel, origin, HOW[how], sha))
    return '\n'.join([LEDGER_BEGIN, '| Archivo | De dónde | Licencia comprobada | SHA-256 (inicio) |', '|---|---|---|---|'] + rows + [LEDGER_END])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True, help="makehuman/data's layout: 3dobjs/base.obj and targets/")
    ap.add_argument('--assets', default=MPFB_USER, help="MPFB's system assets (user data)")
    ap.add_argument('--rig', default=MPFB_SYS, help="MPFB's own data folder (the CC0 rig weights)")
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--no-tex', action='store_true')
    args = ap.parse_args()
    data, L = build(args)
    gz = gzip.compress(data, 9, mtime=0)
    dst = os.path.join(OUT, 'mh.bin.gz')
    if args.check:
        same = os.path.isfile(dst) and gzip.decompress(open(dst, 'rb').read()) == data
        print('mh.bin: %d bytes, gzip %d: %s' % (len(data), len(gz), 'same as the file' if same else 'DIFFERS from the file'))
        sys.exit(0 if same else 1)
    os.makedirs(OUT, exist_ok=True)
    with open(dst, 'wb') as fh:
        fh.write(gz)
    print('mh.bin.gz: %d bytes (raw %d)' % (len(gz), len(data)))
    if not args.no_tex:
        for name, size in textures(L, OUT):
            print('%s: %d bytes' % (name, size))
    with open(os.path.join(OUT, 'inputs.json'), 'w', encoding='utf-8') as fh:
        json.dump({k: {'sha256': v[0], 'check': v[1]} for k, v in sorted(L.used.items())}, fh, indent=1, sort_keys=True)
        fh.write('\n')
    lic = os.path.join(REPO, 'assets', 'LICENCIAS.md')
    with open(lic, encoding='utf-8') as fh:
        text = fh.read()
    if LEDGER_BEGIN in text:
        a, b = text.index(LEDGER_BEGIN), text.index(LEDGER_END) + len(LEDGER_END)
        with open(lic, 'w', encoding='utf-8') as fh:
            fh.write(text[:a] + ledger(L.used) + text[b:])
    else:
        print('assets/LICENCIAS.md has no %s marker: the ledger was not written' % LEDGER_BEGIN)


if __name__ == '__main__':
    main()
