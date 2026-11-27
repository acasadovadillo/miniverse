// MakeHuman's packed data for the new character creator (plan CR, ?creador=nuevo): the hm08 body, its shapes (macro and
// face targets) and the bound meshes (eyes, brows, lashes, hair, provisional clothes), all CC0, made by tools/mh_pack.py
// into assets/mh/mh.bin.gz. Loaded once, on the first person; each target is decoded the first time a look uses it.
const BASE = new URL('../../../assets/mh/', import.meta.url);
export const mhUrl = name => new URL(name, BASE).href;

let pending = null;
export const loadMh = () => (pending ||= fetchPack().catch(err => { pending = null; throw err; }));

async function fetchPack() {
  const res = await fetch(mhUrl('mh.bin.gz'));
  if (!res.ok) throw new Error(`mh.bin.gz: HTTP ${res.status}`);
  let bytes = new Uint8Array(await res.arrayBuffer());
  const raw = bytes.length;
  // (a server that sends it with Content-Encoding has already unpacked it: then it does not start with gzip's magic)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const D = parsePack(bytes.buffer);
  D.downloaded = raw;
  return D;
}

export function parsePack(buf) {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'MHP1') throw new Error('mh.bin: not a MakeHuman pack');
  const hlen = new DataView(buf).getUint32(4, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
  const start = 8 + hlen;
  const view = (name, T) => {
    const b = head.blobs[name];
    if (!b) return null;
    return new T(buf, start + b[0], b[1] / T.BYTES_PER_ELEMENT);
  };
  const D = { head, view, targets: new Map() };
  // The base: positions in MakeHuman's units (decimetres), as floats
  const q = view('pos', Int16Array), pos = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) pos[i] = q[i] / head.posq;
  D.pos = pos;
  D.nv = head.nv;
  D.body = { rmap: view('body.rmap', Uint16Array), uv: view('body.uv', Uint16Array), idx: view('body.idx', Uint16Array), arm: view('body.arm', Uint8Array), chest: view('body.chest', Uint8Array) };
  D.face = head.face;
  D.proxies = new Map(head.proxies.map(p => [p.name, p]));
  return D;
}

// One target, decoded: the vertices it moves and by how much (decimetres). Indices come as gaps (255 carries on) and the
// offsets as six byte planes (low and high byte of each axis), each value the difference from the one before
export function target(D, name) {
  let t = D.targets.get(name);
  if (t !== undefined) return t;
  const info = D.head.targets[name];
  if (!info) { D.targets.set(name, null); return null; }
  const n = info.n, gaps = D.view(`t.${name}.i`, Uint8Array), pl = D.view(`t.${name}.d`, Uint8Array);
  const idx = new Uint32Array(n), d = new Float32Array(n * 3), tq = D.head.tq;
  let g = 0, prev = -1;
  for (let k = 0; k < n; k++) {
    let gap = 0, b;
    do { b = gaps[g++]; gap += b; } while (b === 255);
    prev += gap + 1;
    idx[k] = prev;
  }
  for (let c = 0; c < 3; c++) {
    const lo = c * 2 * n, hi = lo + n;
    let acc = 0;
    for (let k = 0; k < n; k++) {
      acc = (acc + (pl[lo + k] | (pl[hi + k] << 8))) << 16 >> 16;
      d[k * 3 + c] = acc * tq;
    }
  }
  t = { idx, d };
  D.targets.set(name, t);
  return t;
}

// A bound mesh: per vertex its three base vertices, weights and offset; its render vertices (uv) and triangles
export function proxy(D, name) {
  const p = D.proxies.get(name);
  if (!p) return null;
  if (p.data) return p.data;
  const k = `p.${name}.`, w16 = D.view(k + 'w', Int16Array), o16 = D.view(k + 'off', Int16Array), uv16 = D.view(k + 'uv', Int16Array);
  const w = new Float32Array(w16.length), off = new Float32Array(o16.length), uv = new Float32Array(uv16.length);
  for (let i = 0; i < w.length; i++) w[i] = w16[i] / D.head.wq;
  for (let i = 0; i < off.length; i++) off[i] = o16[i] * p.off;
  for (let i = 0; i < uv.length; i++) uv[i] = uv16[i] / D.head.uvq;
  p.data = { refs: D.view(k + 'refs', Uint16Array), w, off, uv, rmap: D.view(k + 'rmap', Uint16Array), idx: D.view(k + 'idx', Uint16Array),
    part: p.part ? D.view(k + 'part', Uint8Array) : null, del: p.del ? D.view(k + 'del', Uint16Array) : null };
  return p.data;
}
