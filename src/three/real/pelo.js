/* pelo.js: peinados del creador de Miniverse. Casquete que sigue el cráneo, mechones opacos y textura de hebra, sin alpha.

   USO: se carga con <script src="parts/pelo.js"> antes o después de persona.js. persona.build lo usa solo:
     P.build({ sex: 'f', skin: '#e8b07a', hair: '#7a4a2a', hairStyle: 'largo', ... }, { det: 1 | 2, res: 512 | 1024 })
   hairStyle: corto, largo, coleta, rizado, mono, tupe, pinchos, cresta.
   look.hairVersion: pinchos 'puntas' (8-11 cm, sin pico único) | 'cepillo' (romo, 3-4 cm); cresta 'alta' (8-11 cm) | 'baja' (4 cm, borde romo).
   Lo demás (trenza, panuelo) sigue en persona.js. Sin este archivo, persona funciona con sus peinados de siempre.

   LO QUE EXPORTA: peinado(look) devuelve { cola, tapaOrejas, forma(C), malla(C), pinta(Q) } o null; ESTILOS, los ids; PRESUPUESTO, triángulos de la sección 4.2 a det 1.

   CÓMO ESTÁ HECHO
     - Coordenadas de cráneo (th, h): th en grados, 0 delante, 90 a la izquierda, 180 detrás; h en altos de cabeza, 0 barbilla, 1 coronilla.
     - casco(): el casquete, con grosor y borde por estilo. Lleva el bloque R.casco2 del lienzo (th en horizontal, de la coronilla al borde en vertical).
     - ruta(): camino sobre el cráneo. Se interpola en el mundo y se vuelve a apoyar, así cruza la coronilla sin saltos.
     - cae(): lo que cuelga: un hilo que cae y choca con cabeza, cuello, tronco y hombros, de ahí la caída sobre el pecho o la espalda.
     - cinta(): mechón de sección en tienda (4 triángulos por tramo) o cerrada (8). tubo(): sección de n lados, para colas, moños y rizos.
     - El contacto se hornea en oscV (etiqueta 'H'): raíz y bordes del mechón oscuros, y así se separan unos de otros sin más triángulos. */
LOOK.parts.pelo = (THREE, LOOK) => {
  const { sin, cos, abs, max, min, pow, hypot, atan2, floor, PI } = Math;
  const deg = r => r * 180 / PI;
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const G = (x, s) => Math.exp(-x * x / (2 * s * s));
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], vlen = a => hypot(a[0], a[1], a[2]);
  const vnorm = a => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const signo = x => (x < 0 ? -1 : 1);
  const nor180 = th => { let t = th; while (t > 180) t -= 360; while (t < -180) t += 360; return t; };
  const ruidoP = (th, y) => LOOK.fbm2((th + 180) / 30, y, 2, 12, 0);   // periódico en th

  // Líneas de nacimiento del pelo, por |th|: lo pintado en la cara (hl) y el borde del casquete (hlC)
  const HL = {
    corto: [[0, 0.785], [22, 0.782], [38, 0.755], [50, 0.71], [62, 0.665], [72, 0.625], [79, 0.585], [84, 0.52], [87, 0.45], [90, 0.45], [94, 0.60], [100, 0.50], [108, 0.40], [118, 0.33], [132, 0.285], [150, 0.26], [180, 0.25]],
    cortoC: [[0, 0.80], [22, 0.797], [38, 0.77], [50, 0.732], [62, 0.69], [72, 0.655], [84, 0.635], [94, 0.625], [100, 0.53], [108, 0.43], [118, 0.365], [132, 0.32], [150, 0.30], [180, 0.295]],
    recogido: [[0, 0.775], [14, 0.77], [30, 0.745], [48, 0.69], [64, 0.63], [78, 0.585], [90, 0.565], [100, 0.545], [115, 0.44], [135, 0.34], [160, 0.28], [180, 0.255]],
    largo: [[0, 0.785], [14, 0.775], [30, 0.74], [48, 0.68], [64, 0.60], [78, 0.51], [90, 0.42], [120, 0.33], [180, 0.26]],
    rizado: [[0, 0.72], [20, 0.715], [40, 0.675], [60, 0.585], [80, 0.46], [100, 0.36], [130, 0.27], [180, 0.215]],
  };

  // ================================================================ el taller: lo que comparten los peinados
  function Taller(C) {
    const { V, oscV, pv, idx, PH, PM, P, sec, padT, dirCraneo, yH, chin, H, zCab, d, det, R, rng, jx, jy } = C;
    const T = { C, grueso: null, borde: null, caida: 3.2 }, B = R.casco2, BM = R.mechon, Wh = { head: 1 }, cc = [0, yH(0.62), zCab - 0.01];

    const craneo = T.craneo = (th, h) => { const hh = min(h, 0.999), kq = sm(0.86, 0.95, hh); return kq < 1 ? vlerp(PM(th, hh), PH(th, hh), kq) : PH(th, hh); };
    const tCap = T.tCap = (th, h) => {
      if (!T.grueso) return 0;
      const ed = T.borde(th); if (h < ed) return 0;
      const s = pow(clamp((0.992 - h) / (0.992 - ed)), 1 / 1.6);
      return max(0, T.grueso(th, s, h) * (1 - pow(s, T.caida)));
    };
    // Coordenadas de cráneo del punto p, por el rayo desde el centro: vale también cerca de la coronilla
    const aCraneo = T.aCraneo = p => {
      const dx = p[0] - cc[0], dy = p[1] - cc[1], dz = p[2] - cc[2], th = deg(atan2(p[0] / (0.29 * H), (p[2] - zCab) / (0.40 * H))), el = atan2(dy, hypot(dx, dz));
      let a = 0.2, b = 0.999;
      for (let i = 0; i < 9; i++) { const m = (a + b) / 2, q = PH(th, m), e2 = atan2(q[1] - cc[1], hypot(q[0] - cc[0], q[2] - cc[2])); if (e2 < el) a = m; else b = m; }
      return [th, (a + b) / 2];
    };
    const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t, o = []; for (let i = 0; i < p1.length; i++) o.push(0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3)); return o; };
    const spline = T.spline = (ctrl, n) => {
      const o = [], m = ctrl.length - 1;
      for (let i = 0; i <= n; i++) { const u = i / n * m, j = min(floor(u), m - 1), t = u - j; o.push(cr(ctrl[max(j - 1, 0)], ctrl[j], ctrl[j + 1], ctrl[min(j + 2, m)], t)); }
      return o;
    };
    // Camino por encima del casquete. ctrl: [th, h, separación]; devuelve n + 1 puntos del mundo
    T.ruta = (ctrl, n) => {
      const mundo = ctrl.map(c => vadd(craneo(c[0], c[1]), vmul(dirCraneo(c[0], min(c[1], 0.999)), tCap(c[0], c[1]) + (c[2] || 0))));
      const sep = spline(ctrl.map(c => [c[2] || 0]), n);
      return spline(mundo, n).map((p, i) => { const q = aCraneo(p); return vadd(craneo(q[0], q[1]), vmul(dirCraneo(q[0], q[1]), tCap(q[0], q[1]) + sep[i][0])); });
    };
    // Empuja p fuera de cabeza, cuello, tronco y hombros, con cl de holgura
    const empuja = (p, cl, soloZ) => {
      let x = p[0], z = p[2]; const y = p[1], h = (y - chin) / H;
      if (h > -0.02 && h < 0.995) {
        const th = deg(atan2(x / (0.29 * H), (z - zCab) / (0.40 * H))), q = PH(th, h), rS = hypot(q[0], q[2] - zCab), r = hypot(x, z - zCab);
        if (r < rS + cl) { const k = (rS + cl) / (r || 1e-4); x *= k; z = zCab + (z - zCab) * k; }
      }
      if (h < 0.15 && soloZ) {   // soloZ -1 por la espalda, +1 por delante: se mueve solo en z y no se abre por encima de los hombros
        const yy = max(y, d.yP), s = sec(yy), a = s[0] + cl, e = s[4], ux = min(1, abs(x) / a);
        if (ux < 1) { const kk = pow(1 - pow(ux, 2 / e), e / 2); if (soloZ < 0) { const zb = s[3] - (s[2] + padT(yy, 180) + cl) * kk; if (z > zb) z = zb; } else { const zb = s[3] + (s[1] + padT(yy, 0) + cl) * kk; if (z < zb) z = zb; } }
        return [x, y, z];
      }
      if (h < 0.15) {
        const yy = max(y, d.yP), s = sec(yy), bz = z >= s[3] ? s[1] : s[2], th = deg(atan2(x / s[0], (z - s[3]) / bz)), q = P(th, yy, padT(yy, th)), rS = hypot(q[0], q[2] - s[3]), r = hypot(x, z - s[3]);
        if (r < rS + cl) { const k = (rS + cl) / (r || 1e-4); x *= k; z = s[3] + (z - s[3]) * k; }
        const rr = 0.064 + cl; let yR = y;
        for (const sg of [1, -1]) { const dx = x - sg * jx, dy = yR - jy, dz = z, dl = hypot(dx, dy, dz); if (dl < rr) { const k = rr / (dl || 1e-4); x = sg * jx + dx * k; yR = jy + dy * k; z = dz * k; } }
        return [x, yR, z];
      }
      return [x, y, z];
    };
    // El hilo que cae. o: g gravedad, cl holgura, yFin altura a la que para, guia(p) -> [x, z] al que tiende y kg su fuerza
    T.cae = (p0, d0, L, o = {}) => {
      const paso = 0.012, pts = [p0], g = o.g === undefined ? 0.2 : o.g, cl = o.cl === undefined ? 0.012 : o.cl; let p = p0, dr = vnorm(d0);
      for (let s = 0; s < L; s += paso) {
        let w = vadd(vmul(dr, 1 - g), [0, -g, 0]);
        if (o.guia) { const t = o.guia(p); w = vadd(w, [(t[0] - p[0]) * o.kg, 0, (t[1] - p[2]) * o.kg]); }
        dr = vnorm(w);
        const q = empuja(vadd(p, vmul(dr, paso)), cl, o.soloZ);
        dr = vnorm(vsub(q, p)); pts.push(q); p = q;
        if (o.yFin !== undefined && q[1] <= o.yFin) break;
      }
      return pts;
    };
    // Ondula un poco lo que cuelga, más cuanto más abajo: una regla no es pelo
    T.ondula = (pts, amp, ciclos, fase) => pts.map((p, i) => { const k = i / (pts.length - 1), a = amp * sm(0.1, 0.7, k); return [p[0] + a * sin(k * ciclos * 2 * PI + fase), p[1], p[2] + a * 0.4 * cos(k * ciclos * 1.3 * 2 * PI + fase)]; });
    // Reparte n + 1 puntos a igual distancia por la línea
    T.muestra = (pts, n) => {
      const ac = [0]; for (let i = 1; i < pts.length; i++) ac.push(ac[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
      const L = ac[ac.length - 1], o = []; let j = 0;
      for (let i = 0; i <= n; i++) { const t = L * i / n; while (j < pts.length - 2 && ac[j + 1] < t) j++; o.push(vlerp(pts[j], pts[j + 1], clamp((t - ac[j]) / ((ac[j + 1] - ac[j]) || 1e-6)))); }
      return o;
    };
    // Hacia fuera, en cualquier punto: rayo desde el centro del cráneo arriba, desde el eje del cuerpo abajo
    const afuera = T.afuera = p => {
      const k = sm(yH(-0.05), yH(0.18), p[1]), yb = clamp(p[1], d.yP, chin), cB = [0, p[1], sec(yb)[3]], c = vlerp(cB, [0, yH(0.58), zCab - 0.01], k);
      return vnorm(vsub(p, c));
    };
    // Peso de lo que cuelga: de la cabeza al tronco, por altura
    T.pesoCuelga = p => { const y = p[1], t = sm(yH(0.14), chin - 0.09, y), t2 = sm(chin - 0.02, chin - 0.14, y); return { head: 1 - t, neck: t * (1 - t2), torso: t * t2 }; };

    // Une dos anillos con las caras hacia fuera de su centro
    const puente = T.puente = (a, b) => {
      let c = [0, 0, 0]; for (const i of a) c = vadd(c, pv(i)); for (const i of b) c = vadd(c, pv(i)); c = vmul(c, 1 / (a.length + b.length));
      for (let j = 0; j < a.length - 1; j++) {
        const p0 = pv(a[j]), p1 = pv(a[j + 1]), p2 = pv(b[j + 1]), p3 = pv(b[j]), n = vcross(vsub(p2, p0), vsub(p3, p1)), cen = vmul(vadd(vadd(p0, p1), vadd(p2, p3)), 0.25);
        if (vdot(n, vsub(cen, c)) > 0) idx.push(a[j], a[j + 1], b[j + 1], a[j], b[j + 1], b[j]); else idx.push(a[j], b[j + 1], a[j + 1], a[j], b[j], b[j + 1]);
      }
    };

    const puenteFuera = (a, b) => {
      for (let j = 0; j < a.length - 1; j++) {
        const p0 = pv(a[j]), p1 = pv(a[j + 1]), p2 = pv(b[j + 1]), p3 = pv(b[j]), n = vcross(vsub(p2, p0), vsub(p3, p1)), cen = vmul(vadd(vadd(p0, p1), vadd(p2, p3)), 0.25);
        if (vdot(n, vsub(cen, cc)) > 0) idx.push(a[j], a[j + 1], b[j + 1], a[j], b[j + 1], b[j]); else idx.push(a[j], b[j + 1], a[j + 1], a[j], b[j], b[j + 1]);
      }
    };
    // Casquete. o: nT, nS, borde(th), grueso(th, s, h), osc(th, s, h), lump, caida, base
    T.casco = o => {
      T.borde = o.borde; T.grueso = o.grueso; T.caida = o.caida === undefined ? 3.2 : o.caida;
      const { nT, nS } = o, base = o.base === undefined ? 0.8 : o.base, lump = o.lump || 0, qA = vadd(PH(0, 0.9995), [0, o.grueso(0, 0, 1), 0]); let prev = null;
      for (let i = 1; i <= nS; i++) {
        const s = i / nS, ring = [];
        for (let j = 0; j <= nT; j++) {
          const th = -180 + 360 * j / nT, ed = o.borde(th), h = lerp(0.992, ed, pow(s, 1.6)), n = dirCraneo(th, h);
          const lu = (LOOK.fbm2((th + 180) / 36, s * 3.1 + 3.3, 2, 10, 0) - 0.5) * lump * sm(0.02, 0.25, s) * sm(0.95, 0.6, s);
          const t = i === nS ? 0.0012 : max(0.0015, o.grueso(th, s, h) * (1 - pow(s, T.caida)) + lu);
          const iv = V(vadd(craneo(th, h), vmul(n, t)), B.x + B.w * j / nT, B.y + B.h * s, Wh, 'pelo', 'H');
          oscV[iv] = (o.osc ? o.osc(th, s, h) : 1) * base; ring.push(iv);
        }
        if (prev) puenteFuera(prev, ring);
        else { const tapa = []; for (let j = 0; j <= nT; j++) { const iv = V(qA, B.x + B.w * j / nT, B.y + 0.6, Wh, 'pelo', 'H'); oscV[iv] = (o.osc ? o.osc(0, 0, 1) : 1) * base; tapa.push(iv); } puenteFuera(tapa, ring); }
        prev = ring;
      }
    };

    // Mechón. o: w medio ancho, alto cresta, baja cuánto se hunden los bordes, punta y raiz ancho relativo en los extremos, cerrada, peso(p), oscR y oscP oscuro de raíz y punta, sale(p)
    T.cinta = (pts, o = {}) => {
      const N = pts.length - 1, w0 = o.w === undefined ? 0.012 : o.w, alto = o.alto === undefined ? 0.003 : o.alto, baja = o.baja === undefined ? 0.0035 : o.baja, cerrada = !!o.cerrada;
      const punta = o.punta === undefined ? 0.12 : o.punta, raiz = o.raiz === undefined ? 0.45 : o.raiz, oscR = o.oscR === undefined ? 0.8 : o.oscR, oscP = o.oscP === undefined ? 1 : o.oscP, borde = o.borde === undefined ? 0.8 : o.borde, peso = o.peso || (() => Wh), sale = o.sale || afuera, afina = o.afina === undefined ? 0.5 : o.afina;
      const ac = [0]; for (let i = 1; i <= N; i++) ac.push(ac[i - 1] + vlen(vsub(pts[i], pts[i - 1])));
      const L = ac[N] || 1e-4, u0 = rng() * 0.7, wu = 0.28, vk = min(1, L / 0.34), v0 = rng() * (1 - vk);
      let pr = null;
      for (let i = 0; i <= N; i++) {
        const k = ac[i] / L, c = pts[i], flow = vnorm(vsub(pts[min(i + 1, N)], pts[max(i - 1, 0)])), lado = vnorm(vcross(flow, sale(c))), dir = vnorm(vcross(lado, flow));
        const w = w0 * (k < 0.2 ? lerp(raiz, 1, k / 0.2) : k > afina ? (o.redonda ? lerp(punta, 1, Math.sqrt(max(0, 1 - pow((k - afina) / (1 - afina), 2)))) : lerp(1, punta, pow((k - afina) / (1 - afina), 1.5))) : 1), a = alto * (w / w0), pw = peso(c);
        const vy = BM.y + BM.h * (v0 + vk * k), x0 = BM.x + BM.w * u0, xw = BM.w * wu, ob = lerp(oscR, oscP, sm(0, 0.6, k));
        const ring = [
          V(vadd(c, vadd(vmul(lado, -w), vmul(dir, -baja))), x0, vy, pw, 'mech', 'H', vnorm(vadd(dir, vmul(lado, -0.5)))),
          V(vadd(c, vmul(dir, a)), x0 + xw * 0.5, vy, pw, 'mech', 'H', dir),
          V(vadd(c, vadd(vmul(lado, w), vmul(dir, -baja))), x0 + xw, vy, pw, 'mech', 'H', vnorm(vadd(dir, vmul(lado, 0.5)))),
        ];
        oscV[ring[0]] = oscV[ring[2]] = ob * borde; oscV[ring[1]] = ob;
        if (cerrada) {
          const fondo = V(vadd(c, vmul(dir, -a - baja)), x0 + xw * 0.5, vy, pw, 'mech', 'H', vmul(dir, -1)), cierre = V(ring[0] === undefined ? c : pv(ring[0]), x0, vy, pw, 'mech', 'H', vnorm(vadd(dir, vmul(lado, -0.5))));
          oscV[fondo] = ob * 0.6; oscV[cierre] = ob * borde; ring.push(fondo, cierre);
        }
        if (pr) puente(pr, ring);
        pr = ring;
      }
    };
    // Tubo. rf(k) radio; o: n lados, peso(p, k), oscR, oscP, achata, tapa, u0 (franja del lienzo)
    T.tubo = (pts, rf, o = {}) => {
      const N = pts.length - 1, nL = o.n || 5, peso = o.peso || (() => Wh), oscR = o.oscR === undefined ? 0.78 : o.oscR, oscP = o.oscP === undefined ? 1 : o.oscP, u0 = o.u0 === undefined ? rng() * 0.7 : o.u0, ach = o.achata === undefined ? 1 : o.achata;
      let ac = 0; for (let i = 1; i <= N; i++) ac += vlen(vsub(pts[i], pts[i - 1]));
      const vk = min(1, ac / 0.34), v0 = rng() * (1 - vk), t0 = vnorm(vsub(pts[1], pts[0]));
      let Nn = vnorm(vcross(t0, abs(t0[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), pr = null;
      for (let i = 0; i <= N; i++) {
        const k = i / N, t = vnorm(vsub(pts[min(i + 1, N)], pts[max(i - 1, 0)]));
        Nn = vnorm(vsub(Nn, vmul(t, vdot(Nn, t))));
        const Bn = vcross(t, Nn), r = rf(k), ring = [], w = peso(pts[i], k), ob = lerp(oscR, oscP, sm(0, 0.7, k));
        for (let j = 0; j <= nL; j++) {
          const f = 2 * PI * j / nL, off = vadd(vmul(Nn, cos(f) * r), vmul(Bn, sin(f) * r * ach)), iv = V(vadd(pts[i], off), BM.x + BM.w * (u0 + 0.28 * j / nL), BM.y + BM.h * (v0 + vk * k), w, 'mech', 'H', vnorm(off));
          oscV[iv] = ob * (o.vetas ? lerp(0.82, 1, 0.5 + 0.5 * cos(f * 3)) : 1); ring.push(iv);
        }
        if (pr) puente(pr, ring);
        pr = ring;
      }
      if (o.tapa) { const iv = V(vadd(pts[N], vmul(vnorm(vsub(pts[N], pts[N - 1])), rf(1) * 0.5)), BM.x + BM.w * (u0 + 0.14), BM.y + BM.h * (v0 + vk), peso(pts[N], 1), 'mech', 'H'); oscV[iv] = oscP; C.fan(pr, iv); }
      return pr;
    };
    return T;
  }

  // ================================================================ pintura compartida
  function oscureceNacimiento(Q) {
    const { R, capa, oscu, suave, CX, CY, est } = Q, col = LOOK.mix(capa, oscu, 0.5), yy = t => CY(est.hl(abs(t)) + 0.004);
    suave(R.cara, 3, 'source-over', 0.8, k2 => { k2.fillStyle = col; k2.beginPath(); k2.moveTo(R.cara.x - 3, yy(180)); for (let t = -180; t <= 180; t += 2) k2.lineTo(CX(t), yy(t)); k2.lineTo(R.cara.x + R.cara.w + 3, yy(180)); k2.lineTo(R.cara.x + R.cara.w + 3, R.cara.y - 3); k2.lineTo(R.cara.x - 3, R.cara.y - 3); k2.closePath(); k2.fill(); });
  }
  // Hebras por líneas de flujo sobre R.casco2: flujo(th, s) devuelve la tangente [grados, s] de cada paso
  function pintaCasco(Q, flujo, o = {}) {
    const { g, R, capa, claro, oscu, rn, res, suave, relleno } = Q, r = R.casco2, UU = t => r.x + r.w * (t + 180) / 360, VV = v => r.y + r.h * v;
    oscureceNacimiento(Q);
    relleno(r, capa, 2);
    const traza = (k2, th0, s0, pasos, largo, ancho, col, al) => {
      let th = th0, s = s0; k2.strokeStyle = col; k2.globalAlpha = al; k2.lineWidth = ancho; k2.beginPath(); k2.moveTo(UU(th), VV(s));
      for (let i = 0; i < pasos; i++) { const f = flujo(th, s), l = hypot(f[0] / 180, f[1]) || 1; th += f[0] / l * largo; s += f[1] / l * largo / 180; k2.lineTo(UU(clamp(th, -180, 180)), VV(clamp(s))); }
      k2.stroke();
    };
    // Masas: bandas anchas y blandas, lo que se ve a distancia media
    suave(r, 4, 'multiply', (o.masa === undefined ? 0.36 : o.masa) * 0.55, k2 => { k2.lineCap = 'round'; for (let i = 0; i < 30; i++) traza(k2, -180 + rn() * 360, rn() * 0.8, 7, 7, 3 + rn() * 4, oscu, 0.5 + rn() * 0.5); k2.globalAlpha = 1; });
    suave(r, 4, 'screen', (o.brillo === undefined ? 0.2 : o.brillo) * 0.7, k2 => { k2.lineCap = 'round'; for (let i = 0; i < 30; i++) traza(k2, -180 + rn() * 360, rn() * 0.7, 6, 7, 1.6 + rn() * 2.4, claro, 0.5 + rn() * 0.5); k2.globalAlpha = 1; });
    // Hebras
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.lineCap = 'round'; g.lineJoin = 'round';
    const n = res > 512 ? 2600 : 1200;
    for (let i = 0; i < n; i++) { const cl = rn() < 0.42; traza(g, -180 + rn() * 360, rn(), 4 + floor(rn() * 4), 3 + rn() * 5, 0.2 + rn() * 0.36, cl ? claro : oscu, (cl ? 0.13 : 0.19) * (0.4 + rn() * 0.6)); }
    g.restore(); g.globalAlpha = 1;
    // Más oscuro en el borde y una luz mate alta
    const gg = g.createLinearGradient(0, r.y, 0, r.y + r.h); gg.addColorStop(0, 'rgba(0,0,0,0.05)'); gg.addColorStop(0.22, 'rgba(255,240,215,0.08)'); gg.addColorStop(0.5, 'rgba(255,240,215,0.02)'); gg.addColorStop(1, 'rgba(0,0,0,0.16)'); g.fillStyle = gg; g.fillRect(r.x, r.y, r.w, r.h);
  }
  // Hebras de los mechones: más contraste que el casquete, porque cada uno enseña poco lienzo
  function pintaMechon(Q) {
    const { g, R, capa, claro, oscu, rn, res, relleno } = Q, r = R.mechon;
    relleno(r, capa, 2);
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.lineCap = 'round';
    for (let i = 0; i < 26; i++) { const x = r.x + rn() * r.w; g.strokeStyle = rn() < 0.5 ? oscu : claro; g.globalAlpha = 0.06 + rn() * 0.08; g.lineWidth = 3 + rn() * 4; g.beginPath(); g.moveTo(x, r.y); g.bezierCurveTo(x + (rn() - 0.5) * 6, r.y + r.h * 0.33, x + (rn() - 0.5) * 6, r.y + r.h * 0.66, x + (rn() - 0.5) * 4, r.y + r.h); g.stroke(); }
    const n = res > 512 ? 1800 : 900;
    for (let i = 0; i < n; i++) { const x = r.x + rn() * r.w, y0 = r.y + rn() * r.h * 0.85, l = r.h * (0.1 + rn() * 0.3), cl = rn() < 0.42; g.strokeStyle = cl ? claro : oscu; g.globalAlpha = (cl ? 0.18 : 0.24) * (0.4 + rn() * 0.6); g.lineWidth = 0.2 + rn() * 0.4; g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + (rn() - 0.5) * 2.4, y0 + l * 0.5, x + (rn() - 0.5) * 2.4, y0 + l); g.stroke(); }
    g.restore(); g.globalAlpha = 1;
  }

  // ================================================================ peinados
  const barrido = look => ((look.semilla || 1) % 2 ? 1 : -1);
  const ESTILOS = {};

  // ---------------------------------------------------------------- corto: arriba con volumen y flequillo roto; lados y nuca pegados, oreja a la vista
  ESTILOS.corto = {
    forma: C => {
      const hl0 = C.curva1(HL.corto), hc0 = C.curva1(HL.cortoC), ent = a => (C.look.edad === 'mayor' ? 0.055 * G(a - 36, 15) + 0.02 * G(a, 22) : 0);
      return { hl: a => hl0(a) + ent(a), hlC: a => hc0(a) + ent(a), raya: false };
    },
    malla(T, C) {
      const { det, est, look, rng } = C, d2 = det > 1, sg0 = barrido(look), hE = t => est.hlC(abs(t)), seg = d2 ? 5 : 2;
      const borde = th => hE(th) - 0.014 * ruidoP(th, 7.3) * sm(40, 110, abs(th));
      T.casco({
        nT: d2 ? 56 : 28, nS: d2 ? 9 : 4, borde, lump: d2 ? 0.005 : 0.009,
        grueso: (th, s) => { const a = abs(th); return (0.019 + 0.006 * G(a, 42)) * lerp(1, 0.28, sm(48, 88, a) * sm(0.15, 0.6, s)) * lerp(1, 0.55, sm(112, 170, a) * sm(0.25, 0.8, s)); },
        osc: (th, s) => lerp(1, 0.82, sm(0.55, 1, s)),
      });
      if (!look.sombrero) {
        // Flequillo: mechones que salen de atrás, barridos a un lado, con la punta a alturas distintas sobre la frente
        const nF = d2 ? 20 : 5;
        for (let i = 0; i < nF; i++) {
          const t = lerp(-56, 56, (i + 0.5) / nF) + (rng() - 0.5) * (d2 ? 6 : 9), he = hE(t), corte = 0.004 + pow(rng(), 1.6) * (d2 ? 0.034 : 0.06);
          T.cinta(T.ruta([[t - sg0 * 24, min(0.95, he + 0.19), 0.006], [t - sg0 * 9, he + 0.07, 0.007], [t + sg0 * 3, he - corte, 0.0028]], d2 ? 9 : 3), { w: (d2 ? 0.0118 : 0.023) * (0.75 + rng() * 0.5), alto: 0.0034, punta: d2 ? 0.16 : 0.3, afina: 0.75, redonda: true, oscR: 0.86, borde: 0.86 });
        }
        // Remolino: la coronilla no queda lisa
        const nR = d2 ? 10 : 3;
        for (let i = 0; i < nR; i++) { const t = nor180(-180 + 360 * (i + 0.5) / nR + (rng() - 0.5) * 16); T.cinta(T.ruta([[nor180(t - sg0 * 50), 0.992, 0.002], [nor180(t - sg0 * 18), 0.955, 0.004], [t, 0.885, 0.003]], d2 ? 4 : 2), { w: (d2 ? 0.0135 : 0.023), alto: 0.0035, punta: 0.3, oscR: 0.9 }); }
        // Encima: del remolino hacia delante y a los lados
        const nA = d2 ? 18 : 4;
        for (let i = 0; i < nA; i++) {
          const t = lerp(-110, 110, (i + 0.5) / nA) + (rng() - 0.5) * 9, he = hE(t), e = (0.002 + rng() * 0.007) * lerp(1, 0.3, sm(45, 95, abs(t)));
          T.cinta(T.ruta([[t * 1.5 + sg0 * 20, 0.985, e * 0.5], [t * 1.15 + sg0 * 8, lerp(0.985, he, 0.42), e], [t + sg0 * 2, lerp(0.985, he, 0.82), e * 0.6 * lerp(1, 0.4, sm(45, 95, abs(t)))]], seg), { w: (d2 ? 0.0145 : 0.024) * (0.85 + rng() * 0.3), alto: 0.004, punta: 0.3, oscR: 0.86 });
        }
      }
      // Lados y nuca: cortos, hacia abajo y atrás, con la punta irregular
      for (const sg of [1, -1]) {
        const nL = d2 ? 7 : 2;
        for (let i = 0; i < nL; i++) { const a = lerp(68, 118, (i + 0.5) / nL) + rng() * 4, he = hE(a); T.cinta(T.ruta([[sg * (a - 8), min(0.86, he + 0.2), 0.001], [sg * (a - 1), he + 0.09, 0.0015], [sg * (a + 5), he - 0.006 - rng() * 0.018, 0.0012]], seg), { w: (d2 ? 0.0105 : 0.017), alto: 0.0022, baja: 0.002, punta: 0.3, oscR: 0.88 }); }
        const nB = d2 ? 8 : 3;
        for (let i = 0; i < nB; i++) { const a = lerp(124, 180, (i + 0.5) / nB) + (rng() - 0.5) * 4, he = hE(a); T.cinta(T.ruta([[sg * a, 0.88, 0.002], [sg * a, lerp(0.88, he, 0.55), 0.0025], [sg * (a + 1), he - 0.008 - rng() * 0.03, 0.0012]], seg), { w: (d2 ? 0.0125 : 0.021), alto: 0.0028, baja: 0.0025, punta: 0.34, oscR: 0.88 }); }
      }
    },
    pinta(Q) { const sg0 = barrido(Q.look); pintaCasco(Q, (th, s) => [sg0 * 26 * (1 - s) + (abs(th) > 100 ? 0 : 0), 1]); pintaMechon(Q); },
  };

  // ---------------------------------------------------------------- tupé: la frente alzada 4 cm en una ola ancha; lados pegados y peinados hacia atrás
  ESTILOS.tupe = {
    forma: C => {
      const hl0 = C.curva1(HL.corto), hc0 = C.curva1(HL.cortoC);
      return { hl: hl0, hlC: hc0, raya: false };
    },
    malla(T, C) {
      const { det, est, look, rng } = C, d2 = det > 1, sg0 = barrido(look), hE = t => est.hlC(abs(t)), seg = d2 ? 6 : 3;
      T.casco({
        nT: d2 ? 56 : 28, nS: d2 ? 11 : 5, caida: 7, lump: d2 ? 0.003 : 0.005, borde: th => hE(th) - 0.01 * ruidoP(th, 3.1) * sm(50, 110, abs(th)),
        grueso: (th, s) => {
          const a = abs(th), ola = 0.042 * G(th - sg0 * 7, 38) * G(s - 0.74, 0.26);
          return (ola + 0.015 + 0.006 * G(a, 70)) * lerp(1, 0.24, sm(52, 90, a) * sm(0.1, 0.5, s)) * lerp(1, 0.5, sm(112, 170, a) * sm(0.3, 0.8, s));
        },
        osc: (th, s) => lerp(1, 0.8, sm(0.8, 1, s) * sm(70, 30, abs(th)) + 0.75 * sm(0.55, 1, s) * sm(50, 90, abs(th))),
      });
      // La ola: mechones anchos que nacen en la frente, suben y se van hacia atrás. Sin pico: las puntas se hunden en el casquete
      const nQ = d2 ? 15 : 6;
      for (let i = 0; i < nQ; i++) {
        const t = lerp(-56, 56, (i + 0.5) / nQ) + (rng() - 0.5) * 5, he = hE(t), off = sg0 * (6 + rng() * 5);
        T.cinta(T.ruta([[t, he + 0.004, 0.001], [t + off * 0.5, he + 0.05, 0.007], [t + off, he + 0.14, 0.007], [t * 0.8 + off * 1.3, min(0.97, he + 0.2), -0.006]], seg), { w: (d2 ? 0.0145 : 0.024) * (0.9 + rng() * 0.25), alto: 0.0045, raiz: 0.75, punta: 0.3, oscR: 0.74, oscP: 1 });
      }
      for (const sg of [1, -1]) {
        // Lados peinados hacia atrás, tirantes
        const nL = d2 ? 3 : 2;
        for (let i = 0; i < nL; i++) { const k = (i + 0.5) / nL, h0 = lerp(0.60, 0.84, k) + (rng() - 0.5) * 0.03, a0 = 64 + rng() * 14; T.cinta(T.ruta([[sg * a0, h0, 0.0002], [sg * (a0 + 32), h0 + 0.012 + rng() * 0.015, 0.001], [sg * (a0 + 62 + rng() * 14), h0 - 0.05, 0.0002]], seg), { w: (d2 ? 0.019 : 0.021) * (0.8 + rng() * 0.4), alto: 0.0012, baja: 0.002, punta: 0.3, oscR: 0.97, borde: 0.95 }); }
        const nB = d2 ? 8 : 3;
        for (let i = 0; i < nB; i++) { const a = lerp(112, 180, (i + 0.5) / nB) + (rng() - 0.5) * 4, he = hE(a); T.cinta(T.ruta([[sg * (a - 14), 0.985, 0.001], [sg * a, lerp(0.985, he, 0.5), 0.002], [sg * a, he - 0.006 - rng() * 0.022, 0.001]], d2 ? 5 : 2), { w: d2 ? 0.0135 : 0.022, alto: 0.0026, baja: 0.0022, punta: 0.34, oscR: 0.88 }); }
      }
    },
    pinta(Q) { const sg0 = barrido(Q.look); pintaCasco(Q, (th, s) => { const a = abs(th); return [a < 70 ? sg0 * 18 : signo(th) * sm(70, 110, a) * 26 * (1 - s), 1]; }, { masa: 0.42 }); pintaMechon(Q); },
  };

  // ---------------------------------------------------------------- largo: raya en medio, cortinas hasta 1,18 m; caen delante del hombro y por la espalda
  ESTILOS.largo = {
    tapaOrejas: true,
    forma: C => { const hl = C.curva1(HL.largo); return { hl, hlC: a => hl(a) + 0.012 - 0.07 * G(a - 96, 16), raya: true }; },
    malla(T, C) {
      const { det, est, rng, chin, H, d, sec, V, oscV, R, bridge, zCab } = C, d2 = det > 1, BM = R.mechon, off = 2.5 * barrido(C.look), hE = t => est.hlC(abs(t)), yFin = 1.18;
      const raya = th => abs(nor180(th - off));
      T.casco({
        nT: d2 ? 56 : 28, nS: d2 ? 8 : 3, lump: d2 ? 0.003 : 0.006, borde: th => hE(th),
        grueso: (th, s) => { const a = abs(th); return (0.0125 + 0.0065 * sm(15, 85, a)) * (1 - 0.6 * G(raya(th), 4.5) * sm(1, 0.35, s) * sm(120, 40, a)); },
        osc: (th, s) => lerp(1, 0.86, sm(0.6, 1, s)) * lerp(0.74, 1, sm(0, 6, raya(th)) + sm(110, 150, abs(th))),
      });
      const zPecho = y => { const s = sec(clamp(y, d.yP, chin)); return s[3] + s[1] + 0.012; }, zEspalda = y => { const s = sec(clamp(y, d.yP, chin)); return s[3] - s[2] - 0.016; };

      // Pared trasera: filas de hilos que caen del occipital. Dos caras: la de dentro, oscura, tapa el hueco detrás del cuello
      const cols = d2 ? 28 : 10, filas = d2 ? 9 : 4, thA = 84, colsP = [], colsI = [];
      for (let j = 0; j <= cols; j++) {
        const th = nor180(lerp(thA, 360 - thA, j / cols)), a = abs(th), h0 = 0.64, n0 = C.dirCraneo(th, h0), p0 = vadd(T.craneo(th, h0), vmul(n0, T.tCap(th, h0) * 0.7));
        const fin = yFin + 0.014 * ruidoP(th, 11.5) + 0.08 * sm(150, 110, a), hilo = T.cae(p0, [n0[0] * 0.25, -1, n0[2] * 0.4], 1.1, { g: 0.32, cl: 0.011, yFin: fin, soloZ: -1, kg: 0.24, guia: p => [p[0] * 0.965, zEspalda(p[1]) - 0.006] }), pts = T.ondula(T.muestra(hilo, filas), 0.004, 1.6, th * 0.09), col = [];
        pts.forEach((p, r) => { const iv = V(p, BM.x + BM.w * 0.9 * j / cols, BM.y + BM.h * 0.9 * r / filas, T.pesoCuelga(p), 'pelo', 'H'); oscV[iv] = lerp(0.74, 0.86, r / filas); col.push(iv); });
        colsP.push(col);
        const colI = []; pts.forEach((p, r) => { const iv = V(p, BM.x + BM.w * 0.9 * j / cols, BM.y + BM.h * 0.9 * r / filas, T.pesoCuelga(p), 'mono', 'H'); oscV[iv] = 0.62; colI.push(iv); });
        colsI.push(colI);
      }
      for (let j = 0; j < cols; j++) {
        const th = nor180(lerp(thA, 360 - thA, (j + 0.5) / cols)), n = C.dirCraneo(th, 0.6), out = [n[0], 0, n[2]];
        bridge(colsP[j], colsP[j + 1], out);
        bridge(colsI[j], colsI[j + 1], [-out[0], 0, -out[2]]);
      }
      // Mechones de la espalda, de la raya abajo, por encima de la pared. Las puntas se pasan de largo: el final no es recto
      const nB = d2 ? 18 : 6, tramos = d2 ? 18 : 4;
      for (let i = 0; i < nB; i++) {
        const k = (i + 0.5) / nB, th = nor180(lerp(118, 242, k) + (rng() - 0.5) * 6), sg = signo(th), a = abs(th);
        const ruta = T.ruta([[off + sg * 5, 0.962, 0], [sg * lerp(52, 120, sm(110, 180, a)), 0.90, 0.002], [th, 0.76, 0.006], [th, 0.60, 0.007]], d2 ? 12 : 4), fin = T.ruta([[th, 0.62, 0.007], [th, 0.60, 0.007]], 1)[1];
        const hilo = T.cae(fin, [0, -1, 0], 1.1, { g: 0.3, cl: 0.018, soloZ: -1, yFin: yFin - 0.015 - rng() * 0.05 + 0.07 * sm(150, 118, a), kg: 0.24, guia: p => [p[0] * 0.965, zEspalda(p[1]) - 0.012] });
        T.cinta(T.ondula(T.muestra(ruta.concat(hilo.slice(1)), tramos + 2), 0.0055, 1.4 + rng(), rng() * 6), { w: (d2 ? 0.017 : 0.028) * (0.85 + rng() * 0.3), alto: 0.0042, baja: 0.003, punta: 0.3, afina: 0.78, raiz: 0.25, oscR: 0.92, borde: 0.84, peso: T.pesoCuelga });
      }
      // Cortinas: delante, enmarcan la cara y caen sobre el pecho; las de atrás pasan por la oreja y se van detrás del hombro
      const planes = d2
        ? [[0.07, 58, 72, 1, 0.0165], [0.088, 62, 80, 1, 0.018], [0.106, 70, 88, 1, 0.018], [0.12, 78, 94, 1, 0.017], [0.112, 88, 104, -1, 0.018], [0.09, 96, 112, -1, 0.019]]
        : [[0.078, 60, 76, 1, 0.027], [0.108, 74, 92, 1, 0.029], [0.098, 92, 110, -1, 0.03]];
      for (const sg of [1, -1]) for (const [xG, a1, a2, lado, w] of planes) {
        const ruta = T.ruta([[off + sg * 3.5, 0.93 + (a1 - 60) * 0.0012, 0.002], [sg * (a1 * 0.45), 0.875, 0.004], [sg * a1, 0.73, 0.0045], [sg * a2, 0.56, 0.0055], [sg * (a2 + 3), 0.44, 0.0068]], d2 ? 12 : 3), ult = ruta[ruta.length - 1];
        const hilo = T.cae(ult, [0, -1, lado * 0.15], 1.0, { g: 0.26, cl: 0.015, soloZ: lado, yFin: yFin + 0.012 - rng() * 0.05, kg: 0.42, guia: p => [sg * xG, lado > 0 ? zPecho(p[1]) : zEspalda(p[1])] });
        T.cinta(T.ondula(T.muestra(ruta.concat(hilo.slice(1)), d2 ? 22 : 4), 0.005, 1.2 + rng(), rng() * 6), { w: w * (0.9 + rng() * 0.2), alto: 0.0055, baja: 0.0035, cerrada: true, punta: 0.3, afina: 0.74, raiz: 0.25, oscR: 0.92, borde: 0.84, peso: T.pesoCuelga });
      }
    },
    pinta(Q) {
      const off = 2.5 * barrido(Q.look), { g, R, piel, capa } = Q;
      pintaCasco(Q, (th, s) => { const a = abs(th), sg = signo(th - off); return [sg * lerp(70, 8, sm(0.15, 0.95, s)) * sm(125, 80, a), lerp(0.3, 1, s) + sm(90, 130, a)]; });
      const r = R.casco2, x = r.x + r.w * (off + 180) / 360; g.strokeStyle = LOOK.mix(piel, capa, 0.6); g.lineWidth = 0.5; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(x, r.y + r.h * 0.35); g.lineTo(x, r.y + r.h); g.stroke(); g.globalAlpha = 1;
      pintaMechon(Q);
    },
  };

  // Recogidos: todo el pelo va a un punto del occipital
  const recogeHacia = (T, C, thA, hA, nDet1, nDet2) => {
    const { det, est, rng } = C, d2 = det > 1, n = d2 ? nDet2 : nDet1, seg = d2 ? 9 : 3, hE = t => est.hlC(abs(t));
    for (let i = 0; i < n; i++) {
      const t = lerp(-172, 172, (i + 0.5) / n) + (rng() - 0.5) * 5, a = abs(t), sg = signo(t), he = hE(t) + 0.024;
      T.cinta(T.ruta([[t, he, 0.0008], [sg * 178, hA + 0.012 * sm(150, 100, a), 0.0005]], a < 90 ? seg + (d2 ? 3 : 1) : seg), { w: (d2 ? 0.0125 : 0.021) * (0.9 + rng() * 0.2), alto: 0.0022, baja: 0.0024, raiz: 0.2, punta: 0.42, oscR: 0.95, borde: 0.89 });
    }
  };
  const cascoRecogido = (T, C) => {
    const d2 = C.det > 1, hE = t => C.est.hlC(abs(t));
    T.casco({
      nT: d2 ? 56 : 28, nS: d2 ? 8 : 4, lump: d2 ? 0.002 : 0.005, borde: th => hE(th),
      grueso: (th, s) => { const a = abs(th); return (0.0105 + 0.004 * sm(60, 140, a)) * lerp(1, 0.75, sm(70, 100, a) * sm(0.3, 0.8, s)); },
      osc: (th, s) => lerp(1, 0.85, sm(0.65, 1, s)),
    });
  };
  const flujoRecogido = (sA) => (th, s) => { const a = abs(th), sg = signo(th); return a < 95 ? [-th * 0.1, -1] : [sg * (180 - a) * 0.9, (sA - s) * 60]; };
  const atadura = (T, C, c, ax, r) => {   // atadura de tela o cuero: un aro corto
    const { R, V, oscV, det } = C, nL = det > 1 ? 10 : 6, RM = R.mono, a = vnorm(ax), e1 = vnorm(vcross(a, [0, 1, 0])), e2 = vcross(a, e1); let pr = null;
    for (const [dz, k] of [[-0.006, 0.95], [0, 1.05], [0.006, 0.95]]) {
      const ring = [];
      for (let j = 0; j <= nL; j++) { const f = 2 * PI * j / nL, off = vadd(vmul(e1, cos(f) * r * k), vmul(e2, sin(f) * r * k)), iv = V(vadd(vadd(c, vmul(a, dz)), off), RM.x + 2 + (RM.w - 4) * j / nL, RM.y + RM.h - 6, { head: 1 }, 'mono', 'H', vnorm(off)); oscV[iv] = 0.9; ring.push(iv); }
      if (pr) T.puente(pr, ring); pr = ring;
    }
  };
  const pintaAtadura = (Q) => { const { g, R } = Q, r = R.mono; g.fillStyle = LOOK.sobrio('#6d5c4c'); g.fillRect(r.x, r.y + r.h - 12, r.w, 12); };

  // ---------------------------------------------------------------- coleta: cola de 28 cm desde el occipital
  ESTILOS.coleta = {
    cola: true,
    forma: C => { const hl = C.curva1(HL.recogido); return { hl, hlC: a => hl(a) + 0.012, raya: false }; },
    malla(T, C) {
      const { det, rng, H, chin } = C, d2 = det > 1, hTie = 0.47;
      cascoRecogido(T, C);
      recogeHacia(T, C, 180, hTie, 8, 26);
      // La cola: varias guedejas que nacen de la atadura, se abren un poco y acaban a distinto largo
      const c0 = vadd(T.craneo(180, hTie), [0, 0, -T.tCap(180, hTie) - 0.012]), nG = d2 ? 7 : 3, sgL = barrido(C.look), yn = chin + 0.1 * H;
      const peso = (p, k) => { const wN = sm(0.06, 0.3, k), w2 = sm(0.3, 0.65, k); return { neck: (1 - wN) * 0.3, head: (1 - wN) * 0.7, torso: wN * (1 - w2), braid: wN * w2 }; };
      const eje = T.cae(c0, [sgL * 0.06, -0.75, -0.6], 0.34, { g: 0.22, cl: 0.024 }), L0 = 0.28;
      for (let i = 0; i < nG; i++) {
        const f = 2 * PI * i / nG + rng() * 0.5, L = L0 * (i === 0 ? 1.0 : 0.8 + rng() * 0.2), pasos = d2 ? 11 : 4, abre = 0.0125 + rng() * 0.004, pts = T.muestra(eje, 40).filter((_, j) => j / 40 * 0.34 <= L);
        const lista = T.muestra(pts, pasos).map((p, j) => { const k = j / pasos, sal = abre * sm(0, 0.2, k) * lerp(1, 0.75, sm(0.6, 1, k)); return [p[0] + cos(f + k * 1.2) * sal * 1.05, p[1], p[2] + sin(f + k * 1.2) * sal]; });
        const r0 = (d2 ? 0.0125 : 0.0165) * (0.9 + rng() * 0.2);
        T.tubo(lista, k => r0 * lerp(0.62, 1, sm(0, 0.16, k)) * lerp(1, 0.2, pow(k, 3.4)), { n: d2 ? 7 : 5, peso, oscR: 0.74, oscP: 1.0, achata: 0.82 });
      }
      atadura(T, C, vadd(c0, [0, -0.002, -0.004]), [0, 0.15, -1], 0.0165);
      void yn;
    },
    pinta(Q) { pintaCasco(Q, flujoRecogido(0.72), { masa: 0.3, brillo: 0.16 }); pintaMechon(Q); pintaAtadura(Q); },
  };

  // ---------------------------------------------------------------- moño: atrás, no en la coronilla. Una espiral de pelo, sin bola lisa
  ESTILOS.mono = {
    forma: C => { const hl = C.curva1(HL.recogido); return { hl, hlC: a => hl(a) + 0.012, raya: false }; },
    malla(T, C) {
      const { det, rng, m } = C, d2 = det > 1, hTie = 0.53;
      cascoRecogido(T, C);
      recogeHacia(T, C, 180, hTie, 8, 26);
      const k0 = m ? 1.06 : 1, c0 = vadd(T.craneo(180, hTie), [0, 0, -T.tCap(180, hTie) - 0.004]), a = vnorm([0, 0.16, -1]), e1 = [1, 0, 0], e2 = vcross(a, e1);
      // La espiral sale de fuera y acaba en el centro, en lo alto del moño
      const vueltas = d2 ? 2.7 : 1.45, n = d2 ? 58 : 12, pts = [];
      for (let i = 0; i <= n; i++) { const k = i / n, f = k * vueltas * 2 * PI + 0.7, rr = lerp(0.034, 0.004, pow(k, 0.85)) * k0, ax = lerp(0.008, 0.039, sm(0, 0.85, k)) * k0 - 0.008 * sm(0.8, 1, k), wob = 1 + 0.06 * sin(f * 2.3 + 1); pts.push(vadd(vadd(c0, vmul(a, ax)), vadd(vmul(e1, cos(f) * rr * wob), vmul(e2, sin(f) * rr * wob * 0.94)))); }
      const r0 = (d2 ? 0.0145 : 0.0185) * k0;
      T.tubo(pts, k => r0 * lerp(1, 0.62, k) * lerp(0.7, 1, sm(0, 0.1, k)), { n: d2 ? 7 : 5, oscR: 0.8, oscP: 1, tapa: true, u0: 0.1, vetas: d2 });
    },
    pinta(Q) { pintaCasco(Q, flujoRecogido(0.66), { masa: 0.3, brillo: 0.16 }); pintaMechon(Q); },
  };

  // ---------------------------------------------------------------- rizado: masa de lóbulos con valles oscuros y guedejas en S encima; tapa las orejas
  ESTILOS.rizado = {
    tapaOrejas: true,
    forma: C => { const hl = C.curva1(HL.rizado); return { hl, hlC: a => hl(a) + 0.008, raya: false }; },
    malla(T, C) {
      const { det, est, rng } = C, d2 = det > 1, hE = t => est.hlC(abs(t)), lobos = [], nL = d2 ? 170 : 30, rL = d2 ? 0.0175 : 0.037;
      const borde = th => hE(th) - 0.05 * (0.5 + 0.5 * sin(th * PI / 180 * (d2 ? 11 : 7) + 1.3)) - 0.02 * ruidoP(th, 5.5);
      // Lóbulos: lo que se solapan decide si hay valle o no. Unos 66 de 2,5 cm cubren el casquete casi sin pisarse
      for (let i = 0; i < nL; i++) {
        const k = (i + 0.5) / nL, th = nor180(i * 137.508 + (rng() - 0.5) * 14), s = pow(k, 0.5) * 1.02, h = lerp(0.985, borde(th) - 0.01, pow(min(s, 1), 1.6));
        lobos.push({ q: T.craneo(th, h), r: rL * (0.84 + rng() * 0.32) });
      }
      const campo = q => { let F = 0; for (const l of lobos) { const dd = hypot(q[0] - l.q[0], q[1] - l.q[1], q[2] - l.q[2]) / l.r; if (dd < 1) F = max(F, Math.sqrt(1 - dd * dd)); } return F; };
      T.casco({
        nT: d2 ? 132 : 36, nS: d2 ? 34 : 8, caida: 7, borde, base: 1,
        grueso: (th, s, h) => { const a = abs(th), b = 0.0165 + 0.006 * sm(50, 100, a); return b + (d2 ? 0.026 : 0.025) * campo(T.craneo(th, h)); },
        osc: (th, s, h) => lerp(LOOK.hsv(LOOK.sobrio(C.look.hair || '#3a2a20'))[2] > 0.5 ? 0.52 : 0.66, 1.03, pow(campo(T.craneo(th, h)), 0.7)) * lerp(1, 0.9, sm(0.85, 1, s)),
      });
      // Guedejas en S de la coronilla al borde. Las del borde se pasan y rompen la línea
      const nS = d2 ? 0 : 13;
      for (let i = 0; i < nS; i++) {
        const k = (i + 0.5) / nS, th0 = nor180(i * 137.508 + 40 + (rng() - 0.5) * 16), ed = borde(th0), u0 = pow(k, 0.55), h0 = d2 ? lerp(0.86, ed + 0.07, u0) : lerp(0.985, ed + 0.09, u0), largo = (d2 ? 0.1 : 0.26) + rng() * (d2 ? 0.06 : 0.12), sgS = rng() < 0.5 ? -1 : 1, am = (d2 ? 6 : 10) + rng() * 4, ctrl = [], nC = 6;
        for (let j = 0; j <= nC; j++) { const q = j / nC; ctrl.push([nor180(th0 + sgS * am * sin(q * 2 * PI * 1.25) * sm(0, 0.25, q)), max(ed - 0.07, h0 - largo * q), (d2 ? 0.0035 : 0.002) + (d2 ? 0.0035 : 0.005) * sin(q * PI)]); }
        if (d2) { const r0 = 0.0105 * (0.85 + rng() * 0.3); T.tubo(T.ruta(ctrl, 6), q => r0 * lerp(0.55, 1, sm(0, 0.25, q)) * lerp(1, 0.5, sm(0.6, 1, q)), { n: 6, oscR: 0.86, oscP: 1.04, achata: 0.78 }); }
        else T.cinta(T.ruta(ctrl, 3), { w: 0.017 * (0.85 + rng() * 0.3), alto: 0.0058, baja: 0.004, punta: 0.45, raiz: 0.6, afina: 0.6, oscR: 0.8, oscP: 1.06, borde: 0.66 });
      }
    },
    pinta(Q) {
      const { g, R, capa, claro, oscu, rn, res, suave, relleno } = Q, r = R.casco2;
      oscureceNacimiento(Q);
      relleno(r, capa, 2);
      const arcos = (k2, q, n, ra, rb, wa, wb, fn) => { k2.lineCap = 'round'; for (let i = 0; i < n; i++) { const cx = q.x + rn() * q.w, cy = q.y + rn() * q.h, rr = ra + rn() * (rb - ra), a0 = rn() * 6.28, sp = 2.2 + rn() * 3.2; fn(k2); k2.lineWidth = wa + rn() * (wb - wa); k2.beginPath(); k2.arc(cx, cy, rr, a0, a0 + sp); k2.stroke(); } k2.globalAlpha = 1; };
      suave(r, 3, 'multiply', 0.4, k2 => arcos(k2, r, 110, 2.2, 4.6, 1.4, 2.6, k => { k.strokeStyle = oscu; k.globalAlpha = 0.5 + rn() * 0.5; }));
      g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
      arcos(g, r, res > 512 ? 1400 : 620, 1.1, 3.2, 0.22, 0.5, k => { const cl = rn() < 0.46; k.strokeStyle = cl ? claro : oscu; k.globalAlpha = 0.22 * (0.4 + rn() * 0.6); });
      g.restore();
      pintaMechon(Q);
      const m = R.mechon; g.save(); g.beginPath(); g.rect(m.x, m.y, m.w, m.h); g.clip();
      arcos(g, m, res > 512 ? 700 : 360, 1, 2.8, 0.3, 0.7, k => { const cl = rn() < 0.46; k.strokeStyle = cl ? claro : oscu; k.globalAlpha = 0.32 * (0.4 + rn() * 0.6); });
      g.restore();
    },
  };

  // ---------------------------------------------------------------- pinchos: dos versiones
  ESTILOS.pinchos = {
    defecto: 'puntas',
    forma: C => { const hl = C.curva1(HL.corto), hc = C.curva1(HL.cortoC); return { hl, hlC: hc, raya: false }; },
    malla(T, C, v) {
      const { det, est, rng, H, chin, PH } = C, d2 = det > 1, hE = t => est.hlC(abs(t)), cepillo = v === 'cepillo', sg0 = barrido(C.look);
      const borde = th => hE(th) - 0.012 * ruidoP(th, 9.1) * sm(50, 110, abs(th));
      if (!cepillo) {
        T.casco({
          nT: d2 ? 56 : 28, nS: d2 ? 8 : 3, lump: d2 ? 0.003 : 0.004, borde, base: 0.74,
          grueso: (th, s) => { const a = abs(th); return 0.015 * lerp(1, 0.42, sm(50, 92, a) * sm(0.15, 0.6, s)) * lerp(1, 0.6, sm(115, 170, a) * sm(0.3, 0.8, s)); },
          osc: (th, s) => lerp(1, 0.86, sm(0.5, 1, s)),
        });
        // Arriba y delante, mechones gruesos de raíz que suben como llamas, de 8-10 cm. Ninguno en el centro: no hay un pico único
        const nP = d2 ? 52 : 15;
        for (let i = 0; i < nP; i++) {
          const k = (i + 0.9) / (nP + 0.9), s = 0.13 + 0.46 * pow(k, 0.6), th = nor180(i * 137.508 + (rng() - 0.5) * 18), ed = borde(th), h = lerp(0.992, ed + 0.015, pow(s, 1.6)), a = abs(th), nrm = C.dirCraneo(th, h);
          const b = vadd(T.craneo(th, h), vmul(nrm, T.tCap(th, h) * 0.5)), L = lerp(0.092, 0.068, sm(50, 150, a)) * lerp(1, 0.72, sm(0.32, 0.6, s)) * (0.84 + rng() * 0.16);
          const ax = vnorm(vadd(vadd(vmul(nrm, 0.62), [0, 0.62, -0.1 - 0.18 * sm(90, 160, a)]), [(rng() - 0.5) * 0.3 + sg0 * 0.06, (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.28]));
          const cae2 = vnorm(vadd(ax, [0, -0.5, -0.3])), N = d2 ? 6 : 2, pts = []; for (let j = 0; j <= N; j++) { const q = j / N; pts.push(vadd(b, vadd(vmul(ax, L * q), vmul(cae2, L * (d2 ? 0.32 : 0.2) * q * q)))); }
          const r0 = (d2 ? 0.0108 : 0.0215) * (0.85 + rng() * 0.3);
          T.tubo(pts, q => r0 * pow(1 - q, d2 ? 0.95 : 0.72) * lerp(1, 1.12, G(q - 0.25, 0.15)) + 0.0006, { n: d2 ? 5 : 4, oscR: 0.84, oscP: 1.06, achata: d2 ? 0.42 : 0.66 });
        }
        // Lados y nuca: pegados, hacia abajo y atrás, con la punta un poco fuera
        const nF = d2 ? 44 : 11;
        for (let i = 0; i < nF; i++) {
          const k = (i + 0.5) / nF, th = nor180(i * 137.508 + 70 + (rng() - 0.5) * 14), ed = borde(th), s = 0.5 + 0.42 * pow(k, 0.7), h = lerp(0.992, ed + 0.02, pow(s, 1.6)), a = abs(th), sg = signo(th), dth = a < 130 ? sg * 10 : sg * 2, largo = lerp(0.14, 0.08, s);
          if (a < 42 && s > 0.62) continue;   // la frente queda limpia
          T.cinta(T.ruta([[th - dth * 0.4, h + largo * 0.5, 0.001], [th + dth * 0.3, h, 0.005], [th + dth, h - largo * 0.5, 0.013]], d2 ? 4 : 2), { w: (d2 ? 0.0135 : 0.02) * (0.8 + rng() * 0.4), alto: 0.004, baja: 0.003, punta: 0.12, raiz: 0.75, oscR: 0.8, oscP: 1.04 });
        }
      } else {
        // Cepillo romo: un casquete que llega casi a un plano, de 3-4 cm arriba y 1 cm en lados y nuca. Encima, tacos pequeños que rompen el borde
        const yTop = chin + H + 0.024, rugo = q => LOOK.noise2(q[0] * 95 + q[1] * 31 + 40, q[2] * 95 - q[1] * 27 + 40, 256, 256);
        T.casco({
          nT: d2 ? 128 : 28, nS: d2 ? 26 : 5, lump: d2 ? 0.003 : 0.004, caida: 8, borde, base: 0.92,
          grueso: (th, s, h) => { const a = abs(th), q = T.craneo(th, h), nr = C.dirCraneo(th, h), arriba = clamp((yTop - q[1]) / max(0.5, nr[1]), 0.012, 0.034) * sm(0.45, 0.86, nr[1]) * lerp(1, 0.86, sm(100, 170, a)), lado = lerp(0.011, 0.0065, sm(0.55, 0.95, s)) * lerp(1, 0.8, sm(50, 95, a) * sm(120, 95, a)); return max(arriba, lado) + (rugo(q) - 0.5) * (d2 ? 0.0055 : 0.004) * sm(0.8, 0.45, s); },
          osc: (th, s, h) => lerp(1, 0.88, sm(0.5, 1, s)) * (d2 ? lerp(0.86, 1.04, rugo(T.craneo(th, h))) : 1),
        });
        const n = d2 ? 0 : 16;
        for (let i = 0; i < n; i++) {
          const k = (i + 0.7) / (n + 0.7), s = (d2 ? 0.03 + 0.57 * pow(k, 0.56) : 0.05 + 0.5 * pow(k, 0.56)), th = nor180(i * 137.508 + (rng() - 0.5) * 16), ed = borde(th), h = lerp(0.992, ed + 0.015, pow(s, 1.6)), nrm = C.dirCraneo(th, h);
          const b = vadd(T.craneo(th, h), vmul(nrm, T.tCap(th, h) - 0.003));
          const ax = vnorm(vadd(nrm, [(rng() - 0.5) * 0.2, 0.4 * (1 - s) + (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.2])), L = (d2 ? 0.006 : 0.014) * (0.6 + rng() * 0.8), pts = [b, vadd(b, vmul(ax, L))];
          const r0 = (d2 ? 0.0085 : 0.0135) * (0.85 + rng() * 0.3);
          T.tubo(pts, q => r0 * lerp(1, 0.62, q), { n: 4, oscR: 0.96, oscP: 1.02, achata: 0.8, tapa: true });
        }
        void PH;
      }
    },
    pinta(Q) { pintaCasco(Q, (th, s) => [(abs(th) > 90 ? 0 : -th * 0.05), 1], { masa: 0.25, brillo: 0.12 }); pintaMechon(Q); },
  };

  // ---------------------------------------------------------------- cresta: dos versiones. Lados pintados: pelo al uno, no calva
  ESTILOS.cresta = {
    defecto: 'alta',
    forma: () => ({ hl: () => 1.2, hlC: () => 1.2, raya: false }),
    malla(T, C, v) {
      const { det, rng, V, oscV, R, dirCraneo, m } = C, d2 = det > 1, BM = R.mechon, baja = v === 'baja', N = d2 ? 72 : 19, nTuf = d2 ? 21 : 9, seccion = d2 ? 3 : 2;
      T.grueso = null;
      // Eje: de la frente a la nuca por encima de la coronilla
      const mundo = [[0, 0.81], [0, 0.90], [0, 0.965], [180, 0.985], [180, 0.90], [180, 0.74], [180, 0.56], [180, 0.40], [180, 0.30]].map(c => T.craneo(c[0], c[1]));
      const eje = T.muestra(T.spline(mundo, 90).map(p => { const q = T.aCraneo(p); return T.craneo(q[0], q[1]); }), N);
      const anillos = [], uBase = 0.05, tufos = [];
      { let u = -0.02; while (u < 1.02) { const w = (d2 ? 0.028 : 0.05) + rng() * (d2 ? 0.05 : 0.07); tufos.push({ u: u + w * 0.6, w, h: 0.55 + rng() * 0.45 }); u += w * (0.75 + rng() * 0.5); } }
      eje.forEach((c, i) => {
        const u = i / N, q = T.aCraneo(c), dir = dirCraneo(q[0], q[1]), flow = vnorm(vsub(eje[min(i + 1, N)], eje[max(i - 1, 0)])), lado = vnorm(vcross(flow, dir)), up = vnorm(vcross(lado, flow));
        // Altura: 8-11 cm la alta, con mechones; 4 cm y borde romo la baja
        const env = baja ? lerp(0.042, 0.03, sm(0.75, 1, u)) * sm(0, 0.09, u) * lerp(1, 0.85, sm(0.85, 1, u)) + 0.006 : lerp(0.086, 0.046, sm(0.42, 1, u)) * sm(0, 0.12, u) + 0.012;
        let pk = 0; for (const t of tufos) { const dq = abs(u - t.u) / t.w; if (dq < 1) pk = max(pk, t.h * pow(1 - dq, 0.6)); }
        const ft = pk, pico = baja ? 0.96 + 0.05 * sin(u * 61) : lerp(0.62, 1.04, pk), alto = env * pico;
        const bw = (baja ? 0.021 : 0.019) * (m ? 1 : 0.92) * sm(0, 0.05, u + 0.012) * sm(1, 0.95, u - 0.012) + 0.002;
        const lean = baja ? 0.05 : 0.34 * sm(0.05, 0.7, u) - 0.02;
        const secc = [];   // de un lado de la base, por lo alto, al otro lado
        const perfil = d2 ? [[-1, -0.04], [-0.86, 0.34], [-0.52, 0.72], [0, 1], [0.52, 0.72], [0.86, 0.34], [1, -0.04]] : [[-1, -0.04], [-0.72, 0.5], [0, 1], [0.72, 0.5], [1, -0.04]];
        perfil.forEach(([x, y], j) => {
          const w2 = bw * x * lerp(1, 0.72, y), p = vadd(vadd(c, vmul(lado, w2)), vadd(vmul(up, alto * y), vmul(flow, lean * alto * y * y))), iv = V(p, BM.x + BM.w * ((uBase + u * 0.8 + j * 0.008) % 1), BM.y + BM.h * (0.98 - 0.7 * max(0, y)), { head: 1 }, 'mech', 'H');
          oscV[iv] = lerp(0.8, 1.05, max(0, y)) * (1 - 0.08 * abs(x)) * (baja ? 1 : lerp(0.9, 1.04, ft));
          secc.push(iv);
        });
        anillos.push(secc);
      });
      for (let i = 0; i < N; i++) {
        const q = T.aCraneo(eje[i]), dir = dirCraneo(q[0], q[1]);
        const a = anillos[i], b = anillos[i + 1], flow = vsub(eje[i + 1], eje[i]), lado = vnorm(vcross(flow, dir));
        // Cada lado de la sección mira hacia su lado
        for (let j = 0; j < a.length - 1; j++) { const sg = j < (a.length - 1) / 2 ? -1 : 1, s1 = [a[j], a[j + 1]], s2 = [b[j], b[j + 1]]; C.bridge(s1, s2, vmul(lado, sg)); }
      }
      void seccion; void rng;
    },
    pinta(Q) {
      const { g, R, capa, claro, oscu, piel, rn, res, CX, CY, suave } = Q, hl = (() => { const t = HL.corto; return a => { let i = 0; while (i < t.length - 2 && t[i + 1][0] < a) i++; return lerp(t[i][1], t[i + 1][1], clamp((a - t[i][0]) / (t[i + 1][0] - t[i][0]))); }; })();
      // Lados al uno: una sombra del color del pelo, con borde blando y puntitos. Se lee como pelo rapado, no como calva
      const zona = (k2, dh) => { k2.beginPath(); k2.moveTo(CX(-180), CY(hl(180) + dh)); for (let t = -180; t <= 180; t += 3) k2.lineTo(CX(t), CY(hl(abs(t)) + dh)); k2.lineTo(CX(180), CY(1.01)); k2.lineTo(CX(-180), CY(1.01)); k2.closePath(); k2.fill(); };
      const vC = LOOK.hsv(capa)[2], vP = LOOK.hsv(piel)[2], claroSobre = vC > vP + 0.08, tono = LOOK.mix(LOOK.mix(capa, oscu, claroSobre ? 0.4 : 0.25), piel, claroSobre ? 0.62 : 0.3);
      suave(R.cara, 7, 'source-over', 0.2, k2 => { k2.fillStyle = tono; zona(k2, -0.025); });
      suave(R.cara, 5, 'source-over', 0.38, k2 => { k2.fillStyle = tono; zona(k2, -0.004); });
      suave(R.cara, 4, 'source-over', claroSobre ? 0.42 : 0.6, k2 => { k2.fillStyle = tono; zona(k2, 0.02); });
      g.save(); g.beginPath(); g.rect(R.cara.x, R.cara.y, R.cara.w, R.cara.h); g.clip();
      const nD = res > 512 ? 18000 : 5000, tam = res > 512 ? 0.3 : 0.5;
      for (let i = 0; i < nD; i++) { const t = -180 + rn() * 360, h = lerp(hl(abs(t)) - 0.02 * rn(), 1, rn()); g.fillStyle = rn() < 0.6 ? capa : oscu; g.globalAlpha = (0.14 + rn() * 0.28) * (claroSobre ? 0.7 : 1); g.fillRect(CX(t), CY(h), tam, tam); }
      g.restore(); g.globalAlpha = 1;
      pintaMechon(Q);
      void claro;
    },
  };

  const PRESUPUESTO = { corto: 420, tupe: 460, largo: 700, mono: 460, coleta: 520, rizado: 760, pinchos: 520, cresta: 240 };
  function peinado(look) {
    const e = ESTILOS[look.hairStyle]; if (!e) return null;
    const v = look.hairVersion || e.defecto;
    return {
      cola: !!e.cola, tapaOrejas: !!e.tapaOrejas,
      forma: C => e.forma(C, v),
      malla: C => e.malla(Taller(C), C, v),
      pinta: Q => e.pinta(Q, v),
    };
  }
  return { peinado, ESTILOS: Object.keys(ESTILOS), PRESUPUESTO };
};
