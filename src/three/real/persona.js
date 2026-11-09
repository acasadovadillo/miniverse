/* persona.js: persona de Miniverse, plan B de la prueba 1. Malla de anillos hecha a mano, un SkinnedMesh y un lienzo por look.

   USO
     const P = LOOK.parts.persona(THREE, LOOK);
     const { root, update } = P.build({ sex: 'f', build: 'medio', skin: '#e3ae80', hair: '#4a2e20', hairStyle: 'trenza',
                                        garments: [{ id: 'tunica', color: '#c83a3a', ribete: '#b08a4e' }, ...] });
     scene.add(root);  update(dt, velocidadEnMetrosPorSegundo);

   build(look, { det: 1 | 2, res: 512 | 1024, lejos })   det 2 y 1024 son para el retrato y el creador, fuera del presupuesto de juego. lejos: cara con más contraste en pestañas, cuenca, cejas y boca para leerse a distancia 7 (plaza.html).
   Devuelve { root, update, pose, mesh, bones, tris, atlas, look, d }.
   look.cabezas cambia las cabezas de alto (6,8 por defecto); look.ojos, el color de ojos; look.semilla varía un poco la cara y la postura de pie;
   look.edad 'mayor' pinta líneas blandas de edad y entradas. P.LOOKS trae los dos de la prueba y P.LOOKS.vecinos, seis personas distintas.
   Cuerpos: look.build fino|medio|fuerte, look.panza 0..1, look.encorvado 0..1, look.escala (estatura). Tocados: look.sombrero 'paja'|'boina', hairStyle 'panuelo' con look.panuelo (color).
   Creador: look.eyeStyle redondos|almendrados|pestanas|entornados|pequenos, look.brows finas|rectas|gruesas|arqueadas|pobladas, look.nose boton|respingona|larga|ancha|puntiaguda. Sin ellos, la cara de siempre.
   Si parts/pelo.js está cargado, sus peinados (corto, largo, coleta, rizado, mono, tupe, pinchos, cresta; look.hairVersion para las dos versiones) sustituyen a los de aquí. build devuelve además trisPelo.
   look.barba 'corta', look.mirada -1..1 (hacia dónde miran los iris), look.postura cesta|jarras|delante|charla|azada|cubo. P.prop('cesta'|'azada'|'cubo') y P.sujeta(persona, objeto, hueso, desplazamiento).

   TOPOLOGÍA: tronco, cuello, cabeza, brazos y piernas son una sola piel sin solapes. El primer anillo del brazo es el borde de un
   hueco quitado al tronco, y el de cada pierna es media vuelta del anillo de la pelvis más la línea de la entrepierna. Los
   duplicados por UV llevan los mismos pesos y sus normales se sueldan por posición: no puede abrirse grieta ni verse el pliegue.
   Las manos son la excepción: palma hasta los nudillos y cuatro dedos y un pulgar como tubos aparte, curvados en reposo. Bajo la falda no hay cuerpo.
   Nariz, párpados y globo del ojo son piezas finas apoyadas en la malla de la cabeza, con la misma UV; nariz y párpado llevan la normal de la malla en sus bordes.
   Material: MeshStandard con onBeforeCompile y un atributo aPiel (rugosidad por vértice, máscara de piel, máscara de pelo), un solo programa para toda la gente. En piel y pelo la sombra propia se apaga donde N·L es bajo: sin cuña dura en la mandíbula. El pelo de retrato (det 2) lleva mechones; el de juego (det 1), solo cáscara.
   Los huesos no giran en reposo: todo se escribe en mundo con los ejes de la escena (+z delante, +x la izquierda de la persona). */
LOOK.parts.persona = (THREE, LOOK) => {
  let moduloPelo = null;
  const PI = Math.PI, { sin, cos, abs, max, min, sqrt, pow, exp, hypot, ceil, floor } = Math;
  const rad = d => d * PI / 180, clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t;
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const G = (x, s) => exp(-x * x / (2 * s * s));
  const pw = (v, e) => (v < 0 ? -1 : 1) * pow(abs(v), e);
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], vlen = a => hypot(a[0], a[1], a[2]);
  const vnorm = a => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // Interpolación por tramos con tangentes limitadas (no se pasa de los valores de la tabla). rows: [x, v1, v2...], x ascendente.
  function curva(rows) {
    const n = rows.length, m = rows[0].length - 1, xs = rows.map(r => r[0]), T = [];
    for (let j = 0; j < m; j++) {
      const d = []; for (let i = 0; i < n - 1; i++) d.push((rows[i + 1][j + 1] - rows[i][j + 1]) / (xs[i + 1] - xs[i]));
      const t = [d[0]]; for (let i = 1; i < n - 1; i++) t.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2); t.push(d[n - 2]);
      for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) { t[i] = t[i + 1] = 0; continue; }
        const a = t[i] / d[i], b = t[i + 1] / d[i], s = a * a + b * b;
        if (s > 9) { const k = 3 / sqrt(s); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i]; }
      }
      T.push(t);
    }
    return x => {
      let i = 0; if (x >= xs[n - 1]) i = n - 2; else if (x > xs[0]) while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], u = clamp((x - xs[i]) / h), u2 = u * u, u3 = u2 * u, out = new Array(m);
      for (let j = 0; j < m; j++) {
        const a = rows[i][j + 1], b = rows[i + 1][j + 1];
        out[j] = (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * h * T[j][i] + (-2 * u3 + 3 * u2) * b + (u3 - u2) * h * T[j][i + 1];
      }
      return out;
    };
  }
  const curva1 = rows => { const f = curva(rows); return x => f(x)[0]; };
  const dobla = (a, det) => { let r = a.slice(); for (let k = 1; k < det; k *= 2) { const o = []; for (let i = 0; i < r.length - 1; i++) o.push(r[i], (r[i] + r[i + 1]) / 2); o.push(r[r.length - 1]); r = o; } return r; };

  // ---------------------------------------------------------------- tabla dims (sección 3)
  const DIMS = {
    m: { alto: 1.72, cab: 0.253, ojos: 1.59, hombro: 1.415, hombros: 0.46, cintura: 1.05, cadera: 0.89, caderas: 0.33, rodilla: 0.475, humero: 0.29, antebrazo: 0.25, mano: 0.18, pie: 0.26 },
    f: { alto: 1.64, cab: 0.241, ojos: 1.52, hombro: 1.35, hombros: 0.395, cintura: 1.00, cadera: 0.85, caderas: 0.35, rodilla: 0.45, humero: 0.28, antebrazo: 0.24, mano: 0.17, pie: 0.235 },
  };

  // Opciones del creador, en altos de cabeza. w ancho, s e i alto sobre y bajo la línea media, rab cuánto sube el rabillo, cy altura del iris, ir radio del iris en metros, linea grueso de la línea de pestañas
  const OJOS = {
    redondos: { w: 0.13, s: 0.029, i: 0.0185, rab: 0.004, cy: 0.012, ir: 0.0057, linea: 1.05 },
    almendrados: { w: 0.146, s: 0.0235, i: 0.0115, rab: 0.028, cy: 0.0105, ir: 0.0055, linea: 1.25 },
    pestanas: { w: 0.135, s: 0.0265, i: 0.0155, rab: 0.008, cy: 0.0115, ir: 0.0057, linea: 2.7, bajo: 1 },
    entornados: { w: 0.135, s: 0.0165, i: 0.014, rab: 0.004, cy: 0.0105, ir: 0.0057, linea: 1.35, pesado: 1 },
    pequenos: { w: 0.104, s: 0.021, i: 0.0125, rab: 0.006, cy: 0.0095, ir: 0.0048, linea: 1 },
  };
  // w grueso, arco cuánto sube en medio, cae cuánto baja la cola, n pelos, al opacidad de la mancha, tr fuerza de los pelos, irr borde irregular
  const CEJAS = {
    finas: { w: 0.0095, arco: 0.027, cae: 0.026, n: 24, al: 0.72, tr: 1, irr: 0, dy: 0.005, cola: 0.12 },
    rectas: { w: 0.02, arco: 0.0, cae: -0.002, n: 46, al: 0.74, tr: 1.1, irr: 0, dy: -0.007, cola: 0.36 },
    gruesas: { w: 0.03, arco: 0.011, cae: 0.012, n: 64, al: 0.74, tr: 1.2, irr: 0 },
    arqueadas: { w: 0.015, arco: 0.034, cae: 0.032, n: 34, al: 0.68, tr: 1, irr: 0 },
    pobladas: { w: 0.039, arco: 0.006, cae: 0.005, n: 124, al: 0.72, tr: 1.4, irr: 1, cola: 0.3 },
  };
  // dh sube (+) o baja (-) la punta, kw anchura de las aletas, ks cuánto sale, conc hunde el caballete, bulbo ensancha la punta
  const NARICES = {
    base: { dh: 0, kw: 1, ks: 1, conc: 0, bulbo: 1 },
    boton: { dh: 0.032, kw: 0.88, ks: 0.76, conc: 0.05, bulbo: 1.2 },
    respingona: { dh: 0.026, kw: 0.86, ks: 0.86, conc: 0.42, bulbo: 1 },
    larga: { dh: -0.024, kw: 0.92, ks: 1.07, conc: 0, bulbo: 0.95 },
    ancha: { dh: 0.004, kw: 1.34, ks: 0.98, conc: 0, bulbo: 1.25 },
    puntiaguda: { dh: -0.012, kw: 0.76, ks: 1.2, conc: 0.06, bulbo: 0.62 },
  };

  // Tronco: y, medio ancho, fondo delante, fondo detrás, eje z. Son secciones reales de pie, sin ropa.
  const TRONCO = {
    m: { filas: [0.815, 0.885, 0.95, 1.00, 1.05, 1.12, 1.20, 1.25, 1.285, 1.345, 1.40, 1.425], axila: 8, tabla: [
      [0.80, 0.156, 0.084, 0.098, 0], [0.835, 0.168, 0.090, 0.106, 0], [0.89, 0.175, 0.094, 0.114, 0], [0.95, 0.166, 0.097, 0.102, 0.002], [1.00, 0.152, 0.099, 0.094, 0.004],
      [1.05, 0.145, 0.100, 0.090, 0.005], [1.12, 0.146, 0.106, 0.092, 0.004], [1.20, 0.150, 0.112, 0.096, 0], [1.25, 0.156, 0.116, 0.102, 0], [1.285, 0.162, 0.118, 0.105, 0],
      [1.345, 0.172, 0.110, 0.100, -0.002], [1.40, 0.180, 0.076, 0.078, -0.006], [1.425, 0.098, 0.060, 0.068, -0.010]] },
    f: { filas: [0.78, 0.85, 0.91, 0.96, 1.00, 1.07, 1.14, 1.19, 1.232, 1.285, 1.338, 1.362], axila: 8, tabla: [
      [0.765, 0.162, 0.082, 0.098, 0], [0.80, 0.174, 0.086, 0.108, 0], [0.85, 0.180, 0.089, 0.114, 0], [0.91, 0.168, 0.088, 0.104, 0.002], [0.96, 0.138, 0.082, 0.086, 0.004],
      [1.00, 0.120, 0.079, 0.076, 0.005], [1.07, 0.122, 0.084, 0.075, 0.005], [1.14, 0.128, 0.094, 0.080, 0.002], [1.19, 0.134, 0.100, 0.086, 0], [1.232, 0.138, 0.100, 0.089, 0],
      [1.285, 0.150, 0.088, 0.086, -0.002], [1.338, 0.158, 0.064, 0.066, -0.005], [1.362, 0.086, 0.050, 0.056, -0.008]] },
  };
  // Cabeza: h (0 barbilla, 1 coronilla) y, en altos de cabeza, medio ancho, fondo delante, fondo detrás, eje z.
  // Es la masa de cara y cráneo; el cuello es otra elipse y las dos se unen con un máximo suave: de ahí sale el canto de la mandíbula.
  const CABEZA = [
    [-0.06, 0.06, 0.10, 0.02, 0], [-0.03, 0.08, 0.13, 0.03, 0], [0.0, 0.102, 0.205, 0.05, 0], [0.03, 0.122, 0.29, 0.10, 0], [0.06, 0.145, 0.338, 0.13, 0], [0.10, 0.170, 0.364, 0.16, 0], [0.125, 0.184, 0.362, 0.18, 0],
    [0.165, 0.208, 0.370, 0.20, 0], [0.19, 0.218, 0.378, 0.215, 0], [0.225, 0.232, 0.386, 0.235, 0], [0.27, 0.246, 0.396, 0.262, 0], [0.32, 0.260, 0.402, 0.29, 0], [0.38, 0.280, 0.398, 0.315, 0],
    [0.44, 0.292, 0.392, 0.338, 0], [0.50, 0.296, 0.388, 0.36, 0], [0.56, 0.300, 0.404, 0.378, 0], [0.62, 0.305, 0.406, 0.386, -0.004], [0.72, 0.305, 0.386, 0.388, -0.008],
    [0.82, 0.284, 0.337, 0.358, -0.012], [0.90, 0.234, 0.264, 0.290, -0.014], [0.95, 0.174, 0.192, 0.214, -0.016], [0.985, 0.098, 0.106, 0.122, -0.018], [1.0, 0.005, 0.005, 0.005, -0.02],
  ];
  // Cuello y su arranque (altos de cabeza por debajo de la barbilla): medio ancho, fondo delante, fondo detrás. Se copia al subir.
  const CUELLO = { m: { w: 0.186, f: 0.128, b: 0.232 }, f: { w: 0.150, f: 0.112, b: 0.204 } };
  const FILAS_H = [-0.07, -0.03, 0, 0.03, 0.07, 0.115, 0.155, 0.19, 0.225, 0.27, 0.32, 0.38, 0.44, 0.485, 0.53, 0.58, 0.66, 0.76, 0.86, 0.93, 0.975];
  const TH0 = [0, 17, 34, 50, 64, 90, 116, 130, 146, 163, 180];       // ángulos del tronco
  const HT0 = [0, 8, 16, 25, 35, 47, 62, 85, 115, 148, 180];          // ángulos de la cabeza: más lados en la cara
  const UH0 = [0, 11, 22, 33.5, 46, 60, 72, 83, 91, 96, 100];         // téxeles desde el centro del bloque de cara para cada ángulo de HT0
  // Reparto del lienzo, en unidades de 512
  const R = {
    cara: { x: 2, y: 2, w: 200, h: 226 }, oreja: { x: 206, y: 2, w: 24, h: 36 }, dedo: { x: 206, y: 42, w: 24, h: 24 },
    tronco: { x: 234, y: 2, w: 218, h: 168 }, brazo: { x: 456, y: 2, w: 54, h: 130 }, mano: { x: 456, y: 136, w: 54, h: 36 },
    pierna: { x: 2, y: 232, w: 112, h: 190 }, pie: { x: 118, y: 232, w: 98, h: 70 }, falda: { x: 220, y: 174, w: 230, h: 130 },
    delantal: { x: 220, y: 308, w: 98, h: 96 }, casco: { x: 118, y: 306, w: 98, h: 98 }, casco2: { x: 118, y: 408, w: 200, h: 100 }, mechon: { x: 322, y: 308, w: 96, h: 200 },
    trenza: { x: 422, y: 308, w: 40, h: 200 }, mono: { x: 466, y: 308, w: 44, h: 44 }, cuello: { x: 2, y: 426, w: 112, h: 36 }, cinto: { x: 2, y: 466, w: 112, h: 24 },
  };
  const H_MIN = -0.11, H_MAX = 1.005;

  const LOOKS = {
    mujer: { sex: 'f', build: 'medio', skin: '#cd9570', hair: '#4b2f20', hairStyle: 'trenza', ojos: '#5b4630', mirada: 0.15, garments: [
      { id: 'tunica', color: '#a0443a', ribete: '#7c5a42' }, { id: 'delantal', color: '#cdc3ac' }, { id: 'medias', color: '#5f5346' }, { id: 'zapatos', color: '#5a4030' }] },
    hombre: { sex: 'm', build: 'medio', skin: '#bb855e', hair: '#332821', hairStyle: 'corto', ojos: '#54462f', mirada: -0.1, garments: [
      { id: 'camisa', color: '#bdb197' }, { id: 'pantalon', color: '#665442' }, { id: 'chaleco', color: '#35536f' }, { id: 'botas', color: '#4a3526' }] },
  };
  // Seis vecinos para ver el conjunto: ni clones ni pelotón
  LOOKS.vecinos = [
    { ...LOOKS.mujer, semilla: 2, postura: 'cesta' }, { ...LOOKS.hombre, semilla: 3, postura: 'azada' },
    { sex: 'f', build: 'fuerte', panza: 0.7, encorvado: 0.6, escala: 0.95, skin: '#c48d68', hair: '#8e867a', hairStyle: 'panuelo', panuelo: '#6f5f44', ojos: '#4c4634', edad: 'mayor', semilla: 4, postura: 'delante', garments: [{ id: 'tunica', color: '#5e6648', ribete: '#4a4e38' }, { id: 'delantal', color: '#b3a992' }, { id: 'medias', color: '#4c463a' }, { id: 'zapatos', color: '#46352a' }] },
    { sex: 'm', build: 'fino', escala: 1.05, skin: '#d8a982', hair: '#7a5a38', hairStyle: 'corto', sombrero: 'paja', ojos: '#54606a', semilla: 5, postura: 'cubo', garments: [{ id: 'camisa', color: '#a99a7c' }, { id: 'pantalon', color: '#50493e' }, { id: 'botas', color: '#3f3024' }] },
    { sex: 'm', build: 'fuerte', panza: 0.9, encorvado: 0.25, escala: 0.97, skin: '#a97553', hair: '#8f897f', hairStyle: 'corto', barba: 'corta', sombrero: 'boina', ojos: '#4a3a2a', edad: 'mayor', semilla: 6, postura: 'jarras', garments: [{ id: 'camisa', color: '#b3a88f' }, { id: 'pantalon', color: '#403a33' }, { id: 'chaleco', color: '#6c4a33' }, { id: 'botas', color: '#3a2c22' }] },
    { sex: 'f', build: 'fino', escala: 1.03, skin: '#b07a57', hair: '#1f1815', hairStyle: 'mono', ojos: '#3a2a20', semilla: 7, garments: [{ id: 'tunica', color: '#3e6866', ribete: '#2f4e4c' }, { id: 'delantal', color: '#cdc3ac' }, { id: 'medias', color: '#4c463a' }, { id: 'zapatos', color: '#4a382c' }] },
  ];
  // Posturas de brazos, en grados, para el brazo izquierdo; el derecho se refleja. arm [x, y, z] en orden ZYX, fore flexión del codo. fijo: también al andar
  const POSTURAS = {
    cesta: { fijo: true, L: { arm: [-6, -24, 7], fore: -98 } },
    jarras: { L: { arm: [12, -66, 30], fore: -84, mano: [0, 0, 10] }, R: { arm: [12, -66, 30], fore: -84, mano: [0, 0, 10] } },
    delante: { L: { arm: [-8, -52, 6], fore: -54 }, R: { arm: [-8, -52, 6], fore: -54 } },
    charla: { R: { arm: [-20, -34, 8], fore: -86, mano: [-12, 0, 0] } },
    azada: { R: { arm: [-24, -28, 7], fore: -62 } },
    cubo: { fijo: true, R: { arm: [0, 0, 5], fore: -6 } },
  };

  // ---------------------------------------------------------------- prendas: qué hacen a la forma (lo que pintan está más abajo)
  const GARMENTS = {
    camisa: { arriba: true, color: '#d8cfba', padT: (y, th, d) => (y > d.cintura - 0.02 ? 0.007 : 0), padB: (t) => (t < 0.97 ? 0.008 + 0.006 * sin(t * PI) : 0.004), manga: 0.68, cuello: true },
    tunica: { arriba: true, color: '#a83c34', padT: (y, th, d) => 0.006 + 0.004 * G(y - d.cintura - 0.09, 0.05), padB: (t) => (t < 0.74 ? 0.007 + 0.009 * t : 0), manga: 0.74, falda: true },
    chaleco: { color: '#35536f', padT: (y, th, d) => (y > d.yChaleco ? 0.013 * sm(d.yt + 0.05, d.yt, y) + 0.004 : 0) },
    pantalon: { color: '#665442', padT: (y, th, d) => (y <= d.cintura - 0.02 ? 0.009 : 0), tubo: true },
    delantal: { color: '#ddd5c2' },
    medias: { color: '#5f5346', padP: 0.0015 },
    botas: { color: '#4a3526', padPie: 0.006 },
    zapatos: { color: '#5a4030', padPie: 0.003 },
  };

  const pieF = [ // anillos del pie, hombre, en metros desde el tobillo (z) y el suelo (y): empeine T, planta S, medio ancho
    { T: [0.040, 0.094], S: [-0.050, 0.076], a: 0.034 }, { T: [0.052, 0.082], S: [-0.066, 0.024], a: 0.036 }, { T: [0.070, 0.074], S: [-0.060, 0.0], a: 0.038 },
    { T: [0.092, 0.072], S: [-0.016, 0.0], a: 0.040 }, { T: [0.102, 0.070], S: [0.012, 0.011], a: 0.040 }, { T: [0.124, 0.066], S: [0.056, 0.002], a: 0.0475 }, { T: [0.146, 0.062], S: [0.116, 0.0], a: 0.049 }, { T: [0.166, 0.048], S: [0.156, 0.002], a: 0.045 },
  ];

  // ---------------------------------------------------------------- construir
  function build(look, opts = {}) {
    const det = opts.det || 1, res = opts.res || 512, sx = look.sex === 'f' || look.sex === 'mujer' ? 'f' : 'm', B0 = DIMS[sx], m = sx === 'm';
    const LJ = opts.lejos || look.lejos ? 1 : 0;   // cara para verse de lejos (cámara 7 y 18): pestañas, cuenca y cejas con más contraste; nada de ojos grandes
    if (!moduloPelo && LOOK.parts.pelo) moduloPelo = LOOK.parts.pelo(THREE, LOOK);
    const peinado = moduloPelo ? moduloPelo.peinado(look) : null;
    const prendas = (look.garments || []).map(g => { const o = typeof g === 'string' ? { id: g } : { ...g }, b = GARMENTS[o.id] || {}; o.color = o.color || (b.arriba && look.shirt) || b.color || '#6d5c4c'; return o; }), tiene = id => prendas.find(g => g.id === id);
    const cabezas = look.cabezas || 6.8, H = B0.alto / cabezas, ky = (B0.alto - H) / (B0.alto - B0.alto / 6.8), bw = { fino: 0.9, medio: 1, fuerte: 1.16 }[look.build || 'medio'] || 1;
    const TR = TRONCO[sx], chin = B0.alto - H;
    const rv = look.semilla ? LOOK.rng(look.semilla * 131 + 7) : null, va = () => (rv ? rv() - 0.5 : 0);
    const vari = { mand: va() * 0.10, nar: va() * 0.24, narL: va() * 0.16, boca: va() * 0.12, ceja: va() * 0.012, lado: rv ? (rv() < 0.5 ? -1 : 1) : (m ? 1 : -1), giro: va(), incl: va(), brazo: va() };
    const d = { sx, m, H, ky, bw, chin, alto: B0.alto, cintura: B0.cintura * ky, cadera: B0.cadera * ky, rodilla: B0.rodilla * ky, hombro: B0.hombro * ky, sh: B0.hombros / 2 * lerp(1, bw, 0.6), hOjos: (B0.ojos - (B0.alto - B0.cab)) / B0.cab };
    const kx = d.sh / 0.22, kf = B0.pie / 0.26 * 0.95;
    const NAR = NARICES[look.nose] || NARICES.base, hBoca = m ? 0.202 : 0.21, hNarz = (m ? 0.291 : 0.304) + NAR.dh;
    const filasY = TR.filas.map(y => y * ky);
    d.ya = filasY[TR.axila]; d.ym = filasY[TR.axila + 1]; d.yt = filasY[TR.axila + 2]; d.yP = filasY[0]; d.yChaleco = d.cadera + (m ? 0.124 : 0.11);

    // Una sola tabla de secciones, de la pelvis a la coronilla, en metros
    const yH = h => chin + h * H;
    const zCab = 0.014;
    const panza = look.panza || 0, kPz = y => panza * G(y - B0.cintura - 0.015, 0.105);
    const filasTabla = TR.tabla.map(r => { const kp = kPz(r[0]); return [r[0] * ky, r[1] * bw + 0.030 * kp, r[2] * lerp(1, bw, 0.8) + 0.058 * kp, r[3] * lerp(1, bw, 0.8) + 0.010 * kp, r[4] + 0.004 * kp, 0.82]; });
    const CU = CUELLO[sx];
    for (const [hh, dw, df, db, dz, e] of [[-0.118, 0.09, 0.030, 0.028, -0.024, 0.88], [-0.07, 0.048, 0.012, 0.016, -0.017, 0.92], [-0.03, 0.02, 0.004, 0.008, -0.010, 0.95], [0.03, 0.006, 0, 0.004, -0.004, 0.98]])
      filasTabla.push([yH(hh), (CU.w + dw) * H, (CU.f + df) * H, (CU.b + db) * H, zCab + dz, e]);
    filasTabla.push([yH(0.12), CU.w * H, CU.f * H, CU.b * H, zCab, 1], [yH(1.2), CU.w * H, CU.f * H, CU.b * H, zCab, 1]);
    const sec = curva(filasTabla);
    const secF = curva(CABEZA.map(r => {
      const b = r[0], fj = (!m && b < 0.42 ? 1 - 0.075 * sm(0.42, 0.16, b) - 0.075 * sm(0.17, 0.02, b) : 1) * (1 + vari.mand * sm(0.42, 0.14, b)), ch = (m ? 1 : 1 - 0.03 * sm(0.17, 0.05, b)) * (1 - (m ? 0.03 : 0.11) * sm(0.095, 0.015, b));
      return [b, r[1] * H * fj, r[2] * H * ch, r[3] * H, zCab + r[4] * H];
    }));

    // Rasgos de la cabeza, en altos de cabeza, empujando en la dirección radial
    function rasgosCab(a, h) {
      let r = 0;
      r -= 0.037 * G(a - 19, 10) * G(h - d.hOjos, 0.042);                                  // cuencas
      r -= (m ? 0.018 : 0.014) * G(a, 10) * G(h - 0.52, 0.028);                             // raíz de la nariz: el quiebro entre frente y nariz
      r -= 0.009 * G(a - 11, 6) * G(h - d.hOjos - 0.04, 0.03);                              // el hundido entre nariz y ceja
      r += 0.009 * G(a - 19, 7.5) * G(h - d.hOjos - 0.003, 0.02);                           // el globo del ojo bajo el párpado
      r += (m ? 0.019 : 0.007) * G(a - 21, 16) * G(h - 0.57, 0.027);                        // ceja ósea
      r += (m ? 0.005 : 0.002) * G(a, 8) * G(h - 0.565, 0.02);                              // entrecejo
      r += 0.012 * G(a - 44, 17) * G(h - 0.40, 0.085);                                      // pómulos
      r -= (m ? 0.006 : 0.0012) * G(a - 48, 18) * G(h - 0.225, 0.1);                         // mejilla bajo el pómulo
      r += 0.004 * G(a, 18) * G(h - 0.205, 0.05);                                           // hocico, muy poco
      r -= 0.004 * G(a - 18, 7) * G(h - hBoca, 0.02);                                       // comisuras
      r -= 0.006 * G(a, 12) * G(h - 0.125, 0.015);                                           // surco bajo el labio
      r += 0.012 * G(a, 15) * G(h - 0.085, 0.026);                                          // mentón
      r += (m ? 0.010 : 0.005) * G(a - 62, 24) * G(h - (0.045 + 0.0017 * a), 0.028);        // borde de la mandíbula, que sube hacia la oreja
      r += (m ? 0.012 : 0.004) * G(a - 78, 18) * G(h - 0.20, 0.05);                         // ángulo de la mandíbula
      r -= 0.006 * G(a - 62, 14) * G(h - 0.63, 0.06);                                       // sienes
      if (!m) { r += 0.0095 * G(a - 40, 21) * G(h - 0.30, 0.08); r += 0.0058 * G(a, 13) * G(h - hBoca - 0.022, 0.011); r += 0.0068 * G(a, 12) * G(h - hBoca + 0.024, 0.013); }   // labios: solo en ella, y poco
      return r;
    }
    function rasgosTronco(a, y) {
      let r = 0;
      if (m) r += 0.006 * G(a - 32, 20) * G(y - d.ya, 0.05);
      else r += 0.012 * G(a - 32, 19) * G(y - (d.ya - 0.045), 0.05);                         // volumen discreto bajo la ropa
      r += 0.005 * G(a - 150, 18) * G(y - d.ya, 0.06);                                       // omóplatos
      r -= 0.004 * G(a - 180, 9) * sm(d.cadera, d.cintura, y) * sm(d.yt, d.ya, y);           // columna
      r += 0.008 * G(a - 148, 22) * G(y - d.cadera + 0.03, 0.05);                            // glúteo
      r -= 0.007 * G(a - 180, 9) * sm(d.cadera + 0.04, d.cadera, y);                         // raya
      return r;
    }
    const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (a - b) / k); return lerp(b, a, h) + k * h * (1 - h); };
    function P(th, y, pad = 0) {
      const t = rad(th), sn = sin(t), cs = cos(t), s = sec(y + (cs > 0 ? 0.03 : 0.018) * cs * sm(d.ym, d.yt + 0.012, y)), e = s[4], h = (y - chin) / H, a = abs(th);
      if (h < -0.03) {   // tronco y arranque del cuello
        const x = s[0] * pw(sn, e), z = (cs >= 0 ? s[1] : s[2]) * pw(cs, e), L = hypot(x, z) || 1, disp = pad + (y < d.yt + 0.01 ? rasgosTronco(a, y) : 0);
        return [x + x / L * disp, y, s[3] + z + z / L * disp];
      }
      // Masa de cara y cráneo unida al cuello. Cada columna es un rayo fijo: así el cuello no se retuerce bajo la barbilla.
      const kr = sm(-0.03, 0.1, h), rx = lerp(s[0], 0.29 * H, kr), rz = lerp(cs >= 0 ? s[1] : s[2], 0.40 * H, kr), dx = rx * sn, dz = rz * cs, dl = hypot(dx, dz) || 1, ux = dx / dl, uz = dz / dl;
      const f = h > -0.032 ? secF(h) : null, nU = cs >= 0 ? 2 + (m ? 0.34 : 0.2) * sm(-0.01, 0.09, h) * sm(0.52, 0.2, h) : 2, rf = f ? pow(pow(abs(ux) / f[0], nU) + pow(abs(uz) / (cs >= 0 ? f[1] : f[2]), nU), -1 / nU) : 0;
      const nZ = cs >= 0 ? s[1] : s[2], rn = 1 / sqrt((ux * ux) / (s[0] * s[0]) + (uz * uz) / (nZ * nZ));
      const neckOn = sm(0.62, 0.42, h), rr = neckOn > 0 ? smax(rf, rn * neckOn, 0.0125) : rf, disp = pad + rasgosCab(a, h) * H * sm(-0.01, 0.03, h) + (0.0035 * G(a - 52, 15) - 0.003 * G(a, 11)) * sm(-0.04, 0, h) * sm(0.1, 0.03, h), z0 = f ? lerp(s[3], f[3], sm(0.3, 0.6, h)) : s[3];
      return [ux * (rr + disp), y, z0 + uz * (rr + disp)];
    }
    const PH = (th, h, pad = 0) => P(th, yH(min(h, 0.999)), pad);
    const nCab = (th, h) => {   // normal numérica de la cabeza
      const a = PH(th - 2, h), b = PH(th + 2, h), c = PH(th, h - 0.012), e = PH(th, h + 0.012), n = vnorm(vcross(vsub(b, a), vsub(e, c)));
      return n;
    };
    const dirCraneo = (th, h) => vnorm(vsub(PH(th, h), [0, yH(0.62), zCab - 0.01]));

    // ------------------------------------------------------------ huesos
    const mb = (nombre, padre, p) => ({ nombre, padre, p });
    const jx = 0.18 * kx + (bw - 1) * 0.08, jy = d.hombro - 0.04 * ky, cod = [jx + 0.012 * kx + (bw - 1) * 0.05, jy - B0.humero * ky, -0.008], mun = [cod[0] + (m ? 0.012 : 0.026) + (bw - 1) * 0.03, cod[1] - B0.antebrazo * ky, 0.012];
    const hx = (m ? 0.09 : 0.095), kn = [(m ? 0.086 : 0.086), d.rodilla, 0.006], tob = [(m ? 0.082 : 0.081), 0.085 * kf, 0];
    const defs = [mb('body', null, [0, d.cadera, 0]), mb('spine', 'body', [0, d.cintura, 0.004]), mb('torso', 'spine', [0, d.cintura + 0.2 * ky, 0]), mb('neck', 'torso', [0, chin - 0.025, -0.008]), mb('head', 'neck', [0, yH(0.2), zCab - 0.01])];
    for (const [S, sg] of [['L', 1], ['R', -1]]) {
      defs.push(mb('clav' + S, 'torso', [sg * 0.03, d.yt - 0.02, 0.0]), mb('arm' + S, 'clav' + S, [sg * jx, jy, 0]), mb('fore' + S, 'arm' + S, [sg * cod[0], cod[1], cod[2]]), mb('hand' + S, 'fore' + S, [sg * mun[0], mun[1], mun[2]]));
      defs.push(mb('leg' + S, 'body', [sg * hx, d.cadera, 0]), mb('shin' + S, 'leg' + S, [sg * kn[0], kn[1], kn[2]]), mb('foot' + S, 'shin' + S, [sg * tob[0], tob[1], tob[2]]), mb('toe' + S, 'foot' + S, [sg * (tob[0] + 0.012), 0.02, 0.135 * kf]));
    }
    defs.push(mb('skirt', 'body', [0, d.cadera, 0]));
    const conTrenza = look.hairStyle === 'trenza' || !!(peinado && peinado.cola);
    if (conTrenza) defs.push(mb('braid', 'torso', [0, yH(0.27) - 0.13, -0.09]));
    const iB = {}; defs.forEach((b, i) => { iB[b.nombre] = i; });

    // ------------------------------------------------------------ pesos y malla
    const pos = [], uvs = [], sI = [], sW = [], grp = [], tag = [], fixN = {}, idx = [], oscV = {};
    const V = (p, u, v, w, g, t, fn) => {
      const i = pos.length / 3; pos.push(p[0], p[1], p[2]); uvs.push(u / 512, 1 - v / 512); grp.push(g); tag.push(t);
      const e = Object.entries(w).filter(k => k[1] > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4); let s = 0; for (const k of e) s += k[1];
      for (let j = 0; j < 4; j++) { if (e[j]) { sI.push(iB[e[j][0]]); sW.push(e[j][1] / s); } else { sI.push(0); sW.push(0); } }
      if (fn) fixN[i] = fn;
      return i;
    };
    const pv = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const bridge = (a, b, ref) => {   // une dos anillos de vértices y elige el giro por la salida desde el centro, o por ref si se da
      let c = [0, 0, 0]; for (const i of a) c = vadd(c, pv(i)); for (const i of b) c = vadd(c, pv(i)); c = vmul(c, 1 / (a.length + b.length));
      let s = 0;
      for (let i = 0; i < a.length - 1; i++) {
        const p0 = pv(a[i]), p1 = pv(a[i + 1]), p2 = pv(b[i + 1]), p3 = pv(b[i]);
        const n = vcross(vsub(p2, p0), vsub(p3, p1)), cen = vmul(vadd(vadd(p0, p1), vadd(p2, p3)), 0.25); s += vdot(n, ref || vsub(cen, c));
      }
      for (let i = 0; i < a.length - 1; i++) { if (s > 0) idx.push(a[i], a[i + 1], b[i + 1], a[i], b[i + 1], b[i]); else idx.push(a[i], b[i + 1], a[i + 1], a[i], b[i], b[i + 1]); }
    };
    const fan = (a, apice, ref) => {
      let c = [0, 0, 0]; for (const i of a) c = vadd(c, pv(i)); c = vmul(c, 1 / a.length);
      const ap = pv(apice); let s = 0;
      for (let i = 0; i < a.length - 1; i++) { const n = vcross(vsub(pv(a[i + 1]), pv(a[i])), vsub(ap, pv(a[i]))); s += vdot(n, ref || vsub(ap, c)); }
      for (let i = 0; i < a.length - 1; i++) { if (s > 0) idx.push(a[i], a[i + 1], apice); else idx.push(a[i + 1], a[i], apice); }
    };
    const padT = (y, th) => { let p = 0; for (const g of prendas) { const f = GARMENTS[g.id] && GARMENTS[g.id].padT; if (f) p = max(p, f(y, th, d)); } return p * sm(yH(-0.07), d.yt + 0.012, y); };

    // Tronco, cuello y cabeza
    const THa = dobla(TH0, det), HTa = dobla(HT0, det), UHa = dobla(UH0, det), MM = (THa.length - 1) * 2, hc = THa.length - 1;
    const signo = c => (c >= hc ? 1 : -1), ic = c => abs(c - hc);
    const thDe = (c, y) => { const t = sm(d.yt + 0.006, chin + 0.07 * H, y), i = ic(c); return signo(c) * lerp(THa[i], HTa[i], t); };
    const uCabeza = th => { const a = abs(th); let i = 0; while (i < HTa.length - 2 && a > HTa[i + 1]) i++; return (th < 0 ? -1 : 1) * lerp(UHa[i], UHa[i + 1], clamp((a - HTa[i]) / (HTa[i + 1] - HTa[i]))); };
    const yMaxT = yH(-0.07);
    const TX = th => R.tronco.x + R.tronco.w * (th + 180) / 360, TY = y => R.tronco.y + R.tronco.h * (1 - (y - (d.yP - 0.03)) / (yMaxT - (d.yP - 0.03)));
    const CX = th => R.cara.x + R.cara.w / 2 + uCabeza(th), CY = h => R.cara.y + R.cara.h * (1 - (h - H_MIN) / (H_MAX - H_MIN));

    const wTronco = (y, th) => {
      const a = sm(d.cadera + 0.05, d.cintura + 0.02, y), b = sm(d.cintura + 0.02, d.cintura + 0.2, y), n = sm(d.yt, chin - 0.02, y), c = sm(chin, yH(0.1), y);
      const w = { body: 1 - a, spine: a * (1 - b), torso: a * b * (1 - n), neck: n * (1 - c), head: n * c };
      const lado = sm(35, 62, abs(th)) * sm(145, 118, abs(th)), cl = 0.55 * lado * sm(d.ya, d.yt, y) * (1 - n), S = th > 0 ? 'L' : 'R';
      if (cl > 0) { w.torso *= 1 - cl; w['clav' + S] = cl * a * b; }
      return w;
    };
    // Filas: la de la pelvis no es plana. Sube a los lados (ingle) y cae detrás (pliegue del glúteo).
    let filasT = dobla(filasY, det);
    const extras = [];
    extras.push(yH(-0.118));
    if (tiene('chaleco')) extras.push(d.yChaleco - 0.0025, d.yChaleco + 0.0025);
    filasT = filasT.concat(extras).sort((a, b) => a - b);
    const iAxila = filasT.findIndex(y => abs(y - d.ya) < 1e-6);
    const celdas = 2 * det;
    const riseP = th => { const t = rad(th); return 0.034 * sin(t) * sin(t) + (cos(t) < 0 ? -0.012 * cos(t) * cos(t) : 0); };
    const filasH = dobla(FILAS_H, det);
    // Un escote es una curva sobre la persona, no sobre el lienzo: se traza en metros (x, y) y se pasa a ángulo. Así no sale hexagonal ni se deforma sobre el hombro
    const thX = (x, y) => { if (P(90, y)[0] <= x) return 90; let a = 0, b = 90; for (let i = 0; i < 14; i++) { const c = (a + b) / 2; if (P(c, y)[0] < x) a = c; else b = c; } return (a + b) / 2; };
    const tablaA = pts => { const A = pts.map(q => [thX(q[0], q[1]), q[1]]); return a => { if (a <= A[0][0]) return A[0][1]; for (let i = 1; i < A.length; i++) if (a <= A[i][0]) return lerp(A[i - 1][1], A[i][1], (a - A[i - 1][0]) / ((A[i][0] - A[i - 1][0]) || 1)); return A[A.length - 1][1]; }; };
    const elipseEscote = (x0, yb, top) => { const o = []; for (let i = 0; i <= 16; i++) { const y = lerp(yb, top, 1 - pow(1 - i / 16, 1.6)); o.push([x0 * sqrt(max(0, 1 - pow((top - y) / (top - yb), 2))), y]); } return tablaA(o); };
    const topeEscote = yH(-0.112), xEsc = (m ? 0.075 : 0.068) * lerp(1, bw, 0.5), esc0 = elipseEscote(xEsc, d.yt - 0.03, topeEscote), esc1 = elipseEscote(xEsc - 0.012, d.yt - 0.0185, topeEscote + 0.006);
    const cuelloTunica = t => { const a = abs(t); return a < 118 ? esc0(a) : topeEscote + 0.004 * sm(118, 180, a); }, gruesoEscote = t => 0.0036;
    // Camisola de lino bajo la túnica: asoma en el escote y deja poca piel
    const camisola = t => { const a = abs(t); return a < 118 ? esc1(a) : topeEscote + 0.01; };
    const sisa = { rt: 31, yc: (d.yt + 0.012 + d.ya - 0.035) / 2, ry: (d.yt + 0.012 - d.ya + 0.035) / 2 };
    // Borde del cuello de la camisa: abierto en una uve corta; detrás sube por el cuello
    const cuelloCam = t => { const a = abs(t); return a < 34 ? lerp(d.yt + 0.006, yH(-0.105), pow(a / 34, 0.8)) : yH(-0.105) + 0.017 * sm(50, 150, a); };
    // Chaleco: uve corta, y sisa alrededor del hueco del brazo
    const xVt = 0.045 * lerp(1, bw, 0.5), yVt = yH(-0.105) - 0.004, tablaV = tablaA(Array.from({ length: 13 }, (_, i) => [xVt * i / 12, lerp(d.yt - 0.062, yVt, i / 12)])), aVt = thX(xVt, yVt);
    const topeCh = t => { const a = abs(t); return a < aVt ? tablaV(a) : max(yVt, cuelloCam(a) - 0.004); };
    const conFalda = tiene('tunica'), yOcultoT = d.cintura - 0.03, bajoFalda = (look.largoFalda || 0.15) * ky, yOcultoP = bajoFalda + 0.022;
    const G2 = [];   // rejilla: G2[fila][columna] = { p, w, th, y }
    const filas = filasT.map(y => ({ y, cab: false })).concat(filasH.map(h => ({ y: yH(h), cab: true, h })));
    const iCosturaCuello = filasT.length;   // primera fila en el bloque de cara
    filas.forEach((f, r) => {
      G2[r] = [];
      for (let c = 0; c <= MM; c++) {
        const th = thDe(c, f.y), y = r === 0 ? f.y + riseP(th) : f.y, p = P(th, y, f.cab ? 0 : padT(y, th));
        const ws = r === 0 ? (() => { const s = abs(sin(rad(th))), S = th > 0 ? 'L' : 'R'; return { body: 1 - 0.35 * s, ['leg' + S]: 0.35 * s }; })() : wTronco(y, th);
        G2[r][c] = { p, w: ws, th, y };
      }
    });
    const PT = (th, y) => { let r = 0; while (r < filas.length - 2 && filas[r + 1].y < y) r++; const a = filas[r], b = filas[r + 1], u = clamp((y - a.y) / (b.y - a.y)); return vlerp(P(th, a.y, a.cab ? 0 : padT(a.y, th)), P(th, b.y, b.cab ? 0 : padT(b.y, th)), u); };
    const vT = {}, vC = {};
    const vTr = (r, c) => { const k = r * 1000 + c; if (vT[k] === undefined) { const g = G2[r][c]; vT[k] = V(g.p, TX(g.th), TY(g.y), g.w, 'piel', 't'); } return vT[k]; };
    const vCb = (r, c) => { const k = r * 1000 + c; if (vC[k] === undefined) { const g = G2[r][c], h = (g.y - chin) / H; vC[k] = V(g.p, CX(g.th), CY(h), g.w, 'piel', h < -0.05 ? 't' : 'c'); } return vC[k]; };
    const huecoL = [hc + (2 * det) * 2, hc + (2 * det) * 3], huecoR = [hc - (2 * det) * 3, hc - (2 * det) * 2];   // columnas de 64° a 116°
    const enHueco = (r, c) => r >= iAxila && r < iAxila + celdas && ((c >= huecoL[0] && c < huecoL[1]) || (c >= huecoR[0] && c < huecoR[1]));
    for (let r = 0; r < filas.length - 1; r++) {
      const enCabeza = r >= iCosturaCuello, vf = enCabeza ? vCb : vTr;
      for (let c = 0; c < MM; c++) {
        if (enHueco(r, c) || (conFalda && filas[r + 1].y < yOcultoT)) continue;
        // La fila de cuello que cierra el tronco se vuelve a crear en la cabeza con su UV
        const a = vf(r, c), b = vf(r, c + 1);
        const up = r + 1 === iCosturaCuello ? [vTrSeam(c), vTrSeam(c + 1)] : [vf(r + 1, c + 1 - 1), vf(r + 1, c + 1)];
        bridgeQuad(a, b, up[1], up[0], G2[r][c], G2[r][c + 1], G2[r + 1][c + 1], G2[r + 1][c]);
      }
    }
    // Quad con salida radial: las columnas suben en θ y las filas en y, así que el giro es siempre el mismo
    function bridgeQuad(a, b, c2, d2) { idx.push(a, b, c2, a, c2, d2); }
    // Costura cuello: una fila extra con UV de tronco en la misma posición que la primera fila de cabeza
    function vTrSeam(c) { const k = 'S' + c; if (vT[k] === undefined) { const g = G2[iCosturaCuello][c]; vT[k] = V(g.p, TX(g.th), R.tronco.y + 1, g.w, 'piel', 't'); } return vT[k]; }
    // Remate de la coronilla
    const apice = V(PH(0, 0.9995), CX(0), CY(1), { head: 1 }, 'piel', 'c');
    { const a = []; for (let c = 0; c <= MM; c++) a.push(vCb(filas.length - 1, c)); fan(a, apice); }

    // ------------------------------------------------------------ brazos
    const prendaManga = prendas.map(g => GARMENTS[g.id]).find(g => g && g.padB);
    const finManga = prendaManga ? prendaManga.manga : 0;
    const kA = m ? 1 : 0.87, kAr = kA * lerp(1, bw, 0.8);
    const yMap = y => d.hombro - (1.415 - y) * (m ? 1 : 0.95) * ky;
    function ejeBrazo(y) {   // punto del eje a esa altura
      if (y >= cod[1]) { const t = clamp((jy - y) / (jy - cod[1])); return [lerp(jx, cod[0], t), y, lerp(0, cod[2], t)]; }
      const t = clamp((cod[1] - y) / (cod[1] - mun[1])); return [lerp(cod[0], mun[0], t), y, lerp(cod[2], mun[2], t)];
    }
    const largoB = jy - mun[1];
    const padB = y => { const t = clamp((jy - y) / largoB); return prendaManga && t <= finManga + 1e-4 ? prendaManga.padB(t) : 0; };
    const anillosBrazo = [];
    const kMano = B0.mano / 0.18 * ky, kManoX = kMano * lerp(1, kA, 0.5), e0M = ejeBrazo(mun[1]), dirM = (mun[0] - cod[0]) / B0.antebrazo * 0.5;
    const palmaC = (dy, inX, fZ) => [e0M[0] - dirM * dy - inX * kMano, mun[1] + dy * kMano, e0M[2] + fZ * kMano + 0.002];
    {
      const cadena = [[1.268, 0.205, 1.392, 0.058], [1.252, 0.222, 1.362, 0.056], [1.233, 0.229, 1.318, 0.052], [1.212, 0.231, 1.264, 0.049]];
      for (const [iy, ox, oy, rz] of cadena) {
        const Iy = yMap(iy), O = [ox * kx + (bw - 1) * 0.08, yMap(oy)], pad = padB(Iy), wI = sec(Iy)[0] + padT(Iy, 90) + 0.012 * kx;
        const I = [max(wI, 0.10), Iy], c = [(I[0] + O[0] + pad * 0.7) / 2, (I[1] + O[1] + pad * 0.7) / 2, -0.003];
        const A = [(I[0] - O[0] - pad * 0.7) / 2, (I[1] - O[1] - pad * 0.7) / 2, 0];
        anillosBrazo.push({ c, A, B: [0, 0, -(rz * kA * lerp(1, bw, 0.6) + pad)], y: Iy });
      }
      const base = [[0.105, 0.044, 0.049], [0.065, 0.041, 0.044], [0.025, 0.036, 0.037], [0, 0.035, 0.037], [-0.05, 0.0405, 0.045], [-0.125, 0.034, 0.038]];
      for (const [dy, rx, rz] of base) { const y = cod[1] + dy * (m ? 1 : 0.96) * ky, pad = padB(y); anillosBrazo.push({ c: ejeBrazo(y), A: [-(rx * kAr + pad), 0, 0], B: [0, 0, -(rz * kAr + pad)], y }); }
      for (const [dy, rx, rz] of [[0.06, 0.029, 0.034], [0, 0.0215, 0.028]]) { const y = mun[1] + dy, pad = padB(y); anillosBrazo.push({ c: ejeBrazo(y), A: [-(rx * kAr + pad), 0, 0], B: [0, 0, -(rz * kAr + pad)], y }); }
      // Borde de la manga: un escalón que da grosor a la tela
      if (prendaManga) {
        const yb = jy - finManga * largoB;
        const inter = (y, pad) => { const i = anillosBrazo.findIndex(a => a.y < y), a = anillosBrazo[i - 1], b = anillosBrazo[i], t = (a.y - y) / (a.y - b.y); const ra = vlen(a.A), rb = vlen(b.A), za = vlen(a.B), zb = vlen(b.B); const pA = padB(a.y), pB = padB(b.y) || 0; return { c: vlerp(a.c, b.c, t), A: [-(lerp(ra - pA, rb - pB, t) + pad), 0, 0], B: [0, 0, -(lerp(za - pA, zb - pB, t) + pad)], y }; };
        const i = anillosBrazo.findIndex(a => a.y < yb - 0.002);
        if (i > 4) { const nuevos = [inter(yb + 0.030, 0.012), inter(yb + 0.002, 0.0125), inter(yb - 0.002, 0.0012)]; for (let j = anillosBrazo.length - 1; j >= 0; j--) { const yj = anillosBrazo[j].y; if (yj < yb + 0.034 && yj > yb - 0.002) anillosBrazo.splice(j, 1); } anillosBrazo.splice(anillosBrazo.findIndex(a => a.y < yb - 0.002), 0, ...nuevos); }
      }
      // Palma: plana en el plano yz, con la cara interior hacia el muslo. Acaba en los nudillos; los dedos son piezas aparte
      const tiras = [[-0.024, 0.0185, 0.0305, 0, 0], [-0.050, 0.0185, 0.0400, 0.001, 0.001], [-0.074, 0.0160, 0.0410, 0.002, 0.002], [-0.092, 0.0125, 0.0395, 0.0045, 0.002], [-0.102, 0.0075, 0.031, 0.007, 0.002]];
      for (const [dy, tx, tz, inX, fZ] of tiras) anillosBrazo.push({ c: palmaC(dy, inX, fZ), A: [-tx * kManoX, 0, 0], B: [0, 0, -tz * kManoX], y: mun[1] + dy * kMano, mano: true });
    }
    if (det > 1) { const o = []; for (let i = 0; i < anillosBrazo.length; i++) { o.push(anillosBrazo[i]); if (i < anillosBrazo.length - 1) { const a = anillosBrazo[i], b = anillosBrazo[i + 1]; o.push({ c: vlerp(a.c, b.c, 0.5), A: vlerp(a.A, b.A, 0.5), B: vlerp(a.B, b.B, 0.5), y: (a.y + b.y) / 2, mano: a.mano }); } } anillosBrazo.length = 0; anillosBrazo.push(...o); }
    const yCod = cod[1];
    const wBrazo = (a, S) => {
      const y = a.y, wS = {}, armN = 'arm' + S, foreN = 'fore' + S, handN = 'hand' + S;
      const f = sm(yCod + 0.035, yCod - 0.035, y), h = sm(mun[1] + 0.006, mun[1] - 0.03, y);
      wS[armN] = 1 - f; wS[foreN] = f * (1 - h); wS[handN] = f * h;
      return wS;
    };
    const nB = 8 * det, cadenaW = [0.42, 0.78, 0.95, 1];
    function hazBrazo(S, sg) {
      const t = sg > 0 ? 'bL' : 'bR';
      const col = hueco => (sg > 0 ? huecoL[0] + hueco : huecoR[1] - hueco);   // 0 delante, celdas detrás
      const borde = [];
      const q = celdas, c0 = i => col(i);
      for (let i = q / 2; i <= q; i++) borde.push([iAxila, c0(i)]);
      for (let i = 1; i <= q; i++) borde.push([iAxila + i, c0(q)]);
      for (let i = q - 1; i >= 0; i--) borde.push([iAxila + q, c0(i)]);
      for (let i = q - 1; i >= 0; i--) borde.push([iAxila + i, c0(0)]);
      for (let i = 1; i < q / 2; i++) borde.push([iAxila, c0(i)]);
      const vb = y => R.brazo.y + R.brazo.h * clamp((yMap(1.40) - y) / (yMap(1.40) - mun[1]));
      // anillo 0: el borde del hueco
      const r0 = [];
      borde.forEach((rc, j) => { const g = G2[rc[0]][rc[1]]; r0.push(V(g.p, R.brazo.x + R.brazo.w * j / nB, R.brazo.y + 2, g.w, 'piel', t)); });
      { const g = G2[borde[0][0]][borde[0][1]]; r0.push(V(g.p, R.brazo.x + R.brazo.w, R.brazo.y + 2, g.w, 'piel', t)); }
      let prev = r0, iCad = 0;
      anillosBrazo.forEach((a, n) => {
        const esMano = a.mano, rc = esMano ? R.mano : R.brazo, ring = [];
        let ws = wBrazo(a, S);
        if (n < 4 * det) { const k = cadenaW[min(3, floor(n / det))]; ws = { ['arm' + S]: k, ['clav' + S]: 1 - k }; }
        const vv = esMano ? R.mano.y + R.mano.h * clamp((mun[1] - a.y) / (B0.mano * ky)) : vb(a.y);
        for (let j = 0; j <= nB; j++) {
          const f = 2 * PI * j / nB, cf = cos(f), sf = sin(f), e = esMano ? 0.72 : 1;
          const p = vadd(a.c, vadd(vmul(a.A, pw(cf, e)), vmul(a.B, pw(sf, e))));
          if (sg < 0) p[0] = -p[0], 0;
          ring.push(V(p, rc.x + rc.w * j / nB, vv, ws, 'piel', t));
        }
        bridge(prev, ring); prev = ring;
      });
      // Cierre de la palma, por dentro de los dedos
      { const u = anillosBrazo[anillosBrazo.length - 1], tp = vadd(u.c, [-0.004, -0.005 * kMano, 0]); if (sg < 0) tp[0] = -tp[0]; fan(prev, V(tp, R.mano.x + R.mano.w / 2, R.mano.y + R.mano.h, { ['hand' + S]: 1 }, 'piel', t)); }
      // Tubo por puntos, con radio propio: dedos y pulgar. El lado de cada dedo que toca al vecino se oscurece, y de ahí sale la raya entre dedos
      const tubo = (pts, radios, nL, sombraLado) => {
        let P0 = pts, R0 = radios;
        if (det > 1) { P0 = []; R0 = []; pts.forEach((q, i) => { P0.push(q); R0.push(radios[i]); if (i < pts.length - 1) { P0.push(vlerp(q, pts[i + 1], 0.5)); R0.push((radios[i] + radios[i + 1]) / 2); } }); }
        const nR = P0.length, Z = [0, 0, 1], wM = { ['hand' + S]: 1 };
        let pa = null, tg = null;
        P0.forEach((q, i) => {
          tg = vnorm(vsub(P0[min(i + 1, nR - 1)], P0[max(i - 1, 0)]));
          const lado = vnorm(vsub(Z, vmul(tg, vdot(Z, tg)))), arriba = vnorm(vcross(tg, lado)), ring = [];
          for (let j = 0; j <= nL; j++) {
            const f = 2 * PI * j / nL, cf = cos(f), sf = sin(f), pt = vadd(q, vadd(vmul(lado, cf * R0[i]), vmul(arriba, sf * R0[i] * 0.9)));
            if (sg < 0) pt[0] = -pt[0];
            const iv = V(pt, R.dedo.x + R.dedo.w * j / nL, R.dedo.y + R.dedo.h * i / (nR - 1), wM, 'dedo', t);
            oscV[iv] = (1 - sombraLado[cf > 0 ? 0 : 1] * cf * cf) * (1 - 0.08 * max(0, sf));
            ring.push(iv);
          }
          if (pa) bridge(pa, ring);
          pa = ring;
        });
        const fin = vadd(P0[nR - 1], vmul(tg, R0[nR - 1] * 0.72)); if (sg < 0) fin[0] = -fin[0];
        fan(pa, V(fin, R.dedo.x + R.dedo.w * 0.5, R.dedo.y + R.dedo.h, wM, 'dedo', t));
      };
      // Dedos: z en la palma, radio, largo, dónde nacen, cuánto se cierran de más. Mano en reposo: se curvan hacia el muslo y se tocan
      const DEDOS = [[0.0288, 0.0098, 0.076, -0.086, 0], [0.0098, 0.0102, 0.086, -0.090, 3], [-0.0098, 0.0098, 0.080, -0.088, 6], [-0.0284, 0.0086, 0.062, -0.081, 10]];
      DEDOS.forEach(([zd, r, L, dyB, ex], iD) => {
        const a0 = palmaC(dyB, 0.004, 0.002); a0[2] += zd * kManoX;
        const angs = [20 + ex, 48 + ex * 1.4, 78 + ex * 1.8], tramos = [0.46, 0.30, 0.24], pts = [a0];
        angs.forEach((a, k) => { const p = pts[pts.length - 1]; pts.push(vadd(p, vmul(vnorm([-sin(rad(a)), -cos(rad(a)), zd * 0.1]), L * kMano * tramos[k]))); });
        tubo(pts, [r, r * 0.96, r * 0.88, r * 0.76].map(x => x * kManoX), 4 * det, [iD === 0 ? 0.08 : 0.26, iD === 3 ? 0.06 : 0.26]);
      });
      // Pulgar: sale de la base de la palma y queda junto al índice, por el lado de dentro. No forma una V con los dedos
      {
        const p0 = palmaC(-0.032, 0.006, 0); p0[2] += 0.016 * kMano;
        const p1 = vadd(p0, vmul([-0.012, -0.029, 0.022], kMano)), p2 = vadd(p1, vmul([-0.012, -0.025, 0.011], kMano)), p3 = vadd(p2, vmul([-0.009, -0.021, 0.002], kMano));
        tubo([p0, p1, p2, p3], [0.0175, 0.0128, 0.0104, 0.0086].map(x => x * kManoX), 5 * det, [0.05, 0.1]);
      }
    }
    hazBrazo('L', 1); hazBrazo('R', -1);

    // ------------------------------------------------------------ piernas y pies
    const TP = {
      m: [[0.765, 0.085, 0.000, 0.077, 0.088], [0.69, 0.088, 0.004, 0.068, 0.078], [0.60, 0.088, 0.005, 0.057, 0.066], [0.52, 0.087, 0.006, 0.049, 0.055], [0.475, 0.086, 0.008, 0.047, 0.052], [0.42, 0.085, 0.002, 0.044, 0.049], [0.345, 0.084, -0.006, 0.047, 0.055], [0.25, 0.083, -0.004, 0.040, 0.046], [0.165, 0.082, 0.0, 0.031, 0.037], [0.125, 0.082, 0.002, 0.029, 0.036]],
      f: [[0.73, 0.092, 0.0, 0.082, 0.090], [0.66, 0.092, 0.004, 0.072, 0.080], [0.57, 0.090, 0.006, 0.058, 0.066], [0.495, 0.087, 0.006, 0.048, 0.053], [0.45, 0.086, 0.008, 0.045, 0.050], [0.40, 0.084, 0.0, 0.041, 0.046], [0.33, 0.083, -0.007, 0.044, 0.052], [0.24, 0.082, -0.004, 0.036, 0.042], [0.16, 0.081, 0.0, 0.028, 0.033], [0.12, 0.081, 0.002, 0.026, 0.032]],
    }[sx].map(r => [r[0] * ky, r[1], r[2], r[3] * lerp(1, bw, 0.8), r[4] * lerp(1, bw, 0.8)]);
    const tablaP = curva(TP.slice().reverse());
    const panta = tiene('pantalon'), botaAlta = panta && tiene('botas'), yBajo = 0.105 * ky, yHem = (botaAlta ? 0.24 : 0.129) * ky;
    const padP = prendas.reduce((s, g) => max(s, (GARMENTS[g.id] && GARMENTS[g.id].padP) || 0), 0), padPie = prendas.reduce((s, g) => max(s, (GARMENTS[g.id] && GARMENTS[g.id].padPie) || 0), 0);
    const pantaX = curva1([[0.1, 0.054], [0.24, 0.056], [0.345, 0.057], [0.475, 0.060], [0.60, 0.070], [0.69, 0.080], [0.8, 0.09]]), pantaZ = curva1([[0.1, 0.058], [0.24, 0.060], [0.345, 0.062], [0.475, 0.066], [0.60, 0.078], [0.69, 0.089], [0.8, 0.101]]);
    function secPierna(y) {
      const s = tablaP(y); let [cx, cz, rx, rz] = s;
      if (panta && y >= yHem) {   // pantalón ancho y recto, no malla
        const fuelle = botaAlta ? 0.010 * G(y - yHem - 0.03, 0.035) : 0, kb = lerp(1, bw, 0.8);
        rx = pantaX(y / ky) * kb + fuelle; rz = pantaZ(y / ky) * kb + fuelle; cz += 0.002;
      } else { const ex = botaAlta ? 0.0115 * sm(0.09, 0.16, y) + 0.005 : panta ? 0.005 : padP; rx += ex; rz += ex; }
      return { cx, cz, rx, rz };
    }
    const yPierna = dobla(TP.map(r => r[0]), det).concat(panta ? [yHem + 0.002, yHem - 0.002] : []).concat(conFalda ? [bajoFalda + 0.012] : []).sort((a, b) => b - a);
    const nP = 12 * det, vP = y => R.pierna.y + R.pierna.h * clamp((d.yP + 0.02 - y) / (d.yP + 0.02 - 0.075));
    const pasoCentro = (t) => { // línea de la entrepierna: t -1 delante, 0 centro, 1 detrás
      const yc = d.yP - 0.016; const zf = G2[0][hc].p[2], zb = G2[0][0].p[2]; return [0, yc + 0.012 * abs(t), lerp(lerp(0, zf, max(0, -t)), zb, max(0, t))];
    };
    const yTob = tob[1];
    function hazPierna(S, sg) {
      const t = sg > 0 ? 'pL' : 'pR', legN = 'leg' + S, shinN = 'shin' + S, footN = 'foot' + S, toeN = 'toe' + S;
      const r0 = [], ncr = 2 * det - 1;   // vértices de la línea de la entrepierna
      const lista = [];
      const nCr = (ncr - 1) / 2;
      for (let i = 0; i <= nCr; i++) lista.push({ p: pasoCentro(-i / (nCr + 1)), w: { body: 1 } });
      for (let i = 0; i <= hc; i++) { const g = G2[0][sg > 0 ? hc + i : hc - i]; lista.push({ p: g.p, w: g.w }); }
      for (let i = nCr; i >= 1; i--) lista.push({ p: pasoCentro(i / (nCr + 1)), w: { body: 1 } });
      lista.forEach((l, j) => r0.push(V(l.p, R.pierna.x + R.pierna.w * j / nP, R.pierna.y + 1, l.w, 'piel', t)));
      r0.push(V(lista[0].p, R.pierna.x + R.pierna.w, R.pierna.y + 1, lista[0].w, 'piel', t));
      let prev = r0; const ultimo = [];
      yPierna.forEach((y, n) => {
        const s = secPierna(y);
        const ka = sm(d.rodilla + 0.05, d.rodilla - 0.05, y);
        const wt = sm(d.yP - 0.05, d.yP - 0.11, y);
        const ws = { body: (1 - wt) * 0.5, [legN]: 1 - ka - (1 - wt) * 0.5, [shinN]: ka };
        const ring = [], fs = sm(yTob + 0.05, yTob - 0.01, y);
        if (fs > 0) { ws[footN] = fs * ka; ws[shinN] = (1 - fs) * ka; }
        for (let j = 0; j <= nP; j++) {
          const f = 2 * PI * j / nP, p = [s.cx - s.rx * cos(f), y, s.cz + s.rz * sin(f)];
          if (sg < 0) p[0] = -p[0];
          ring.push(V(p, R.pierna.x + R.pierna.w * j / nP, vP(y), ws, 'piel', t));
          if (n === yPierna.length - 1) ultimo.push({ p, ws });
        }
        if (!conFalda || (n > 0 && yPierna[n - 1] < yOcultoP)) bridge(prev, ring);
        prev = ring;
      });
      prev = ultimo.map((u, j) => V(u.p, R.pie.x + R.pie.w * j / nP, R.pie.y + 0.5, u.ws, 'piel', t));
      // Pie: los anillos giran de tumbados a de pie alrededor del talón. T empeine, S planta.
      const giro = rad(3.5) * sg, cg = cos(giro), sg2 = sin(giro), ang = (p, k) => { const dx = p[0] - tob[0] * sg, dz = p[2]; return [tob[0] * sg + lerp(dx, dx * cg + dz * sg2, k), p[1], lerp(dz, -dx * sg2 + dz * cg, k)]; };
      const anillos = [];
      pieF.forEach(a => { anillos.push({ T: [a.T[0] * kf, a.T[1] * kf], S: [a.S[0] * kf, a.S[1] * kf], a: a.a * kf }); });
      const rp = det > 1 ? anillos.flatMap((a, i) => (i < anillos.length - 1 ? [a, { T: [(a.T[0] + anillos[i + 1].T[0]) / 2, (a.T[1] + anillos[i + 1].T[1]) / 2], S: [(a.S[0] + anillos[i + 1].S[0]) / 2, (a.S[1] + anillos[i + 1].S[1]) / 2], a: (a.a + anillos[i + 1].a) / 2 }] : [a])) : anillos;
      rp.forEach((a, n) => {
        const ring = [], c = [(a.T[0] + a.S[0]) / 2, (a.T[1] + a.S[1]) / 2], up = [(a.T[0] - a.S[0]) / 2, (a.T[1] - a.S[1]) / 2], k = n / (rp.length - 1);
        const ws = a.S[0] > 0.105 * kf ? { [toeN]: sm(0.105 * kf, 0.14 * kf, a.S[0]), [footN]: 1 - sm(0.105 * kf, 0.14 * kf, a.S[0]) } : { [footN]: 1 };
        for (let j = 0; j <= nP; j++) {
          const f = 2 * PI * j / nP, cf = cos(f), sf = sin(f), lat = (a.a + padPie) * pw(cf, 0.85), sube = sf >= 0 ? sf : -pow(-sf, 0.55), bajo = sf < 0 ? 1 : 1;
          let p = [tob[0] * sg - sg * lat, c[1] + up[1] * sube + (sf >= 0 ? padPie : 0), c[0] + up[0] * sube + (sf >= 0 ? padPie * 0.7 : -padPie * 0.5) * abs(sube)];
          p[1] = max(p[1], 0);
          p = ang(p, sm(0, 0.4, k));
          ring.push(V(p, R.pie.x + R.pie.w * j / nP, R.pie.y + R.pie.h * (n + 1) / (rp.length + 1), ws, 'piel', t));
        }
        bridge(prev, ring); prev = ring;
      });
      const ult = rp[rp.length - 1], tipF = ang([tob[0] * sg, (ult.T[1] + ult.S[1]) / 2, (ult.T[0] + ult.S[0]) / 2 + 0.013 * kf + padPie], 1);
      fan(prev, V(tipF, R.pie.x + R.pie.w / 2, R.pie.y + R.pie.h, { [toeN]: 1 }, 'piel', t));
    }
    hazPierna('L', 1); hazPierna('R', -1);

    // ------------------------------------------------------------ nariz (40-60 triángulos) y orejas
    const uvCara = (xm, h) => { const x = abs(xm), th = thetaDeX(x, h) * (xm < 0 ? -1 : 1); return [CX(th), CY(h)]; };
    const lutTheta = {};
    function thetaDeX(x, h) {
      const key = Math.round(h * 200); let L = lutTheta[key];
      if (!L) { L = lutTheta[key] = []; for (let i = 0; i <= 50; i++) L.push(PH(i * 2, key / 200)[0]); }
      let i = 0; while (i < 49 && L[i + 1] < x) i++;
      const a = L[i], b = L[i + 1]; return (i + clamp((x - a) / ((b - a) || 1))) * 2;
    }
    const zCaraX = (xm, h) => { const th = thetaDeX(abs(xm), h) * (xm < 0 ? -1 : 1); return PH(th, h); };
    const pegados = [];   // vértices que se funden con la cara: su normal se copia de la malla al final
    // Punto de la malla de la cabeza (no de la superficie analítica): lo que va pegado a la cara no se hunde con la malla de juego
    const PM = (th, h) => {
      let r = 0; while (r < filasH.length - 2 && filasH[r + 1] < h) r++;
      const a = abs(th), sgn = th < 0 ? -1 : 1; let j = 0; while (j < HTa.length - 2 && HTa[j + 1] < a) j++;
      const u = clamp((h - filasH[r]) / (filasH[r + 1] - filasH[r])), v = clamp((a - HTa[j]) / (HTa[j + 1] - HTa[j])), g = (rr, jj) => PH(sgn * HTa[jj], filasH[rr]);
      return vlerp(vlerp(g(r, j), g(r, j + 1), v), vlerp(g(r + 1, j), g(r + 1, j + 1), v), u);
    };
    {
      // h, medio ancho en la base, salida del caballete (en altos de cabeza)
      const tabla0 = m
        ? [[0.55, 0.040, 0.000], [0.50, 0.046, 0.012], [0.445, 0.053, 0.032], [0.39, 0.061, 0.049], [0.355, 0.070, 0.061], [0.327, 0.080, 0.070], [0.306, 0.082, 0.065], [0.288, 0.073, 0.040], [0.27, 0.050, 0.0]]
        : [[0.55, 0.035, 0.000], [0.50, 0.040, 0.004], [0.445, 0.045, 0.014], [0.395, 0.051, 0.027], [0.363, 0.059, 0.04], [0.34, 0.068, 0.051], [0.322, 0.072, 0.05], [0.306, 0.064, 0.033], [0.289, 0.044, 0.0]], hPunta = (m ? 0.322 : 0.334) + NAR.dh;
      const hP0 = hPunta - NAR.dh, tabla = tabla0.map(([h0, hw0, sal0]) => [h0 + NAR.dh * sm(0.52, 0.40, h0), hw0 * lerp(1, NAR.kw, sm(0.47, 0.37, h0)) * lerp(1, NAR.bulbo, G(h0 - hP0, 0.03) * 0.5), sal0 * NAR.ks * (1 - NAR.conc * G(h0 - (hP0 + 0.095), 0.05)) * lerp(1, NAR.bulbo, G(h0 - hP0, 0.022) * 0.14)]);
      const f = curva(tabla.slice().reverse()), hs = dobla(tabla.map(r => r[0]), det), nA = 8 * det, kNw = 1 + vari.nar, kNs = 1 + vari.narL;
      let prev = null;
      hs.forEach((h, n) => {
        const [hw0, sal0] = f(h), hw = hw0 * kNw, sal = sal0 * kNs, ring = [];
        for (let j = 0; j <= nA; j++) {
          const t = j / nA * 2 - 1, at = abs(t);   // -1 borde, 0 caballete, 1 borde
          const xn = t * hw;                      // posición en la cara
          const q = PM(thetaDeX(abs(xn) * H, h) * (xn < 0 ? -1 : 1), h);
          // Perfil de la sección: caballete en cuña blanda arriba, punta en bulbo abajo. El borde se funde con la cara
          const kP = G(h - hPunta, 0.034), surcoA = 1 - 0.38 * G(at - 0.55, 0.11) * G(h - (hPunta - 0.016), 0.024), perf = pow(1 - pow(at, lerp(1.9, 2.2, kP)), lerp(2.2, 1.25, kP)) * surcoA, ala = 0.02 * G(at - 0.7, 0.12) * G(h - (hPunta - 0.022), 0.02);
          const z = q[2] + (sal * perf + (at < 0.99 ? ala : 0)) * H + 0.0004;
          const p = [q[0], yH(h), z];
          const uv = uvCara(q[0], h);
          const baja = h < hPunta - 0.022 && at < 0.99;
          const fn = at > 0.99 || n === 0 || n === hs.length - 1 ? nCab(thetaDeX(abs(q[0]), h) * (q[0] < 0 ? -1 : 1), h) : baja ? vnorm([t * 0.6, -0.3, 0.8]) : null;
          const vN = V(p, uv[0], uv[1], { head: 1 }, 'nariz', 'c', fn); oscV[vN] = (1 - 0.1 * sm(hPunta - 0.015, hPunta - 0.035, h) * (1 - at * at)) * (1 - 0.08 * sm(0.3, 0.7, at) * sm(0.56, 0.45, h) * sm(1, 0.8, at)); if (at > 0.99 || n === 0 || n === hs.length - 1) pegados.push({ i: vN, th: thetaDeX(abs(xn) * H, h) * (xn < 0 ? -1 : 1), h }); ring.push(vN);
        }
        if (prev) bridge(prev, ring, [0, 0, 1]); prev = ring;
      });
    }
    // Geometría del ojo, compartida por el lienzo y el párpado. t 0 lagrimal, t 1 rabillo
    const OJ = OJOS[look.eyeStyle] || null, CJ = CEJAS[look.brows] || null, rabillo = OJ ? OJ.rab : 0.007;
    const ojoG = k => {
      const hE = d.hOjos, wE = OJ ? OJ.w : m ? 0.135 : 0.14, hEs = OJ ? OJ.s : m ? 0.0245 : 0.0268, hEi = OJ ? OJ.i : m ? 0.0145 : 0.0155, cx = k * 0.126;
      return { hE, wE, hEs, hEi, cx, xo: t => cx + k * (t - 0.5) * wE,
        sup: t => hE + 0.004 + hEs * pow(sin(PI * pow(t, 0.9)), 0.85) + rabillo * (t - 0.5),
        inf: t => hE + 0.004 - hEi * pow(sin(PI * pow(t, 1.15)), 0.95) + rabillo * (t - 0.5) };
    };
    // Párpado superior: una pieza fina con la misma UV que la cara. Su borde mira hacia abajo y da sombra real sobre el ojo
    function hazParpado(k) {
      const o = ojoG(k), N = 6 * det, gr = 'parpado' + (k > 0 ? 'L' : 'R');
      let prev = null;
      for (const [rf, kS] of [[0, 1], [0.45, 0.82], [1, 0]]) {
        const ring = [];
        for (let i = 0; i <= N; i++) {
          const t = i / N, xn = o.xo(t) + k * (t - 0.5) * o.wE * 0.1 * rf, hh = o.sup(t) + rf * (0.019 + 0.005 * sin(PI * t)) - (1 - rf) * 0.001;
          const th = thetaDeX(abs(xn) * H, hh) * (xn < 0 ? -1 : 1), q = PM(th, hh), env = pow(sin(PI * clamp(t * 0.96 + 0.02)), 0.7), borde = i === 0 || i === N;
          const n0 = nCab(th, hh), fn = rf === 1 || borde ? n0 : rf === 0 ? vnorm([n0[0], n0[1] - 0.6, n0[2]]) : null;
          const ivL = V([q[0], q[1], q[2] + 0.0046 * kS * env + 0.0005], CX(th), CY(hh), { head: 1 }, gr, 'c', fn); if (rf === 1 || borde) pegados.push({ i: ivL, th, h: hh }); ring.push(ivL);
        }
        if (prev) bridge(prev, ring, [0, 0, 1]); prev = ring;
      }
    }
    // El globo del ojo: una pieza convexa con la misma UV que la cara, normal de esfera y poca rugosidad. Da el brillo que se mueve con la luz
    function hazGlobo(k) {
      const o = ojoG(k), Nx = 6 * det, Ny = 2 * det, gr = 'ojo' + (k > 0 ? 'L' : 'R'), cen = PM(thetaDeX(abs(o.cx) * H, o.hE + 0.01) * k, o.hE + 0.01), cE = [cen[0], cen[1], cen[2] - 0.0115];
      let prev = null;
      for (let j = 0; j <= Ny; j++) {
        const v = j / Ny, ring = [];
        for (let i = 0; i <= Nx; i++) {
          const t = i / Nx, hh = lerp(o.inf(t) - 0.003, o.sup(t) + 0.007, v), xn = o.xo(t), th = thetaDeX(abs(xn) * H, hh) * (xn < 0 ? -1 : 1), q = PM(th, hh), b = 0.0031 * pow(sin(PI * clamp(t * 0.94 + 0.03)), 0.7) * pow(sin(PI * clamp(v * 0.9 + 0.05)), 0.8) + 0.0006, p = [q[0], q[1], q[2] + b];
          const iv = V(p, CX(th), CY(hh), { head: 1 }, gr, 'c', vnorm(vsub(p, cE))); oscV[iv] = lerp(0.74, 1, sm(1, 0.5, v)); ring.push(iv);
        }
        if (prev) bridge(prev, ring, [0, 0, 1]); prev = ring;
      }
    }
    hazGlobo(1); hazGlobo(-1);
    hazParpado(1); hazParpado(-1);
    function hazOreja(S, sg) {
      const c = PH(sg * 94, 0.445), nE = det > 1 ? 24 : 12, alto = (m ? 0.108 : 0.098) * H, ancho = (m ? 0.066 : 0.060) * H, inc = rad(11), fl = rad(6);
      const punto = (a, r, salida) => {  // a 0 atrás, 90° arriba. El borde de atrás se abre hacia fuera; abajo se estrecha en un lóbulo redondo
        const sa = sin(a), ca = cos(a), baj = sa < 0 ? sa * sa : 0, ar = (sa > 0 ? pw(sa, 0.78) : sa) * alto * r, at = pw(ca, 0.8) * ancho * r * lerp(1, 0.6, baj);
        return [sg * (abs(c[0]) - 0.003 + (at + ancho) * sin(fl) + salida), c[1] + ar, c[2] - 0.012 * H - at * cos(fl) - ar * sin(inc)];
      };
      const anillo = (r, sal, rr, os) => { const o = []; for (let j = 0; j <= nE; j++) { const a = 2 * PI * (j + 0.5) / nE, p = punto(a, r, sal), iv = V(p, R.oreja.x + R.oreja.w / 2 + cos(a) * rr * R.oreja.w / 2, R.oreja.y + R.oreja.h / 2 - sin(a) * rr * R.oreja.h / 2, { head: 1 }, 'oreja' + S, 'c'); if (os) oscV[iv] = os; o.push(iv); } return o; };
      const a0 = anillo(0.9, -0.006, 0.98, 0.8), a1 = anillo(1.0, 0.002, 0.85, 0.88), a2 = anillo(0.8, 0.0045, 0.6, 0.86), a3 = anillo(0.52, 0.0005, 0.28, 0.74);
      const fuera = [sg, 0, 0.15]; bridge(a0, a1); bridge(a1, a2, fuera); bridge(a2, a3, fuera);
      const ce = V(punto(0, 0, -0.003), R.oreja.x + R.oreja.w / 2, R.oreja.y + R.oreja.h / 2, { head: 1 }, 'oreja' + S, 'c'); oscV[ce] = 0.74;
      fan(a3, ce, fuera);
    }
    if (look.hairStyle !== 'panuelo' && !(peinado && peinado.tapaOrejas)) { hazOreja('L', 1); hazOreja('R', -1); }

    // ------------------------------------------------------------ prendas con forma propia
    const hayFalda = tiene('tunica');
    let radioFalda = null;
    if (hayFalda) {
      const bajo = bajoFalda, kw = lerp(1, bw, 0.7), yTop = d.cintura + 0.01;
      const TF = [[yTop, sec(yTop)[0] + 0.009, sec(yTop)[1] + 0.009, sec(yTop)[2] + 0.009], [d.cintura - 0.055, 0.158 * kw + 0.026 * panza, 0.094 + 0.05 * panza, 0.099], [d.cadera + 0.02, 0.192 * kw + 0.012 * panza, 0.110 + 0.03 * panza, 0.128], [d.cadera - 0.09, 0.206 * kw, 0.128 + 0.012 * panza, 0.150],
        [0.60, 0.214 * kw, 0.136, 0.160], [0.44, 0.224 * kw, 0.152, 0.176], [0.30, 0.234 * kw, 0.162, 0.188], [bajo, 0.244 * kw, 0.170, 0.198]];
      const fT = curva(TF.slice().reverse()), yF = dobla(TF.map(r => r[0]), det), nF = 28 * det;
      radioFalda = (th, y) => { const [w, f, b] = fT(y), t = rad(th), s = sin(t), c = cos(t); return [w * pw(s, 0.92), y, (c >= 0 ? f : b) * pw(c, 0.92)]; };
      const skinF = (th, y) => {
        const k = clamp((yTop - 0.06 - y) / (yTop - 0.06 - bajo)), s = sin(rad(th)), tw = 0.62 * sm(0, 0.8, k);
        return { body: 1 - tw - 0.25 * k, legL: tw * (0.5 + 0.5 * s), legR: tw * (0.5 - 0.5 * s), skirt: 0.25 * k };
      };
      const olaB = (th, k) => { const q = rad(th) + 0.1 * k * sin(rad(th) * 3 + 0.8); return sin(q * 5 + 1.2) * 0.62 + sin(q * 8 + 0.4) * 0.38; }, ola = (th, k) => olaB(th, k) * 0.03 * pow(k, 0.8);
      let prev = null;
      yF.forEach((y, n) => {
        const ring = [], k = n / (yF.length - 1), f = clamp((yTop - y) / (yTop - bajo));
        for (let j = 0; j <= nF; j++) {
          const th = -180 + 360 * j / nF, q = radioFalda(th, y), L = hypot(q[0], q[2]) || 1, o = ola(th, f), dh = n === yF.length - 1 ? 0.007 * sin(rad(th) * 5 + 0.7) : 0;
          const ivF = V([q[0] + q[0] / L * o, y + dh, q[2] + q[2] / L * o], R.falda.x + R.falda.w * j / nF, R.falda.y + R.falda.h * (1 - (y - bajo) / (yTop - bajo)), skinF(th, y), 'falda', 'f');
          oscV[ivF] = 1 - 0.42 * max(0, -olaB(th, f)) * sm(0.05, 0.5, f);
          ring.push(ivF);
        }
        if (prev) bridge(prev, ring); prev = ring;
      });
      // Por dentro se cierra con un fondo oscuro, sin material de doble cara: una llamada
      const fin = []; for (let j = 0; j <= nF; j++) { const th = -180 + 360 * j / nF, q = radioFalda(th, bajo + 0.03); fin.push(V([q[0] * 0.8, bajo + 0.04, q[2] * 0.8], R.falda.x + 2, R.falda.y + R.falda.h - 1, skinF(th, bajo), 'faldaIn', 'f')); }
      { const a = prev, b = fin; for (let i = 0; i < a.length - 1; i++) idx.push(a[i], b[i + 1], a[i + 1], a[i], b[i], b[i + 1]); }
      // Delantal: una plancha sobre la falda, sin los pliegues
      if (tiene('delantal')) {
        const yD = [d.cintura + 0.005, d.cintura - 0.06, d.cadera, d.cadera - 0.12, d.cadera - 0.27, (look.largoDelantal || 0.44) * ky], thD = [47, 46, 44, 42, 41, 40], nD = 12 * det;
        let pr = null;
        const fD = dobla(yD, det), fTh = dobla(thD, det);
        fD.forEach((y, n) => {
          const ring = [], ma = fTh[n];
          for (let j = 0; j <= nD; j++) {
            const th = ma * (j / nD * 2 - 1), q = radioFalda(th, y), L = hypot(q[0], q[2]) || 1, fy = clamp((yTop - y) / (yTop - bajo)), ond = (sin(rad(th) * 9 + 1.1) * 0.65 + sin(rad(th) * 14 + 2.6) * 0.35) * sm(0, 0.3, fy), off = 0.009 + 0.024 * pow(fy, 0.85) + 0.012 * ond;
            const ivD = V([q[0] + q[0] / L * off, y, q[2] + q[2] / L * off], R.delantal.x + R.delantal.w * j / nD, R.delantal.y + R.delantal.h * n / (fD.length - 1), skinF(th, y), 'delantal', 'f2');
            oscV[ivD] = 1 - 0.5 * max(0, -ond); ring.push(ivD);
          }
          if (pr) bridge(pr, ring); pr = ring;
        });
      }
      // Ribete del escote: una cinta en relieve que tapa el borde pintado
      {
        const nR = 32 * det, grueso = gruesoEscote;
        const filaY = (fnY, off, vv) => { const o = []; for (let j = 0; j <= nR; j++) { const th = -180 + 360 * j / nR, y = fnY(th), q = PT(th, y), L = hypot(q[0], q[2] - sec(y)[3]) || 1; o.push(V([q[0] + q[0] / L * off, y + off * 0.5, q[2] + (q[2] - sec(y)[3]) / L * off], R.cuello.x + R.cuello.w * j / nR, R.cuello.y + R.cuello.h * vv, wTronco(y, th), 'cuello', 'k')); } return o; };
        const fila = (fr, off, vv) => filaY(th => cuelloTunica(th) - grueso(th) * fr, off, vv);
        const rc = filaY(camisola, 0.0052, 0), r0 = fila(-0.12, 0.0056, 0.44), r1 = fila(0.5, 0.0074, 0.72), r2 = fila(1.08, 0.0036, 1); bridge(rc, r0); bridge(r0, r1); bridge(r1, r2);
      }
      // Cinturón: una cinta sobre la cintura
      const nC = 20 * det, yc = [d.cintura + 0.014, d.cintura - 0.002, d.cintura - 0.014]; let pc = null;
      yc.forEach((y, n) => {
        const ring = [];
        for (let j = 0; j <= nC; j++) { const th = -180 + 360 * j / nC, q = radioFalda(th, min(y, yTop)), L = hypot(q[0], q[2]) || 1, off = n === 1 ? 0.0165 : 0.012, sy = max(y, d.cintura - 0.05); ring.push(V([q[0] + q[0] / L * off, y, q[2] + q[2] / L * off], R.cinto.x + R.cinto.w * j / nC, R.cinto.y + R.cinto.h * n / 2, { spine: 0.5, body: 0.5 }, 'cinto', 'f2')); }
        if (pc) bridge(pc, ring); pc = ring;
      });
      if (tiene('delantal')) for (const sg of [1, -1]) {   // lazada: dos cabos que caen por detrás
        let pr = null;
        for (let i = 0; i <= 3; i++) {
          const k = i / 3, y = d.cintura - 0.012 - k * 0.24, th = sg * (172 - k * 6), q = radioFalda(th, y), L = hypot(q[0], q[2]) || 1, off = 0.013 + 0.004 * k, cx = sg * (0.008 + 0.012 * k), ring = [];
          for (const dx of [-0.011, 0.011]) ring.push(V([q[0] + q[0] / L * off + cx + dx, y, q[2] + q[2] / L * off], R.delantal.x + R.delantal.w * (dx < 0 ? 0.1 : 0.2), R.delantal.y + R.delantal.h * k * 0.4, skinF(th, y), 'delantal', 'f2'));
          if (pr) bridge(pr, ring, [0, 0, -1]); pr = ring;
        }
      }
    }
    if (tiene('camisa')) {
      // Cuello doblado: sigue el borde de la uve y detrás rodea el cuello. La vuelta cae sobre el hombro y el pecho (unos 100 triángulos)
      const angs = dobla([0, 4, 8, 12, 17, 22, 30, 42, 58, 80, 105, 130, 155, 180], det), todos = angs.slice().reverse().map(a => -a).concat(angs.slice(1));
      const anchoV = a => lerp(0.0065, 0.012, sm(10, 30, a));
      const fila = (fr, off, vv) => todos.map((th, j) => { const a = abs(th), y = cuelloCam(th) - anchoV(a) * fr, q = PT(th, y), sy = sec(y)[3], L = hypot(q[0], q[2] - sy) || 1; return V([q[0] + q[0] / L * off, y + off * 0.25, q[2] + (q[2] - sy) / L * off], R.cuello.x + R.cuello.w * j / (todos.length - 1), R.cuello.y + R.cuello.h * vv, wTronco(y, th), 'cuello', 'k'); });
      const r0 = fila(-0.05, 0.0016, 0), r1 = fila(0.4, 0.0056, 0.4), r2 = fila(1.05, 0.0036, 1); bridge(r0, r1); bridge(r1, r2);
    }

    if (tiene('chaleco')) {
      const filaC = (fn, n, off, vv, gr) => { const o = []; for (let i = 0; i <= n; i++) { const [th, y] = fn(i / n), q = PT(th, y), sy = sec(y)[3], L = hypot(q[0], q[2] - sy) || 1; o.push(V([q[0] + q[0] / L * off, y + off * 0.25, q[2] + (q[2] - sy) / L * off], R.cinto.x + R.cinto.w * i / n, R.cinto.y + R.cinto.h * vv, wTronco(y, th), gr, 'k')); } return o; };
      for (const sg of [1, -1]) {
        // Borde de la uve
        const n = 7 * det, vee = dl => t => { const a = lerp(0.2, aVt, t); return [sg * (a + dl), topeCh(a)]; }, gr = 'cintaV' + sg;
        const a = filaC(vee(-1.6), n, 0.0012, 0, gr), b = filaC(vee(0.1), n, 0.0044, 0.5, gr), c = filaC(vee(1.8), n, 0.0022, 1, gr);
        bridge(a, b, [0, 0, 1]); bridge(b, c, [0, 0, 1]);
        // Sisa
        const nS = 13 * det, oval = kk => t => { const f = 2 * PI * t; return [sg * (90 + sisa.rt * kk * pw(cos(f), 0.55)), sisa.yc + sisa.ry * kk * pw(sin(f), 0.55)]; }, grS = 'cintaS' + sg;
        const s0 = filaC(oval(0.97), nS, 0.0012, 0, grS), s1 = filaC(oval(1.01), nS, 0.004, 0.5, grS), s2 = filaC(oval(1.06), nS, 0.002, 1, grS);
        bridge(s0, s1, [sg, 0, 0]); bridge(s1, s2, [sg, 0, 0]);
      }
    }

    // ------------------------------------------------------------ pelo: casquete que sigue el cráneo y mechones de punta irregular
    const rngP = LOOK.rng(look.semilla || 7);
    const estilos = {
      corto: {
        hl: curva1([[0, 0.785], [22, 0.782], [38, 0.755], [50, 0.71], [62, 0.665], [72, 0.625], [79, 0.585], [84, 0.52], [87, 0.45], [90, 0.45], [94, 0.60], [108, 0.54], [125, 0.43], [150, 0.31], [180, 0.255]]),
        hlC: curva1([[0, 0.80], [22, 0.797], [38, 0.77], [50, 0.732], [62, 0.69], [72, 0.655], [84, 0.635], [94, 0.625], [108, 0.565], [125, 0.47], [150, 0.36], [180, 0.305]]),
        grosor: (a, s) => lerp(0.0145, 0.0165, sm(0, 0.28, s)) * lerp(1, 0.3, sm(0.3, 0.86, s)) * lerp(1, 0.58, sm(42, 88, a) * sm(0.14, 0.5, s)), jag: 0,
      },
      trenza: {
        hl: curva1([[0, 0.775], [14, 0.77], [30, 0.745], [48, 0.69], [64, 0.63], [78, 0.585], [90, 0.565], [100, 0.545], [115, 0.44], [135, 0.34], [160, 0.28], [180, 0.255]]),
        grosor: (a, s) => lerp(0.0175, 0.0125, sm(0.2, 0.8, s)) * (1 - 0.22 * G(a, 5) * sm(0.95, 0.3, s)) * lerp(1, 0.56, G(a - 92, 38) * sm(0.1, 0.45, s)) + 0.005 * sm(120, 170, a) * sm(0.4, 0.9, s), jag: 0,
      },
      // Pañuelo: tapa las orejas y se ata en la nuca
      panuelo: {
        hl: curva1([[0, 0.735], [20, 0.73], [40, 0.695], [58, 0.62], [72, 0.50], [88, 0.355], [110, 0.275], [140, 0.215], [180, 0.195]]),
        grosor: (a, s) => 0.0125 + 0.004 * G(a - 90, 36) * sm(0.3, 0.8, s) + 0.003 * sm(120, 170, a), jag: 0,
      },
    };
    estilos.mono = estilos.trenza;
    if (look.edad === 'mayor') { const h0 = estilos.corto.hl, h1 = estilos.corto.hlC, ent = a => 0.055 * G(a - 36, 15) + 0.02 * G(a, 22); estilos.corto.hl = a => h0(a) + ent(a); estilos.corto.hlC = a => h1(a) + ent(a); }
    if (peinado) estilos[look.hairStyle] = peinado.forma({ curva1, look, m });
    const est = estilos[look.hairStyle];
    if (est && !est.hlC) est.hlC = a => est.hl(a) + 0.012;
    const idxPelo0 = idx.length;
    if (peinado) peinado.malla({ V, bridge, fan, pv, oscV, idx, PH, PM, P, sec, padT, dirCraneo, yH, chin, H, zCab, d, m, det, R, rng: rngP, est, look, jx, jy });
    else if (est) {
      const hairW = { head: 1 };
      // Casquete
      const nT = det > 1 ? 48 : 32, nS = 6 * det;
      const lump = (th, s) => (LOOK.fbm2((th + 180) / 36, s * 3.1 + 3.3, 2, 10, 0) - 0.5) * 0.012 * sm(0.02, 0.25, s) * sm(0.95, 0.6, s) * (m ? 1 : 0.42);
      const qApice = vadd(PH(0, 0.9995), [0, est.grosor(0, 0), 0]), nApice = dirCraneo(0, 0.995);
      let prev = null;
      for (let i = 1; i <= nS; i++) {
        const s = i / nS, ring = [];
        for (let j = 0; j <= nT; j++) {
          const th = -180 + 360 * j / nT, a = abs(th), jag = i === nS ? (j % 2 ? est.jag : -est.jag) * (1 + rngP() * 0.5) : 0;
          const ed = est.hlC(a) - jag, h = lerp(0.992, ed, pow(s, 1.6));
          const n = dirCraneo(th, h), t = i === nS ? 0.0012 : max(0.0015, est.grosor(a, s) * (1 - pow(s, 3.2)) + lump(th, s)), kq = sm(0.86, 0.95, h);
          const q = vadd(kq < 1 ? vlerp(PM(th, h), PH(th, h), kq) : PH(th, h), vmul(n, t));
          ring.push(V(q, R.casco.x + R.casco.w * j / nT, R.casco.y + R.casco.h * s, hairW, 'pelo', 'h'));
        }
        if (prev) bridge(prev, ring);
        else { const tapa = []; for (let j = 0; j <= nT; j++) tapa.push(V(qApice, R.casco.x + R.casco.w * j / nT, R.casco.y + 1, hairW, 'pelo', 'h')); bridge(tapa, ring, [0, 1, 0]); }
        prev = ring;
      }
      // Mechones: prisma plano con cresta; en el retrato, más estaciones
      const mechon = (th0, h0, th1, h1, o = {}) => {
        const n = (o.n || 3) * det, w0 = o.w || 0.012, lift = o.lift === undefined ? 0.006 : o.lift, u0 = rngP() * 0.7, base = o.base === undefined ? 1 : o.base, curv = o.curv || 0, punta = o.punta || 0, hunde = o.hunde || 0;
        let pr = null;
        for (let i = 0; i <= n; i++) {
          const k = i / n, th = lerp(th0, th1, k) + curv * sin(PI * k), a = abs(th), h = o.sobre ? max(lerp(h0, h1, k), est.hlC(a) + o.sobre) : lerp(h0, h1, k), s = clamp((0.992 - h) / (0.992 - est.hlC(a)));
          const s2 = (0.992 - h) / (0.992 - est.hlC(a)), dir = dirCraneo(th, h), tb = est.grosor(a, min(s, 0.95)) * base * (1 - pow(min(s2, 1), 3.2)) * sm(1.12, 0.9, s2) + 0.0018 + lift * sin(PI * pow(k, 0.7)) - 0.006 * sm(0.3, 0, k) - (o.raiz || 0) * sm(0.8, 0.35, k) - hunde * sm(0.68, 1, k);
          const c = vadd(PH(th, h), vmul(dir, tb));
          const k2 = min(1, k + 0.05), th2 = lerp(th0, th1, k2) + curv * sin(PI * k2), c2 = vadd(PH(th2, o.sobre ? max(lerp(h0, h1, k2), est.hlC(abs(th2)) + o.sobre) : lerp(h0, h1, k2)), vmul(dir, tb));
          const flow = vnorm(vsub(c2, c)), lado = vnorm(vcross(flow, dir));
          const w = w0 * (k < 0.25 ? lerp(0.28, 1, k / 0.25) : max(punta, sqrt(max(0.0, 1 - pow((k - 0.25) / 0.75, 2.2)))));
          const a0 = vadd(c, vadd(vmul(lado, -w), vmul(dir, -0.0035))), a1 = vadd(vadd(c, vmul(dir, 0.0022)), vmul(flow, punta && k >= 1 ? w * 0.75 : 0)), a2 = vadd(c, vadd(vmul(lado, w), vmul(dir, -0.0035)));
          const vy = R.mechon.y + R.mechon.h * k, x0 = R.mechon.x + R.mechon.w * u0, wu = R.mechon.w * 0.28;
          const ring = [V(a0, x0, vy, hairW, 'mech', 'h', vnorm(vadd(dir, vmul(lado, -0.3)))), V(a1, x0 + wu * 0.5, vy, hairW, 'mech', 'h', dir), V(a2, x0 + wu, vy, hairW, 'mech', 'h', vnorm(vadd(dir, vmul(lado, 0.3))))];
          oscV[ring[0]] = oscV[ring[2]] = lerp(lerp(0.98, 0.86, sm(0, 0.4, k)), 0.94, sm(95, 130, a)); oscV[ring[1]] = 1;
          if (pr) {
            const sumaN = vcross(vsub(pv(ring[1]), pv(pr[0])), vsub(pv(pr[1]), pv(pr[0])));
            if (vdot(sumaN, dir) > 0) idx.push(pr[0], ring[1], pr[1], pr[0], ring[0], ring[1], pr[1], ring[2], pr[2], pr[1], ring[1], ring[2]);
            else idx.push(pr[0], pr[1], ring[1], pr[0], ring[1], ring[0], pr[1], pr[2], ring[2], pr[1], ring[2], ring[1]);
          }
          pr = ring;
        }
      };
      if (look.hairStyle === 'corto') {
        // Corte corto de pueblo: mechones anchos y de punta roma, barridos hacia un lado. Nada de dientes de sierra ni copete en punta
        if (det > 1 && !look.sombrero) for (let i = 0; i < 9; i++) {
          const t = -54 + i * 13.5 + (rngP() - 0.5) * 4, hE2 = est.hlC(abs(t));
          mechon(t - 13, min(0.93, hE2 + 0.135 + rngP() * 0.03), t + 6 + rngP() * 4, hE2 + 0.004 + rngP() * 0.012, { w: 0.0145 + rngP() * 0.003, lift: 0.0012, n: 2, punta: 0.7, hunde: 0.004 });
        }
        if (det > 1 && !look.sombrero) for (let i = 0; i < 7; i++) {
          const t = -58 + i * 19 + (rngP() - 0.5) * 6, hE2 = est.hlC(abs(t));
          mechon(t - 15, min(0.93, hE2 + 0.21 + rngP() * 0.03), t + 5, hE2 + 0.055 + rngP() * 0.03, { w: 0.0155, lift: 0.0008, n: 2, punta: 0.45, hunde: 0.003, base: 0.86 });
        }
        if (det > 1) for (const sg of [1, -1]) {
          for (let i = 0; i < 5; i++) { const t = sg * (116 + i * 13 + rngP() * 5), hE2 = est.hlC(abs(t)); mechon(t - sg * 3, hE2 + 0.09, t + sg * 3, hE2 + 0.006 + rngP() * 0.006, { w: 0.015, lift: 0.0004, n: 2, raiz: 0.005, punta: 0.8, hunde: 0.003 }); }
        }
      } else if (look.hairStyle !== 'panuelo') {
        // Raya en medio: el pelo sale de la raya y va, tirante, hacia detrás de la oreja y la nuca. Los finales se hunden en el casquete, sin dientes
        for (const sg of [1, -1]) {
          if (det > 1) { const nM = 7; for (let i = 3; i < nM; i++) { const k = i / (nM - 1); mechon(sg * 7, lerp(est.hl(0) + 0.006, 0.975, k), sg * lerp(112, 168, k), lerp(0.535, 0.36, k), { w: 0.0125, lift: 0.0014, n: det > 1 ? 4 : 2, curv: sg * lerp(-9, -3, k), hunde: 0.004, sobre: 0.068, base: 0.86 }); } }
          if (det > 1) for (let i = 0; i < 2; i++) { mechon(sg * (168 + i * 6), 0.96, sg * (175 + i * 2), 0.33 + i * 0.015, { w: 0.012, lift: 0.0006, n: 4, hunde: 0.004 }); }
        }
      }
      if (look.hairStyle === 'trenza') {
        const yn = yH(0.40), L = (look.largoTrenza || 0.45) + 0.02, nR = 13 * det, nL = 6 * (det > 1 ? 2 : 1), base = PH(180, 0.36);
        const zEspalda = y => { const q = P(180, clamp(y, d.yP, chin), padT(y, 180)); return q[2] - 0.015; };
        let pr = null;
        for (let i = 0; i <= nR; i++) {
          const k = i / nR, y = yn - k * L, lob = i % 2 ? 1 : -1, ky2 = det > 1 ? (i % 4 < 2 ? 1 : -1) : lob, rr = lerp(0.0225, 0.0105, pow(k, 0.8)) * (1 + 0.09 * ky2) * (k > 0.93 ? 0.72 : 1) * lerp(0.5, 1, sm(0, 0.09, k)), rt = rr * 1.2;
          const z = k < 0.22 ? lerp(base[2] + 0.016, zEspalda(y), sm(0, 0.22, k)) : zEspalda(y), cx = ky2 * 0.0034 * sm(0, 0.12, k), wN = sm(0.05, 0.28, k), w2 = sm(0.28, 0.62, k);
          const ring = [];
          for (let j = 0; j <= nL; j++) { const f = 2 * PI * j / nL; ring.push(V([cx + cos(f) * rt, y + sin(f) * 0.002, z + sin(f) * rr], R.trenza.x + R.trenza.w * j / nL, R.trenza.y + R.trenza.h * k * 0.94, { neck: (1 - wN) * 0.3, head: (1 - wN) * 0.7, torso: wN * (1 - w2), braid: wN * w2 }, 'trenza', 'h')); }
          if (pr) bridge(pr, ring); pr = ring;
        }
        // Atado y punta
        const yf = yn - L, zf = zEspalda(yf), pf = []; for (let j = 0; j <= nL; j++) { const f = 2 * PI * j / nL; pf.push(V([cos(f) * 0.014, yf - 0.03, zf + sin(f) * 0.011], R.trenza.x + R.trenza.w * j / nL, R.trenza.y + R.trenza.h * 0.97, { braid: 1 }, 'trenza', 'h')); }
        bridge(pr, pf); fan(pf, V([0, yf - 0.055, zf], R.trenza.x + R.trenza.w / 2, R.trenza.y + R.trenza.h - 1, { braid: 1 }, 'trenza', 'h'));
      } else if (look.hairStyle === 'mono' || look.hairStyle === 'panuelo') {
        const kNu = look.hairStyle === 'panuelo' ? 0.56 : 1, c = vadd(PH(180, look.hairStyle === 'panuelo' ? 0.26 : 0.34), [0, 0, -0.024]), nA = 9 * det, nF = 6 * det, ap = V(vadd(c, [0, 0.036 * kNu, 0]), R.mono.x + R.mono.w / 2, R.mono.y + 1, { head: 1 }, 'mono', 'h');
        let pr = null;
        for (let i = 1; i <= nF; i++) {
          const v = i / nF, ph = PI * v, ring = [];
          for (let j = 0; j <= nA; j++) { const f = 2 * PI * j / nA, ru = 1 + 0.1 * sin(f * 3 + v * 4) + 0.06 * sin(f * 5 + 1), rr = 0.041 * ru * kNu; ring.push(V(vadd(c, [cos(f) * sin(ph) * rr, cos(ph) * 0.036 * kNu, sin(f) * sin(ph) * rr * 0.8]), R.mono.x + R.mono.w * j / nA, R.mono.y + R.mono.h * v, { head: 1 }, 'mono', 'h')); }
          if (pr) bridge(pr, ring); else fan(ring, ap);
          pr = ring;
        }
      }
    }

    const trisPelo = (idx.length - idxPelo0) / 3;

    // ------------------------------------------------------------ sombrero de paja o boina: una silueta propia a la cámara del juego (unos 150 triángulos)
    if (look.sombrero) {
      const paja = look.sombrero === 'paja', rH = look.hairStyle === 'trenza' ? R.mono : R.trenza, nS = 14 * det, y0 = yH(0.70), zC = zCab - 0.004, rx0 = 0.372 * H, rz0 = 0.465 * H, inc = rad(-6), wH = { head: 1 };
      const filasS = paja
        ? [[1.02, -0.003], [1.66, -0.026], [1.40, 0.002], [1.04, 0.012], [1.0, 0.072], [0.84, 0.108]]
        : [[1.0, -0.006], [1.03, 0.006], [1.17, 0.042], [1.12, 0.078], [0.62, 0.100]];
      const anillos = filasS.map(([k, dy], iR) => { const o = []; for (let j = 0; j <= nS; j++) { const f = 2 * PI * j / nS, x = sin(f) * rx0 * k, z = cos(f) * rz0 * k; o.push(V([x, y0 + dy * cos(inc) + z * sin(-inc) * 0.6, zC + z], rH.x + rH.w * j / nS, rH.y + rH.h * iR / filasS.length, wH, 'sombrero', 'h')); } return o; });
      for (let i = 0; i < anillos.length - 1; i++) {
        const ref = paja ? (i === 0 ? [0, -1, 0] : i <= 2 ? [0, 1, 0] : null) : (i === 0 ? null : null);
        bridge(anillos[i], anillos[i + 1], ref || undefined);
      }
      const tp = filasS[filasS.length - 1];
      fan(anillos[anillos.length - 1], V([0, y0 + (tp[1] + 0.006), zC], rH.x + rH.w / 2, rH.y + rH.h - 1, wH, 'sombrero', 'h'), [0, 1, 0]);
    }

    // ------------------------------------------------------------ normales soldadas y contacto horneado
    const nV = pos.length / 3, nor = new Float32Array(nV * 3);
    {
      const clave = i => grp[i] + '|' + Math.round(pos[i * 3] * 5000) + '|' + Math.round(pos[i * 3 + 1] * 5000) + '|' + Math.round(pos[i * 3 + 2] * 5000);
      const suma = new Map();
      const keys = new Array(nV);
      for (let i = 0; i < nV; i++) { keys[i] = clave(i); if (!suma.has(keys[i])) suma.set(keys[i], [0, 0, 0]); }
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2], n = vcross(vsub(pv(b), pv(a)), vsub(pv(c), pv(a)));
        for (const i of [a, b, c]) { const s = suma.get(keys[i]); s[0] += n[0]; s[1] += n[1]; s[2] += n[2]; }
      }
      for (let i = 0; i < nV; i++) { const n = fixN[i] || vnorm(suma.get(keys[i])); nor[i * 3] = n[0]; nor[i * 3 + 1] = n[1]; nor[i * 3 + 2] = n[2]; }
      for (const q of pegados) {
        let r = 0; while (r < filasH.length - 2 && filasH[r + 1] < q.h) r++;
        const a = abs(q.th); let j = 0; while (j < HTa.length - 2 && HTa[j + 1] < a) j++;
        const u = clamp((q.h - filasH[r]) / (filasH[r + 1] - filasH[r])), v = clamp((a - HTa[j]) / (HTa[j + 1] - HTa[j]));
        const Nn = (rr, jj) => { const iv = vC[(iCosturaCuello + rr) * 1000 + (q.th < 0 ? hc - jj : hc + jj)]; return [nor[iv * 3], nor[iv * 3 + 1], nor[iv * 3 + 2]]; };
        const n = vnorm(vlerp(vlerp(Nn(r, j), Nn(r, j + 1), v), vlerp(Nn(r + 1, j), Nn(r + 1, j + 1), v), u));
        nor[q.i * 3] = n[0]; nor[q.i * 3 + 1] = n[1]; nor[q.i * 3 + 2] = n[2];
      }
    }
    const esf = [];
    const pon = (x, y, z, r, t) => esf.push({ p: [x, y, z], r, t });
    pon(0, d.cadera, 0, 0.14 * bw, 't'); pon(0, d.cintura, 0.004, 0.115 * bw, 't'); pon(0, d.ya + 0.02, 0, 0.13 * bw, 't'); pon(0, yH(0.5), zCab, H * 0.42, 'c');
    for (const sg of [1, -1]) {
      const T = sg > 0 ? 'bL' : 'bR', Q = sg > 0 ? 'pL' : 'pR';
      pon(sg * lerp(jx, cod[0], 0.45), lerp(jy, cod[1], 0.45), -0.003, 0.046 * kA, T); pon(sg * cod[0], cod[1], cod[2], 0.038 * kA, T); pon(sg * lerp(cod[0], mun[0], 0.5), lerp(cod[1], mun[1], 0.5), 0, 0.034 * kA, T); pon(sg * mun[0], mun[1] - 0.06, 0.01, 0.03 * kA, T);
      pon(sg * 0.09, d.cadera - 0.14, 0, 0.082, Q); pon(sg * 0.088, lerp(d.cadera, d.rodilla, 0.65), 0.003, 0.066, Q); pon(sg * kn[0], d.rodilla, 0.006, 0.05, Q); pon(sg * 0.084, lerp(d.rodilla, 0.085, 0.4), -0.005, 0.05, Q); pon(sg * tob[0], 0.05, 0.05, 0.05, Q);
    }
    if (hayFalda) { for (const y of [0.78, 0.6, 0.42]) pon(0, y * ky, 0, 0.19, 'f'); }
    const col = new Float32Array(nV * 3), aoV = new Float32Array(nV), porPos = new Map();
    const hombroBajo = cod[1] + 0.13;
    for (let i = 0; i < nV; i++) {
      const p = pv(i), n = [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]], T = tag[i]; let o = 0;
      if (T !== 'H') for (const e of esf) {
        let peso = 1;
        if (T === 'c' && e.t === 't') continue;
        if (T === 'c' && e.t === 'c') { peso = 0.13 * sm(yH(0.12), yH(0.0), p[1]); if (peso <= 0) continue; }
        else if (T === 't' && e.t === 'c') peso = 0.15;
        else if (e.t === T || (T === 'k' && e.t === 't') || (T === 'h' && e.t === 'c') || ((T === 'f' || T === 'f2') && e.t !== 'bL' && e.t !== 'bR')) continue;
        // Arranque de piernas y brazos: la pelvis y el pecho no les hacen sombra (es la misma piel)
        if (e.t === 't' && (T === 'pL' || T === 'pR') && p[1] > d.yP - 0.14) continue;
        if (T === 't' && (e.t === 'pL' || e.t === 'pR') && p[1] > d.yP - 0.02 && e.p[1] > d.rodilla + 0.1 && abs(p[0]) > 0.04) continue;
        if (e.t === 't' && (T === 'bL' || T === 'bR') && p[1] > hombroBajo) continue;
        const D = vsub(e.p, p), dl = vlen(D) || 1e-4, nd = vdot(n, D) / dl;
        o += peso * (dl < e.r ? 0.9 : max(0, nd * 0.85 + 0.15) * e.r * e.r / (dl * dl));
      }
      aoV[i] = 1 - min(0.68, o * 0.62); if (grp[i] === 'dedo') aoV[i] = max(aoV[i], 0.88);
      const k = Math.round(p[0] * 5000) + '|' + Math.round(p[1] * 5000) + '|' + Math.round(p[2] * 5000) + '|' + grp[i];
      const lista = porPos.get(k); if (lista) lista.push(i); else porPos.set(k, [i]);
    }
    for (const lista of porPos.values()) { if (lista.length < 2) continue; let a = 0; for (const i of lista) a += aoV[i]; a /= lista.length; for (const i of lista) aoV[i] = a; }
    for (let i = 0; i < nV; i++) {
      const c = aoV[i] * (oscV[i] || 1);
      if (grp[i] === 'faldaIn') { col[i * 3] = 0.14; col[i * 3 + 1] = 0.13; col[i * 3 + 2] = 0.12; continue; }
      let r1 = c, g1 = c * c * 0.25 + c * 0.75, b1 = c * c * 0.4 + c * 0.6;   // el contacto tira a cálido
      if ((grp[i] === 'piel' || grp[i] === 'nariz' || grp[i].startsWith('parpado')) && pos[i * 3 + 1] > chin - 0.17 * H) {
        const h = (pos[i * 3 + 1] - chin) / H, a = Math.atan2(abs(pos[i * 3]), pos[i * 3 + 2] - zCab) * 180 / PI;
        const rub = G(a - 37, 16) * G(h - 0.36, 0.07) * (m ? 0.85 : 1), kCu = sm(-0.17, -0.03, h), lado = sm(44, 86, a) * sm(0.75, 0.55, h) * kCu, sien = G(a - 60, 15) * G(h - 0.63, 0.09), man = sm(0.2, 0.06, h) * sm(10, 40, a) * kCu, hJ = -0.03 + 0.00217 * min(a, 95), bajoM = sm(hJ + 0.012, hJ - 0.05, h) * sm(-0.17, -0.06, h) * sm(135, 105, a);
        const barba = m ? sm(0.3, 0.2, h) * sm(-0.02, 0.06, h) * sm(96, 70, a) : 0, v = (1 - 0.2 * lado) * (1 - 0.12 * sien) * (1 - 0.05 * man) * (1 - 0.04 * bajoM);
        const kr = m ? 1 : 1.25; const kReb = sm(0.3, 0.8, -nor[i * 3 + 1]) * sm(0.2, 0.05, h), rebR = 1 + 0.45 * kReb, rebG = 1 + 0.6 * kReb, rebB = 1 + 0.7 * kReb;   // la luz que rebota del suelo aclara el plano bajo la barbilla: sin esto se lee como suciedad
        r1 *= v * rebR * (1 - 0.02 * barba); g1 *= v * rebG * 0.985 * (1 - 0.018 * kr * rub) * (1 - 0.035 * barba) * (1 - 0.015 * bajoM); b1 *= v * rebB * 0.96 * (1 - 0.026 * kr * rub) * (1 - 0.03 * barba) * (1 - 0.03 * bajoM);
      }
      col[i * 3] = r1; col[i * 3 + 1] = g1; col[i * 3 + 2] = b1;
    }

    // ------------------------------------------------------------ malla y esqueleto
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    {
      const aM = new Float32Array(nV * 3), yFinM = prendaManga ? jy - finManga * largoB : 9, ySk = yH(-0.17), cuero = tiene('botas') || tiene('zapatos'), piernaDesnuda = !tiene('pantalon') && !tiene('medias') && !hayFalda;
      for (let i = 0; i < nV; i++) {
        const gi = grp[i], T = tag[i], y = pos[i * 3 + 1]; let r = 0.92, sk = 0;
        if (gi === 'piel') {
          if (T === 'c' || (T === 't' && y > ySk)) { sk = 1; const h = (y - chin) / H, a = Math.atan2(abs(pos[i * 3]), pos[i * 3 + 2] - zCab) * 180 / PI; r = 0.69 - 0.08 * G(a, 32) * G(h - 0.64, 0.17) - 0.04 * G(a - 30, 30) * G(h - 0.42, 0.14); }
          else if ((T === 'bL' || T === 'bR') && y < yFinM) { sk = 1; r = 0.66; }
          else if ((T === 'pL' || T === 'pR') && y < (botaAlta ? yHem : 0.1) && cuero) r = 0.64;
          else if ((T === 'pL' || T === 'pR') && piernaDesnuda) { sk = 1; r = 0.66; }
        } else if (gi === 'nariz') { sk = 1; r = 0.56; }
        else if (gi === 'dedo' || gi.startsWith('parpado') || gi.startsWith('oreja')) { sk = 1; r = 0.66; }
        else if (gi.startsWith('ojo')) r = 0.2;
        else if (gi === 'pelo' || gi === 'mech' || gi === 'trenza' || gi === 'mono') r = look.hairStyle === 'panuelo' ? 0.92 : gi === 'mech' ? 0.72 : 0.66;
        aM[i * 3] = r; aM[i * 3 + 1] = sk; aM[i * 3 + 2] = (gi === 'pelo' || gi === 'mech' || gi === 'trenza' || gi === 'mono') && look.hairStyle !== 'panuelo' ? 1 : 0;
      }
      geo.setAttribute('aPiel', new THREE.BufferAttribute(aM, 3));
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sI, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, d.alto / 2, 0), 1.3);

    const huesos = [], porNombre = {};
    defs.forEach(b => { const h = new THREE.Bone(); h.name = b.nombre; huesos.push(h); porNombre[b.nombre] = h; });
    defs.forEach(b => { const h = porNombre[b.nombre]; if (b.padre) { const pa = defs.find(o => o.nombre === b.padre); h.position.set(b.p[0] - pa.p[0], b.p[1] - pa.p[1], b.p[2] - pa.p[2]); porNombre[b.padre].add(h); } else h.position.set(b.p[0], b.p[1], b.p[2]); });

    // Un lienzo por look: se cachea (la propuesta pide además un límite y dispose al llevarlo al juego)
    const t0Atlas = performance.now(), claveAtlas = JSON.stringify([look, res, det > 1]), atlas = cacheAtlas[claveAtlas] || (cacheAtlas[claveAtlas] = pintaAtlas()), msLienzo = performance.now() - t0Atlas;
    const mapa = new THREE.CanvasTexture(atlas);
    mapa.colorSpace = THREE.SRGBColorSpace; mapa.anisotropy = 4; mapa.generateMipmaps = true; mapa.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({ map: mapa, vertexColors: true, roughness: 0.86, metalness: 0 });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aPiel; varying vec3 vPiel;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPiel = aPiel;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPiel;').replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPiel.x;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // La piel deja pasar algo de luz: la sombra es cálida, no gris, y donde la forma deja de mirar al sol tira a rojo
          float sk = vPiel.y;
          reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(1.12, 0.99, 0.9), sk);
          reflectedLight.directDiffuse += sk * diffuseColor.rgb * vec3(0.032, 0.008, 0.001) * lkLuz * smoothstep(-0.3, 0.0, lkNL) * (1.0 - smoothstep(0.0, 0.36, lkNL)) * lkKS0;
        }`);
      // Sombra propia de la piel: se apaga donde N·L es bajo; ahí ya oscurece Lambert y el mapa de sombra solo dibujaba una cuña dura
      const lfb = THREE.ShaderChunk.lights_fragment_begin, nG = lfb.includes('geometryNormal') ? 'geometryNormal' : 'geometry.normal';
      const lfb2 = lfb.replace(/getDirectionalLightInfo\([^;]*\);/, m0 => m0 + ` lkNL = dot( ${nG}, directLight.direction ); lkKS = mix( 1.0, smoothstep( 0.0, mix( 0.32, 0.45, vPiel.y ), lkNL ), max( vPiel.y, vPiel.z ) ); lkLuz = dot( directLight.color, vec3( 0.3333 ) ) / 3.14159;`);
      const smp = THREE.ShaderChunk.shadowmap_pars_fragment, smp2 = smp.includes('vec2 lkB') ? smp.replace('vec2 lkB', 'lkKS0 = shadow; shadow = mix( 1.0, shadow, lkKS ); vec2 lkB') : smp.replace('return shadow;', 'lkKS0 = shadow; return mix( 1.0, shadow, lkKS );');
      if (lfb2 === lfb || smp2 === smp) console.log('PIEL: no se pudo enganchar la sombra propia');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nfloat lkNL = 1.0; float lkKS = 1.0; float lkKS0 = 1.0; float lkLuz = 0.0;').replace('#include <lights_fragment_begin>', lfb2).replace('#include <shadowmap_pars_fragment>', smp2);
    };
    mat.customProgramCacheKey = () => 'persona-piel';
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.boundingSphere = geo.boundingSphere.clone();
    const root = new THREE.Group(); root.name = 'persona';
    root.add(mesh); mesh.add(huesos[0]);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(huesos));
    const tris = idx.length / 3;
    root.userData = { body: porNombre.body, torso: porNombre.torso, head: porNombre.head, legs: [porNombre.legL, porNombre.legR], shins: [porNombre.shinL, porNombre.shinR], arms: [porNombre.armL, porNombre.armR], fore: [porNombre.foreL, porNombre.foreR], skirt: porNombre.skirt, neck: porNombre.neck };

    // ------------------------------------------------------------ andar: tablas de 8 claves, fase ligada a la distancia
    const CL = {
      //       0 pisa talón ...................................... despegue ... vuelo
      andar: { hip: [19, 16, 7, -3, -10, -3, 14, 21], knee: [4, 13, 7, 4, 9, 34, 52, 20], ank: [3, -5, -1, 7, 8, -14, 2, 6], toe: [0, 0, 0, 2, 14, 24, 2, 0] },
      trote: { hip: [28, 22, 8, -8, -22, -8, 18, 31], knee: [12, 28, 16, 10, 22, 58, 84, 36], ank: [2, -8, 4, 8, -4, -22, 0, 4], toe: [0, 0, 0, 4, 20, 30, 2, 0] },
    };
    const cyc = (k, p) => { const n = k.length, x = ((p % 1) + 1) % 1 * n, i = floor(x), t = x - i, a = k[(i + n - 1) % n], b = k[i], c = k[(i + 1) % n], e = k[(i + 2) % n]; return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - e) * t * t + (3 * b - a - 3 * c + e) * t * t * t); };
    const L1 = d.cadera - d.rodilla, L2 = d.rodilla - tob[1], hA = tob[1], talon = -0.058 * kf, bola = 0.125 * kf, punta = 0.178 * kf;
    function piernaFK(hip, knee, ank, toe) {  // devuelve altura mínima bajo la cadera y z del punto de apoyo
      const a1 = rad(hip), a2 = rad(hip - knee), pitch = rad(hip - knee + ank), tb = rad(hip - knee + ank + toe);
      const z0 = L1 * sin(a1) + L2 * sin(a2), y0 = -L1 * cos(a1) - L2 * cos(a2);
      const yf = (z, y) => y0 + y * cos(pitch) + z * sin(pitch), zf = (z, y) => z0 - y * sin(pitch) + z * cos(pitch);
      const yT = yf(talon, -hA), yB = yf(bola, -hA), zB = zf(bola, -hA), yP = yB + (punta - bola) * sin(tb), zP = zB + (punta - bola) * cos(tb);
      let yMin = yT, zMin = zf(talon, -hA); if (yB < yMin) { yMin = yB; zMin = zB; } if (yP < yMin) { yMin = yP; zMin = zP; }
      return [yMin, zMin];
    }
    const zancada = g => {  // lo que recorre el tobillo mientras esa pierna apoya, llevado al ciclo entero
      const K = CL[g], zT = p => L1 * sin(rad(cyc(K.hip, p))) + L2 * sin(rad(cyc(K.hip, p) - cyc(K.knee, p)));
      return (zT(0.03) - zT(0.5)) / 0.47;
    };
    const ZA = zancada('andar'), ZT = zancada('trote');
    let fase = 0, mezcla = 0, pendulo = 0, velP = 0, tiempo = 0;
    // De pie nadie está en firmes: carga el peso en una pierna, afloja la otra y gira un poco la cabeza. Cambia con la semilla
    const QP = { s: vari.lado, giro: vari.giro * 26, incl: vari.incl * 9, brazo: vari.brazo, miraY: 0, miraX: 0 };
    const POST = look.postura && POSTURAS[look.postura], enc = look.encorvado || 0;
    if (POST) for (const S of ['L', 'R']) porNombre['arm' + S].rotation.order = 'ZYX';
    if (look.escala) root.scale.setScalar(look.escala);
    function pose(p, g, w) {  // p fase, g 0 andar 1 trote, w 0 quieto 1 en marcha
      const ky2 = (arr, ph) => lerp(cyc(CL.andar[arr], ph), cyc(CL.trote[arr], ph), g);
      const b = porNombre, tilt = lerp(rad(1.5), rad(5), g) * w, ss = sin(2 * PI * p), cc = cos(2 * PI * p), rs = 1 - w;
      const lado = (S, ph) => {
        const libre = (S === 'L') === (QP.s > 0), hipR = libre ? 7 : -1, kneeR = libre ? 15 : 2 + 6 * enc;
        const hip = ky2('hip', ph) * w + rs * hipR, knee = lerp(kneeR, ky2('knee', ph), w), ank = ky2('ank', ph) * w + rs * (kneeR - hipR), toe = ky2('toe', ph) * w;
        b['leg' + S].rotation.x = -rad(hip) - tilt; b['shin' + S].rotation.x = rad(knee); b['foot' + S].rotation.x = -rad(ank); b['toe' + S].rotation.x = -rad(toe);
        return piernaFK(hip, knee, ank, toe);
      };
      const A = lado('L', p), Bb = lado('R', p + 0.5);
      // Pies hacia el centro: ligera aducción, más al apoyar. En reposo la pelvis cae hacia la pierna libre
      const ad = rad(lerp(1.8, 1.0, g)) * w, cad = 0.04 * rs * QP.s;
      b.legL.rotation.z = -ad - cad; b.legR.rotation.z = ad - cad;
      const yaw = rad(m ? 6 : 7) * lerp(1, 1.3, g) * w, list = rad(m ? 1.6 : 3) * w, sway = (m ? 0.012 : 0.016) * w * (1 - 0.5 * g);
      const altura = -min(A[0], Bb[0]);
      const respira = (1 - w) * 0.002 * sin(tiempo * 1.5);
      b.body.position.set(sway * ss - 0.016 * rs * QP.s, altura + respira + 0.002 * (g * w), 0);
      b.body.rotation.set(tilt, -yaw * cc + rad(3) * rs * QP.s, list * ss + cad);
      b.spine.rotation.set(lerp(rad(1), rad(4), g) * w, yaw * cc * 0.8, -list * ss * 0.6 - cad * 1.1);
      b.torso.rotation.set(rad(0.5) * w, yaw * cc * 0.9 - rad(2) * rs * QP.s, -list * ss * 0.25 - cad * 0.5);
      // La cabeza va algo alta: desde la cámara del juego se ve más cara. Quieto, mira un poco a un lado
      b.neck.rotation.set(-tilt * 0.6 - rad(2), -yaw * cc * 0.5 + rad(QP.giro) * 0.4 * rs + rad(QP.miraY) * 0.4, rad(QP.incl) * 0.4 * rs);
      b.head.rotation.set(-lerp(rad(1), rad(4), g) * w - rad(3) + rad(QP.miraX), -yaw * cc * 0.2 + rad(QP.giro) * 0.6 * rs + rad(QP.miraY) * 0.6, list * ss * 0.2 + rad(QP.incl) * 0.6 * rs);
      const aA = lerp(m ? 14 : 11, m ? 24 : 20, g) * w, baseF = lerp(lerp(21, 18, w), 58, g * w), flexA = lerp(14, 12, g) * w;
      const abre = rad(hayFalda ? 2.2 : 1.2) + rad(4) * g * w + rad(3) * (look.panza || 0), bR = rs * QP.brazo;
      b.armL.rotation.set(rad(aA * cc) + bR * 0.12, 0, abre); b.armR.rotation.set(rad(-aA * cc) - bR * 0.12, 0, -abre);
      b.foreL.rotation.x = -rad(baseF + flexA * max(0, -cc) + bR * 14); b.foreR.rotation.x = -rad(baseF + flexA * max(0, cc) - bR * 14);
      b.handL.rotation.set(-rad(3) * w - rad(5) * rs, 0, 0); b.handR.rotation.set(-rad(3) * w - rad(5) * rs, 0, 0);
      b.clavL.rotation.set(rad(aA * cc * 0.12), 0, -list * ss * 0.2); b.clavR.rotation.set(rad(-aA * cc * 0.12), 0, -list * ss * 0.2);
      if (POST) {
        const kP = POST.fijo ? 1 : rs;
        for (const [S, sg] of [['L', 1], ['R', -1]]) {
          const q = POST[S]; if (!q || kP <= 0) continue;
          const A = b['arm' + S], F = b['fore' + S], Mn = b['hand' + S];
          A.rotation.set(lerp(A.rotation.x, rad(q.arm[0]), kP), lerp(A.rotation.y, sg * rad(q.arm[1]), kP), lerp(A.rotation.z, sg * rad(q.arm[2]), kP));
          F.rotation.x = lerp(F.rotation.x, rad(q.fore), kP);
          if (q.mano) Mn.rotation.set(rad(q.mano[0]) * kP, sg * rad(q.mano[1]) * kP, sg * rad(q.mano[2]) * kP);
        }
      }
      if (enc) {   // encorvado: la espalda se dobla, la cabeza se levanta para mirar al frente y los brazos siguen colgando
        b.spine.rotation.x += enc * rad(7); b.torso.rotation.x += enc * rad(10); b.neck.rotation.x -= enc * rad(8); b.head.rotation.x -= enc * rad(7);
        if (!POST) { b.armL.rotation.x -= enc * rad(15); b.armR.rotation.x -= enc * rad(15); }
      }
      b.skirt.rotation.x = 0.06 * w * lerp(1, 2, g) * sin(4 * PI * p + 1);
      if (b.braid) b.braid.rotation.set(w * (0.05 + 0.1 * g + 0.035 * sin(4 * PI * p + 0.8)), 0, 0.05 * w * sin(2 * PI * p + 0.7));
    }
    function update(dt, speed = 0) {
      tiempo += dt;
      const gT = sm(1.9, 3.0, speed), obj = clamp(speed / 0.5);
      mezcla += (obj - mezcla) * (1 - exp(-dt * 9));
      const paso = lerp(ZA, ZT, gT);
      fase = (fase + speed * dt / paso) % 1;
      pose(fase, gT, mezcla);
    }
    pose(0, 0, 0);

    return { root, update, pose: (p, g = 0, w = 1) => { mezcla = w; fase = p; pose(p, g, w); }, mirar: (y = 0, x = 0) => { QP.miraY = y; QP.miraX = x; QP.giro = 0; }, mesh, bones: porNombre, tris, atlas, look, d, zancadas: [ZA, ZT], msLienzo, trisPelo };

    // ============================================================ lienzo: piel, cara, interior, piernas, tronco, encima, pliegues, suciedad, pelo
    function pintaAtlas() {
      const s = res / 512;
      const atlasC = LOOK.rawCanvas(res, (g) => {
        g.setTransform(s, 0, 0, s, 0, 0);
        const piel = LOOK.mix(LOOK.sobrio(look.skin || '#e8b07a', 'piel'), '#70422a', 0.17), pelo = LOOK.sobrio(look.hair || '#3a2a20');
        const pielSom = LOOK.mix(piel, '#5a3a30', 0.46), pielRoj = LOOK.mix(piel, '#b8483a', 0.5), pielLuz = LOOK.mix(piel, '#ffe8d0', 0.26);
        const rn = LOOK.rng(look.semilla || 3);
        const relleno = (r, col, m0 = 3) => { g.fillStyle = col; g.fillRect(r.x - m0, r.y - m0, r.w + 2 * m0, r.h + 2 * m0); };
        const motivo = (k) => patron(k);
        const trama = (r, k, a) => { g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = a; g.fillStyle = g.createPattern(motivo(k), 'repeat'); g.fillRect(r.x, r.y, r.w, r.h); g.restore(); };
        const suave = (r, esc, modo, alfa, fn) => { const c = document.createElement('canvas'); c.width = ceil(r.w / esc * s); c.height = ceil(r.h / esc * s); const k = c.getContext('2d'); k.scale(s / esc, s / esc); k.translate(-r.x, -r.y); k.lineCap = 'round'; k.lineJoin = 'round'; fn(k); g.save(); g.globalCompositeOperation = modo; g.globalAlpha = alfa; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(c, r.x, r.y, r.w, r.h); g.restore(); };
        const curvaT = (k, pts, w, col) => { k.strokeStyle = col; k.lineWidth = w; k.beginPath(); k.moveTo(pts[0][0], pts[0][1]); if (pts.length === 3) k.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]); else for (let i = 1; i < pts.length; i++) k.lineTo(pts[i][0], pts[i][1]); k.stroke(); };

        // ---- 1. piel
        for (const k of ['cara', 'oreja', 'dedo', 'tronco', 'brazo', 'mano', 'pierna', 'pie']) relleno(R[k], piel);
        trama(R.cara, 'piel', 0.17); trama(R.tronco, 'piel', 0.04); trama(R.brazo, 'piel', 0.1); trama(R.pierna, 'piel', 0.1);

        // Hueco del cuello, clavículas y el arranque de los músculos del cuello: sombras blandas, sin detalle anatómico
        suave(R.tronco, 3, 'multiply', 0.2, k2 => { for (const sg of [1, -1]) curvaT(k2, [[TX(sg * 8), TY(d.yt - 0.006)], [TX(sg * 28), TY(d.yt - 0.012)], [TX(sg * 58), TY(d.yt + 0.002)]], 2.2, pielSom); });
        suave(R.tronco, 3, 'screen', 0.12, k2 => { for (const sg of [1, -1]) curvaT(k2, [[TX(sg * 8), TY(d.yt - 0.001)], [TX(sg * 28), TY(d.yt - 0.003)], [TX(sg * 56), TY(d.yt + 0.012)]], 2, pielLuz); });
        // ---- 2. cara
        const fp = (xn, h) => { const x = abs(xn) * H, th = thetaDeX(x, h) * (xn < 0 ? -1 : 1); return [CX(th), CY(h)]; };
        const kH = R.cara.h / (H_MAX - H_MIN);
        const blob = (xn, h, rxn, rhn, col, a) => {
          const [px, py] = fp(xn, h), sxp = abs(fp(xn + 0.02, h)[0] - fp(xn - 0.02, h)[0]) / 0.04 || kH, rx = rxn * sxp, ry = rhn * kH;
          g.save(); g.translate(px, py); g.scale(rx, ry); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.globalAlpha = a; g.fillStyle = gr; const c2 = col; const g2 = g.createRadialGradient(0, 0, 0, 0, 0, 1); const rgb = hexRgb(c2); g2.addColorStop(0, `rgba(${rgb},1)`); g2.addColorStop(0.55, `rgba(${rgb},0.55)`); g2.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = g2; g.fillRect(-1, -1, 2, 2); g.restore();
        };
        const dos = fn => { fn(1); fn(-1); };
        const poli = (pts, cerr = true) => { g.beginPath(); pts.forEach((p, i) => { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); if (cerr) g.closePath(); };
        const hE = d.hOjos;
        // Modelado de color: gente que vive al sol. Banda rojiza por nariz y mejillas, no dos círculos; luces pequeñas; los planos de sombra hacen la forma
        const hNar = hNarz, hB = hBoca, kRub = m ? 1 : 0.8;
        suave(R.cara, 3, 'multiply', 0.09, k2 => { for (let i = 0; i < 16; i++) { const q = fp((rn() - 0.5) * 0.5, 0.12 + rn() * 0.6), rr = (0.045 + 0.05 * rn()) * kH; k2.fillStyle = rn() < 0.5 ? pielRoj : LOOK.mix(piel, pielSom, 0.6); k2.globalAlpha = 0.2 + rn() * 0.3; k2.beginPath(); k2.ellipse(q[0], q[1], rr, rr * 0.8, 0, 0, 7); k2.fill(); } k2.globalAlpha = 1; });
        dos(k => blob(k * 0.17, 0.375, 0.14, 0.085, pielRoj, 0.13 * kRub));
        blob(0, 0.385, 0.11, 0.05, pielRoj, 0.1 * kRub); blob(0, hNar + 0.03, 0.045, 0.03, pielRoj, 0.28); blob(0, 0.085, 0.06, 0.03, pielRoj, 0.12);
        blob(0, 0.69, 0.16, 0.08, pielLuz, 0.12); blob(0, 0.44, 0.014, 0.06, pielLuz, 0.06); blob(0, 0.09, 0.04, 0.02, pielLuz, 0.12);
        dos(k => blob(k * 0.155, 0.415, 0.07, 0.05, pielLuz, 0.07));
        dos(k => {
          blob(k * 0.07, 0.535, 0.05, 0.036, pielSom, 0.24);                 // junto a la nariz, bajo la ceja
          blob(k * 0.135, 0.545, 0.085, 0.02, pielSom, 0.19);                // bajo la ceja
          blob(k * 0.125, hE - 0.05, 0.07, 0.016, pielSom, 0.24);            // ojera, poca
          blob(k * 0.21, 0.50, 0.04, 0.07, pielSom, 0.22);                   // fuera del ojo
          blob(k * 0.06, 0.445, 0.03, 0.075, pielSom, 0.09);               // lado del caballete
          blob(k * 0.066, 0.355, 0.02, 0.04, pielSom, 0.12);                // lado de la nariz, abajo
          blob(k * 0.16, 0.26, 0.07, 0.09, pielSom, m ? 0.1 : 0.06);        // bajo el pómulo
          blob(k * 0.235, 0.62, 0.06, 0.1, pielSom, 0.16);                   // sien
          blob(k * 0.225, 0.17, 0.06, 0.12, pielSom, m ? 0.2 : 0.14);        // plano de la mandíbula
        });
        blob(0, hNar - 0.038, 0.012, 0.024, pielSom, 0.26); blob(0, hNar - 0.018, 0.05, 0.013, pielSom, 0.26); blob(0, hNar - 0.036, 0.065, 0.022, pielSom, 0.14); blob(0, hB - 0.062, 0.05, 0.012, pielSom, 0.36);   // surco nasal, sombra de la nariz y bajo el labio
        // Sombra de barba: muy poca y bien repartida. Con look.barba, barba de verdad
        if (m && !look.barba) { const barbaT = LOOK.mix(piel, pelo, 0.42); blob(0, 0.12, 0.17, 0.09, barbaT, 0.07); blob(0, hNar - 0.05, 0.07, 0.016, barbaT, 0.07); dos(k => blob(k * 0.18, 0.2, 0.06, 0.08, barbaT, 0.06));
          if (res > 512) { g.fillStyle = LOOK.mix(pelo, piel, 0.2); for (let i = 0; i < 420; i++) { const sg = rn() < 0.5 ? -1 : 1, q = fp(sg * rn() * 0.24, 0.02 + rn() * 0.23); g.globalAlpha = 0.05 + rn() * 0.08; g.fillRect(q[0], q[1], 0.45, 0.45); } g.globalAlpha = 1; } }
        if (look.barba) {
          const colB = LOOK.mix(pelo, piel, 0.1), bordeB = [[-0.3, 0.47], [-0.27, 0.34], [-0.205, 0.27], [-0.125, hB + 0.022], [-0.09, hNar - 0.034], [-0.03, hNar - 0.028], [0.03, hNar - 0.028], [0.09, hNar - 0.034], [0.125, hB + 0.022], [0.205, 0.27], [0.27, 0.34], [0.3, 0.47], [0.33, 0.14], [0.2, 0.0], [0.0, -0.04], [-0.2, 0.0], [-0.33, 0.14]];
          suave(R.cara, 2.2, 'source-over', 0.86, k2 => { k2.fillStyle = colB; k2.beginPath(); bordeB.forEach((b0, i) => { const q = fp(b0[0], b0[1]); if (i) k2.lineTo(q[0], q[1]); else k2.moveTo(q[0], q[1]); }); k2.closePath(); k2.fill(); });
          g.lineCap = 'round'; for (let i = 0; i < 260; i++) { const xn = (rn() - 0.5) * 0.56, hh = rn() * 0.28, q0 = fp(xn, hh), q1 = fp(xn * 0.96, hh - 0.018 - rn() * 0.02); g.strokeStyle = rn() < 0.5 ? LOOK.mix(colB, '#e8dfd0', 0.3) : LOOK.mix(colB, '#100c08', 0.5); g.globalAlpha = 0.16 + rn() * 0.2; g.lineWidth = 0.4; g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.stroke(); } g.globalAlpha = 1;
        }
                if (look.edad === 'mayor') suave(R.cara, 2, 'multiply', 0.3, k2 => {   // la edad, en líneas muy blandas
          for (const [hF, ww] of [[0.655, 0.13], [0.695, 0.15]]) curvaT(k2, [fp(-ww, hF), fp(0, hF + 0.006), fp(ww, hF)], 1.1, pielSom);
          for (const sg of [1, -1]) { curvaT(k2, [fp(sg * 0.075, 0.31), fp(sg * 0.112, 0.25), fp(sg * 0.118, 0.195)], 1.5, pielSom); curvaT(k2, [fp(sg * 0.2, 0.495), fp(sg * 0.222, 0.485), fp(sg * 0.238, 0.47)], 0.9, pielSom); curvaT(k2, [fp(sg * 0.075, 0.445), fp(sg * 0.125, 0.425), fp(sg * 0.18, 0.445)], 1.2, pielSom); }
        });
        if (res > 512) for (let i = 0; i < 70; i++) { const sg = rn() < 0.5 ? -1 : 1, xn = sg * (0.02 + 0.2 * rn() * rn()), hh = 0.33 + 0.13 * rn(); blob(xn, hh, 0.0045 + rn() * 0.003, 0.004 + rn() * 0.003, pielSom, 0.025 + rn() * 0.04); }
        if (LJ) dos(k => { blob(k * 0.125, hE + 0.006, 0.1, 0.045, pielSom, 0.42); blob(k * 0.13, 0.556, 0.095, 0.024, pielSom, 0.26); });   // cuenca: a 20 px de cabeza es lo que dice «ojos»
        // Ojos, en altos de cabeza: 3,4 × 1,35 cm, un 5 % del alto. Nada de delineado: el párpado corta el iris arriba y la línea es oscura solo en las pestañas
        const ojo = (k) => {
          const { wE, hEs, hEi, cx, sup, inf, xo } = ojoG(k), borde = 22;
          const e = []; for (let i = 0; i <= borde; i++) e.push([xo(i / borde), sup(i / borde)]); for (let i = borde; i >= 0; i--) e.push([xo(i / borde), inf(i / borde)]);
          const pe = e.map(q => fp(q[0], q[1]));
          g.save(); poli(pe); g.fillStyle = LOOK.mix('#c8bfae', piel, 0.28); g.fill(); g.clip();
          const c0 = fp(cx + (look.mirada || 0) * 0.012, hE + (OJ ? OJ.cy : 0.0115)), gx = abs(fp(cx + 0.02, hE)[0] - fp(cx - 0.02, hE)[0]) / 0.04, rIr = OJ ? OJ.ir : 0.0057, rx = (rIr / H) * gx, ry = (rIr / H) * kH;
          const iris = LOOK.sobrio(look.ojos || '#5a4632'), oscuro = LOOK.mix(iris, '#141010', 0.6), claro = LOOK.mix(iris, '#d8c8a8', 0.1);
          g.fillStyle = oscuro; g.beginPath(); g.ellipse(c0[0], c0[1], rx, ry, 0, 0, 7); g.fill();
          const ig = g.createRadialGradient(c0[0], c0[1] + ry * 0.35, 0, c0[0], c0[1], rx * 0.9); ig.addColorStop(0, claro); ig.addColorStop(0.6, iris); ig.addColorStop(1, oscuro); g.fillStyle = ig; g.beginPath(); g.ellipse(c0[0], c0[1], rx * 0.88, ry * 0.88, 0, 0, 7); g.fill();
          g.fillStyle = '#17120f'; g.beginPath(); g.ellipse(c0[0], c0[1], rx * 0.4, ry * 0.4, 0, 0, 7); g.fill();
          // Sombra del párpado sobre el ojo, en dos pasos; rincones
          for (const [cae, al] of [[0.012, 0.3], [0.024, 0.2]]) { g.fillStyle = `rgba(60,38,28,${al})`; poli(e.slice(0, borde + 1).map(q => fp(q[0], q[1])).concat(e.slice(0, borde + 1).reverse().map(q => fp(q[0], q[1] - cae)))); g.fill(); }
          const ci = fp(xo(0.03), hE + 0.002), cf = fp(xo(0.97), hE + 0.008);
          g.fillStyle = 'rgba(176,104,90,0.55)'; g.beginPath(); g.ellipse(ci[0], ci[1], rx * 0.5, ry * 0.45, 0, 0, 7); g.fill();
          g.fillStyle = 'rgba(96,62,50,0.3)'; g.beginPath(); g.ellipse(cf[0], cf[1], rx * 0.6, ry * 0.5, 0, 0, 7); g.fill();
          g.fillStyle = 'rgba(245,240,230,0.28)'; g.beginPath(); g.ellipse(c0[0] - rx * 0.3, c0[1] - ry * 0.12, rx * 0.12, ry * 0.12, 0, 0, 7); g.fill();
          g.restore();
          // Pliegue y plano del párpado, y línea de pestañas de grueso variable
          blob(cx + k * 0.005, hE + 0.047, 0.05, 0.010, pielLuz, 0.14); if (OJ && OJ.pesado) blob(cx + k * 0.004, sup(0.5) + 0.012, 0.06, 0.012, pielSom, 0.3);
          const pl = []; for (let i = 2; i < borde; i++) { const t = i / borde; pl.push(fp(xo(t) + k * 0.012 * (t - 0.5), sup(t) + 0.019 + 0.005 * sin(PI * t))); }
          pliegues.push(pl);
          const oscL = LOOK.mix(LOOK.mix(pelo, '#2a1d16', 0.5 + 0.2 * LJ), piel, 0.22 - 0.14 * LJ), grLinea = t => (m ? 0.0058 : 0.0074) * (OJ ? OJ.linea : 1) * (1 + 0.9 * LJ) * pow(sin(PI * min(1, t * 1.02)), 0.55) * (0.55 + 0.75 * t), lin = [];
          for (let i = 0; i <= borde; i++) { const t = i / borde; lin.push(fp(xo(t), sup(t) + grLinea(t))); } for (let i = borde; i >= 0; i--) { const t = i / borde; lin.push(fp(xo(t), sup(t) - grLinea(t) * 0.3)); }
          g.fillStyle = oscL; poli(lin); g.fill();
          g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = OJ && OJ.bajo ? oscL : LOOK.mix(pielSom, piel, 0.35); g.globalAlpha = OJ && OJ.bajo ? 0.7 : 0.55; g.lineWidth = OJ && OJ.bajo ? 0.9 : 0.6; const bj = []; for (let i = 5; i <= borde; i++) { const t = i / borde; bj.push(fp(xo(t), inf(t) - 0.002)); } poli(bj, false); g.stroke(); g.globalAlpha = 1;
        };
        const pliegues = [];
        dos(ojo);
        suave(R.cara, 2, 'multiply', 0.3, k2 => { k2.strokeStyle = pielSom; k2.lineWidth = 1.3; for (const pl of pliegues) { k2.beginPath(); pl.forEach((q, i) => (i ? k2.lineTo(q[0], q[1]) : k2.moveTo(q[0], q[1]))); k2.stroke(); } });
        // Cejas: una mancha blanda y pelos finos que nacen hacia arriba junto a la nariz y se tumban hacia la cola
        const ceja = (k) => {
          const vPel = LOOK.hsv(pelo)[2], pelCeja = LOOK.mix(pelo, '#2a1e17', (vPel > 0.42 ? 0.42 : 0.14) + 0.12 * LJ), w = (CJ ? CJ.w : m ? 0.03 : 0.019) * (1 + 0.3 * LJ), cola = CJ && CJ.cola !== undefined ? CJ.cola : 0.16, tono = LOOK.mix(pelCeja, piel, CJ ? (CJ.w > 0.025 ? 0.03 : 0.08) : m ? 0.08 : 0.1), N = CJ ? CJ.n : m ? 42 : 32, base = [], irr = CJ ? CJ.irr : 0, krz = CJ ? CJ.tr : 1, arr = t => (CJ ? (m ? 0.562 : 0.571) + (CJ.dy || 0) + CJ.arco * sin(PI * pow(t, 0.72)) - CJ.cae * t * t : m ? 0.565 + 0.012 * sin(PI * pow(t, 0.75)) - 0.012 * t * t : 0.575 + 0.02 * sin(PI * pow(t, 0.7)) - 0.019 * t * t) + 0.003 * (k > 0 ? 1 : -0.5) + vari.ceja * k;
          for (let i = 0; i <= 14; i++) { const t = i / 14; base.push(fp(k * lerp(0.064, 0.2, t), arr(t) + w * lerp(0.5, cola, t) * (1 + irr * (rn() - 0.5) * 0.5))); }
          for (let i = 14; i >= 0; i--) { const t = i / 14; base.push(fp(k * lerp(0.064, 0.2, t), arr(t) - w * lerp(0.5, cola, t) * (1 + irr * (rn() - 0.5) * 0.5))); }
          suave(R.cara, 2.4, 'source-over', min(0.92, (CJ ? CJ.al : m ? 0.64 : 0.66) * (1 + 0.4 * LJ)), k2 => { k2.fillStyle = tono; k2.beginPath(); base.forEach((q, i) => (i ? k2.lineTo(q[0], q[1]) : k2.moveTo(q[0], q[1]))); k2.closePath(); k2.fill(); });
          g.lineCap = 'round';
          for (let i = 0; i <= N; i++) {
            const t = i / N + (rn() - 0.5) * 0.02, xn = k * lerp(0.066, 0.198, t), hb = arr(clamp(t)), ws = w * lerp(0.62, 0.2, clamp(t)), sl = (rn() - 0.5) * ws * 0.9, an = lerp(1.2, 0.2, clamp(t)), L = ws * 1.1 + 0.005;
            const q0 = fp(xn, hb - ws * 0.5 + sl), q1 = fp(xn + k * cos(an) * L, hb - ws * 0.5 + sl + sin(an) * L);
            g.strokeStyle = tono; g.globalAlpha = min(0.9, (0.2 + rn() * 0.22) * krz); g.lineWidth = 0.4 + rn() * 0.26; g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1] + irr * (rn() - 0.3) * 1.2); g.stroke();
          }
          g.globalAlpha = 1;
        };
        dos(ceja);
        // Nariz: orificios y aletas
        dos(k => { blob(k * 0.03 * NAR.kw, hNar + 0.002, 0.0135, 0.007, '#3a2016', 0.72); blob(k * (m ? 0.076 : 0.066) * NAR.kw, hNar + 0.02, 0.011, 0.026, pielSom, 0.3); });
        // Boca: sonríe apenas. Él: sombra y tono de piel, sin color de labios (de perfil no tiene labios). Ella: labios con forma y color
        const bocaAncho = (m ? 0.09 : 0.092) * (1 + vari.boca), lineaBoca = t => hB - 0.002 * (1 - t * t) + 0.0052 * t * t * t * t + 0.0012 * t;
        suave(R.cara, 3, 'multiply', (m ? 0.05 : 0.025) * (look.edad === 'mayor' ? 4 : 1), k2 => { for (const sg of [1, -1]) curvaT(k2, [fp(sg * 0.085, hNar + 0.012), fp(sg * 0.13, hB + 0.05), fp(sg * (bocaAncho + 0.03), hB - 0.006)], 3.2, pielSom); });
        // Surco nasal: un canal blando entre dos crestas claras, de la nariz al labio
        suave(R.cara, 2, 'multiply', m ? 0.2 : 0.15, k2 => curvaT(k2, [fp(0, hNar - 0.008), fp(0, (hNar + hB) / 2), fp(0, hB + 0.028)], 2.2, pielSom));
        suave(R.cara, 2, 'screen', 0.13, k2 => { for (const sg of [1, -1]) curvaT(k2, [fp(sg * 0.014, hNar - 0.01), fp(sg * 0.017, (hNar + hB) / 2), fp(sg * 0.022, hB + 0.03)], 1.6, pielLuz); });
        const llena = (k2, pts, c0) => { k2.fillStyle = c0; k2.beginPath(); pts.forEach((q, i) => (i ? k2.lineTo(q[0], q[1]) : k2.moveTo(q[0], q[1]))); k2.closePath(); k2.fill(); };
        const labios = (altS, altI, arco) => {
          const N = 28, sup = [], inf = [];
          for (let i = 0; i <= N; i++) { const t = i / N * 2 - 1; sup.push(fp(t * bocaAncho, lineaBoca(t))); inf.push(fp(t * bocaAncho, lineaBoca(t))); }
          for (let i = N; i >= 0; i--) { const t = i / N * 2 - 1, at = abs(t); sup.push(fp(t * bocaAncho, lineaBoca(t) + altS * pow(1 - t * t, 0.75) * (1 + arco * (0.5 * G(at - 0.32, 0.16) - 0.55 * G(t, 0.09))))); inf.push(fp(t * bocaAncho * 0.97, lineaBoca(t) - altI * pow(1 - t * t, 0.95))); }
          return { sup, inf };
        };
        if (!m) {
          const { sup, inf } = labios(0.03, 0.043, 1), tono = LOOK.mix(piel, '#8a3640', 0.5), tonoB = LOOK.mix(piel, '#a64c4e', 0.42);
          suave(R.cara, 1.5, 'source-over', 0.9, k2 => { llena(k2, sup, tono); llena(k2, inf, tonoB); });
          suave(R.cara, 1.5, 'multiply', 0.2, k2 => { k2.strokeStyle = LOOK.mix(tono, '#5a2a24', 0.4); k2.lineWidth = 0.9; k2.beginPath(); sup.forEach((q, i) => (i ? k2.lineTo(q[0], q[1]) : k2.moveTo(q[0], q[1]))); k2.stroke(); });
          blob(0, hB - 0.022, 0.045, 0.011, pielLuz, 0.4); blob(0, hB + 0.035, 0.035, 0.006, pielLuz, 0.16); blob(0, hB - 0.052, 0.05, 0.01, pielSom, 0.22);
        } else {
          // El labio de arriba mira abajo y queda en sombra; el de abajo coge luz y deja sombra debajo
          const { sup, inf } = labios(0.022, 0.03, 0.6);
          suave(R.cara, 2, 'multiply', 0.22, k2 => llena(k2, sup, LOOK.mix(piel, pielSom, 0.75)));
          suave(R.cara, 2, 'source-over', 0.2, k2 => llena(k2, inf, LOOK.mix(piel, pielRoj, 0.4)));
          blob(0, hB - 0.02, 0.05, 0.01, pielLuz, 0.26); blob(0, hB - 0.044, 0.06, 0.012, pielSom, 0.3);
        }
        { const pts = [], cen = [], N = 24; for (let i = 0; i <= N; i++) { const t = i / N * 2 - 1, q = fp(t * bocaAncho, lineaBoca(t)); pts.push(q); if (abs(t) < 0.62) cen.push(q); }
          g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = LOOK.mix(pielSom, '#40221a', m ? 0.45 : 0.55);
          g.globalAlpha = (m ? 0.55 : 0.66) + 0.18 * LJ; g.lineWidth = (m ? 0.95 : 0.9) * (1 + 0.25 * LJ); poli(pts, false); g.stroke();
          g.globalAlpha = 0.32; poli(cen, false); g.stroke(); g.globalAlpha = 1;
          dos(k => blob(k * bocaAncho * 1.04, lineaBoca(k) + 0.003, 0.016, 0.016, pielSom, 0.38)); }
        // Oreja
        { const r = R.oreja, cx = r.x + r.w / 2, cy = r.y + r.h / 2; const gr = g.createRadialGradient(cx, cy, 1, cx, cy, r.h / 2); gr.addColorStop(0, LOOK.mix(piel, pielSom, 0.8)); gr.addColorStop(0.45, LOOK.mix(piel, pielSom, 0.42)); gr.addColorStop(0.68, LOOK.mix(piel, pielRoj, 0.3)); gr.addColorStop(1, LOOK.mix(piel, pielRoj, 0.2)); g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h); }
        // ---- mano y dedos: tono algo más rojizo hacia las puntas, pliegues de las falanges y uña clara, sin rayas de dibujo
        { const r = R.mano, gm = g.createLinearGradient(0, r.y, 0, r.y + r.h); gm.addColorStop(0, 'rgba(0,0,0,0)'); gm.addColorStop(1, `rgba(${hexRgb(LOOK.mix(piel, pielRoj, 0.45))},0.5)`); g.fillStyle = gm; g.fillRect(r.x, r.y, r.w, r.h);
          suave(r, 1.5, 'multiply', 0.28, k2 => { k2.strokeStyle = pielSom; k2.lineWidth = 1; for (const u of [0.41, 0.5, 0.59]) { k2.beginPath(); k2.moveTo(r.x + r.w * u, r.y + r.h * 0.42); k2.lineTo(r.x + r.w * u, r.y + r.h * 0.58); k2.stroke(); } });
          suave(r, 1.5, 'screen', 0.2, k2 => { k2.fillStyle = pielLuz; for (const u of [0.36, 0.455, 0.545, 0.64]) { k2.beginPath(); k2.ellipse(r.x + r.w * u, r.y + r.h * 0.52, 1.7, 2, 0, 0, 7); k2.fill(); } }); }
        { const r = R.dedo, gm = g.createLinearGradient(0, r.y, 0, r.y + r.h); gm.addColorStop(0, `rgba(${hexRgb(LOOK.mix(piel, pielRoj, 0.4))},0.26)`); gm.addColorStop(0.5, `rgba(${hexRgb(LOOK.mix(piel, pielRoj, 0.3))},0.14)`); gm.addColorStop(1, `rgba(${hexRgb(LOOK.mix(piel, pielRoj, 0.5))},0.26)`); g.fillStyle = gm; g.fillRect(r.x, r.y, r.w, r.h);
          g.fillStyle = pielSom; g.globalAlpha = 0.2; for (const vj of [0.46, 0.76]) g.fillRect(r.x, r.y + r.h * vj, r.w, 0.8); g.globalAlpha = 1;
          g.fillStyle = LOOK.mix(piel, '#efe2d0', 0.2); g.fillRect(r.x + r.w * 0.66, r.y + r.h * 0.84, r.w * 0.18, r.h * 0.12); }

        // ---- 3. calzado y medias
        const pieR = R.pie, piernaR = R.pierna, YP = y => vP(y), UP = u => piernaR.x + piernaR.w * u;
        for (const pr of prendas) {
          const col = LOOK.sobrio(pr.color || '#6a5a4a');
          if (pr.id === 'medias') { g.fillStyle = col; g.fillRect(piernaR.x, YP(d.rodilla + 0.03), piernaR.w, piernaR.y + piernaR.h - YP(d.rodilla + 0.03)); trama(piernaR, 'punto', 0.25); relleno(pieR, col, 1); }
          if (pr.id === 'botas' || pr.id === 'zapatos') {
            relleno(pieR, col, 2); trama(pieR, 'cuero', 0.4);
            // Suela, oscura; desgaste claro en puntera y talón
            const suela = LOOK.mix(col, '#17120e', 0.6), luz = LOOK.mix(col, '#c7ab86', 0.28);
            g.fillStyle = suela; g.fillRect(pieR.x + pieR.w * 0.55, pieR.y, pieR.w * 0.45, pieR.h);
            g.fillStyle = LOOK.mix(col, '#17120e', 0.5); g.fillRect(pieR.x + pieR.w * 0.46, pieR.y, pieR.w * 0.09, pieR.h); g.fillRect(pieR.x, pieR.y, pieR.w * 0.05, pieR.h); g.fillRect(pieR.x + pieR.w * 0.97, pieR.y, pieR.w * 0.03, pieR.h);
            suave(pieR, 2, 'source-over', 0.6, k => { k.fillStyle = luz; k.fillRect(pieR.x + pieR.w * 0.1, pieR.y + pieR.h * 0.8, pieR.w * 0.3, pieR.h * 0.16); k.fillRect(pieR.x + pieR.w * 0.12, pieR.y + pieR.h * 0.22, pieR.w * 0.26, pieR.h * 0.07); });
            // Cordones
            g.strokeStyle = LOOK.mix(col, '#10100e', 0.55); g.lineWidth = 1; const mitad = pieR.x + pieR.w * 0.25;
            for (let i = 0; i < 4; i++) { const yy = pieR.y + pieR.h * (0.12 + i * 0.09); g.beginPath(); g.moveTo(mitad - 5, yy); g.lineTo(mitad + 5, yy + 1.5); g.moveTo(mitad + 5, yy); g.lineTo(mitad - 5, yy + 1.5); g.stroke(); }
            if (pr.id === 'zapatos') { const yt = pieR.y + 1; g.fillStyle = LOOK.sobrio((prendas.find(o => o.id === 'medias') || {}).color || look.skin); g.fillRect(pieR.x, pieR.y, pieR.w * 0.56, pieR.h * 0.14); g.fillRect(pieR.x + pieR.w * 0.92, pieR.y, pieR.w * 0.08, pieR.h * 0.14); }
          }
        }
        // ---- 4. piernas: pantalón
        const pant = tiene('pantalon');
        if (pant) {
          const col = LOOK.sobrio(pant.color); relleno(piernaR, col, 2); trama(piernaR, 'sarga', 0.3);
          const tb = R.tronco, yw = d.cintura - 0.018; g.fillStyle = col; g.fillRect(tb.x, TY(yw), tb.w, tb.y + tb.h - TY(yw) + 3); trama({ x: tb.x, y: TY(yw), w: tb.w, h: tb.y + tb.h - TY(yw) }, 'sarga', 0.3);
          const osc = LOOK.mix(col, '#17110c', 0.5), luz = LOOK.mix(col, '#d8c6a4', 0.28);
          const r = piernaR, yH0 = YP(yBajo + 0.024), yF0 = botaAlta ? yHem + 0.012 : 0.135 * ky;
          // Pliegues: rodilla (zeta), ingle y la caída sobre la bota
          suave(r, 2.8, 'multiply', 0.3, k => {
            for (const c of [0.25, 0.75]) {
              for (const [yy, dy, w] of [[d.rodilla + 0.05, 0.03, 2.2], [d.rodilla - 0.01, -0.03, 2.6]]) curvaT(k, [[UP(c - 0.16), YP(yy)], [UP(c), YP(yy - dy)], [UP(c + 0.16), YP(yy + dy * 0.6)]], w, osc);
              for (const [yy, dy] of [[yF0 + 0.035, 0.022]]) curvaT(k, [[UP(c - 0.2), YP(yy)], [UP(c), YP(yy + dy)], [UP(c + 0.22), YP(yy - dy * 0.4)]], 2, osc);
            }
            curvaT(k, [[UP(0.03), YP(d.yP - 0.01)], [UP(0.13), YP(d.yP - 0.08)], [UP(0.3), YP(d.yP - 0.16)]], 3, osc);
            curvaT(k, [[UP(0.98), YP(d.yP - 0.01)], [UP(0.88), YP(d.yP - 0.07)], [UP(0.72), YP(d.yP - 0.13)]], 3, osc);
            curvaT(k, [[UP(0.03), YP(d.yP - 0.03)], [UP(0.1), YP(d.yP - 0.13)], [UP(0.14), YP(d.yP - 0.24)]], 2.5, osc);
          });
          suave(r, 2.4, 'screen', 0.26, k => { for (const c of [0.25, 0.75]) { curvaT(k, [[UP(c - 0.14), YP(d.rodilla + 0.022)], [UP(c), YP(d.rodilla + 0.05)], [UP(c + 0.14), YP(d.rodilla + 0.018)]], 2.4, luz); curvaT(k, [[UP(c - 0.12), YP(yF0 + 0.015)], [UP(c), YP(yF0 + 0.045)], [UP(c + 0.14), YP(yF0 + 0.025)]], 2, luz); } });
          // Costura lateral, rodillas gastadas y suciedad abajo
          g.strokeStyle = LOOK.mix(col, '#14100c', 0.32); g.lineWidth = 0.8; g.beginPath(); g.moveTo(UP(0.5), r.y); g.lineTo(UP(0.5), r.y + r.h); g.stroke();
          suave(r, 3, 'screen', 0.07, k => { k.fillStyle = luz; k.beginPath(); k.ellipse(UP(0.25), YP(d.rodilla + 0.012), r.w * 0.11, r.h * 0.05, 0, 0, 7); k.fill(); });
          const grd = g.createLinearGradient(0, YP(0.32 * ky), 0, YP(yBajo)); grd.addColorStop(0, 'rgba(90,72,52,0)'); grd.addColorStop(1, 'rgba(96,78,58,0.34)'); g.fillStyle = grd; g.fillRect(r.x, YP(0.32 * ky), r.w, YP(yBajo) - YP(0.32 * ky) + 2);
          // Bajo
          if (botaAlta) {
            const bc = LOOK.sobrio(tiene('botas').color), yB = YP(yHem), rb = { x: r.x, y: yB, w: r.w, h: r.y + r.h - yB };
            g.fillStyle = bc; g.fillRect(r.x - 2, yB, r.w + 4, rb.h + 3); trama(rb, 'cuero', 0.42);
            suave(rb, 2, 'multiply', 0.3, k => { for (const c of [0.25, 0.75]) for (const [yy, w] of [[0.135, 2], [0.105, 1.6]]) curvaT(k, [[UP(c - 0.2), YP(yy * ky)], [UP(c), YP((yy - 0.012) * ky)], [UP(c + 0.2), YP((yy + 0.006) * ky)]], w, LOOK.mix(bc, '#0c0806', 0.7)); });
            suave(rb, 2, 'screen', 0.16, k => { for (const c of [0.25, 0.75]) curvaT(k, [[UP(c - 0.12), YP(0.25 * ky)], [UP(c), YP(0.2 * ky)], [UP(c + 0.1), YP(0.13 * ky)]], 3, LOOK.mix(bc, '#c7ab86', 0.5)); });
            g.fillStyle = 'rgba(16,10,6,0.6)'; g.fillRect(r.x, yB - 0.6, r.w, 2.2);
          } else { g.fillStyle = LOOK.mix(col, '#100c08', 0.28); g.fillRect(r.x, yH0 - 1.2, r.w, 1.2); }
        }
        // ---- 5. tronco: camisa o túnica
        const tb = R.tronco;
        const clipTr = () => { g.beginPath(); g.rect(tb.x, tb.y, tb.w, tb.h); g.clip(); };
        const borde = (fnY) => { const o = []; for (let t = -180; t <= 180; t += 2) o.push([TX(t), TY(fnY(t))]); return o; };
        const camisa = tiene('camisa'), tunica = tiene('tunica');
        const manga = (col, fin, ribete, tram, fold) => {
          const r = R.brazo, yFin = R.brazo.y + R.brazo.h * clamp((yMap(1.40) - (jy - fin * largoB)) / (yMap(1.40) - mun[1]));
          g.fillStyle = col; g.fillRect(r.x - 2, r.y - 2, r.w + 4, yFin - r.y + 2); trama({ x: r.x, y: r.y, w: r.w, h: yFin - r.y }, tram, 0.4);
          const osc = LOOK.mix(col, '#2a2018', 0.5), Yc = R.brazo.y + R.brazo.h * clamp((yMap(1.40) - cod[1]) / (yMap(1.40) - mun[1]));
          suave({ x: r.x, y: r.y, w: r.w, h: yFin - r.y }, 2.6, 'multiply', 0.55, k => {
            // Codo y tirones desde la sisa
            for (const [dy, w, u0, u1] of [[-9, 1.5, 0.1, 0.62], [-1, 2.1, 0.0, 0.9], [8, 1.5, 0.28, 1]]) curvaT(k, [[r.x + r.w * u0, Yc + dy + 2], [r.x + r.w * (u0 + u1) / 2, Yc + dy - 2], [r.x + r.w * u1, Yc + dy + 3]], w, osc);
            curvaT(k, [[r.x + 2, r.y + 14], [r.x + r.w * 0.2, r.y + 30], [r.x + r.w * 0.1, r.y + 56]], 2.2, osc);
            curvaT(k, [[r.x + r.w - 2, r.y + 14], [r.x + r.w * 0.82, r.y + 32], [r.x + r.w * 0.9, r.y + 54]], 2.2, osc);
            curvaT(k, [[r.x + r.w * 0.5, r.y + 22], [r.x + r.w * 0.36, r.y + 38], [r.x + r.w * 0.5, r.y + 60]], 1.6, osc);
          });
          if (ribete) { g.fillStyle = ribete; g.fillRect(r.x, yFin - 3, r.w, 3); } else { g.fillStyle = LOOK.mix(col, '#2a2018', 0.3); g.fillRect(r.x, yFin - 1, r.w, 1); }
          g.fillStyle = 'rgba(70,55,40,0.22)'; g.fillRect(r.x, yFin - 6, r.w, 3);
        };
        // Vuelta de la manga: la tela doblada, una línea a cada lado y la sombra que deja en el antebrazo
        const puno = (col, fin) => { const r = R.brazo, yF = R.brazo.y + R.brazo.h * clamp((yMap(1.40) - (jy - fin * largoB)) / (yMap(1.40) - mun[1])); g.fillStyle = LOOK.mix(col, '#ffffff', 0.08); g.fillRect(r.x, yF - 7, r.w, 7); g.fillStyle = LOOK.mix(col, '#2a2018', 0.42); g.fillRect(r.x, yF - 7.6, r.w, 1.1); g.fillRect(r.x, yF - 1, r.w, 1); g.fillStyle = 'rgba(60,40,28,0.3)'; g.fillRect(r.x, yF, r.w, 2.2); };
        if (camisa) {
          const col = LOOK.sobrio(camisa.color), osc = LOOK.mix(col, '#3a2c20', 0.55), luz = LOOK.mix(col, '#ffffff', 0.25);
          g.save(); clipTr();
          const sup = borde(cuelloCam); const yw = d.cintura - 0.02; poli(sup.concat([[TX(180), TY(yw)], [TX(-180), TY(yw)]])); g.fillStyle = col; g.fill(); g.restore();
          trama({ x: tb.x, y: TY(d.yt + 0.05), w: tb.w, h: TY(yw) - TY(d.yt + 0.05) }, 'lino', 0.3);
          g.save(); clipTr(); poli(sup.concat([[TX(180), TY(yw)], [TX(-180), TY(yw)]])); g.clip();
          suave(tb, 2.4, 'multiply', 0.65, k => {
            for (const sg of [1, -1]) {
              curvaT(k, [[TX(sg * 62), TY(d.ya + 0.01)], [TX(sg * 46), TY(d.ya - 0.09)], [TX(sg * 22), TY(d.cintura + 0.03)]], 2.2, osc);
              curvaT(k, [[TX(sg * 116), TY(d.ya + 0.01)], [TX(sg * 132), TY(d.ya - 0.1)], [TX(sg * 160), TY(d.cintura + 0.04)]], 2.2, osc);
              for (let i = 0; i < 3; i++) curvaT(k, [[TX(sg * (28 + i * 34)), TY(d.cintura + 0.012 + i * 0.006)], [TX(sg * (44 + i * 34)), TY(d.cintura + 0.04 + i * 0.006)], [TX(sg * (64 + i * 34)), TY(d.cintura + 0.01)]], 1.8, osc);
            }
          });
          // Tapeta y botones
          g.fillStyle = LOOK.mix(col, '#3a2c20', 0.07); g.fillRect(TX(-2), TY(d.yt + 0.016), TX(2) - TX(-2), TY(yw) - TY(d.yt + 0.016));
          g.strokeStyle = LOOK.mix(col, '#3a2c20', 0.2); g.lineWidth = 0.5; g.beginPath(); g.moveTo(TX(2), TY(d.yt + 0.016)); g.lineTo(TX(2), TY(yw)); g.stroke();
          g.restore();
          manga(col, camisa.fin || finManga, null, 'lino'); puno(col, finManga);
          // Tirilla
          const cu = R.cuello; g.fillStyle = col; g.fillRect(cu.x, cu.y, cu.w, cu.h); trama(cu, 'lino', 0.3); g.fillStyle = LOOK.mix(col, '#3a2c20', 0.35); g.fillRect(cu.x, cu.y + cu.h - 2, cu.w, 2);
        }
        if (tunica) {
          const col = LOOK.sobrio(tunica.color), rib = LOOK.mix(col, LOOK.sobrio(tunica.ribete || '#b08a4e'), 0.3), osc = LOOK.mix(col, '#2b1612', 0.55), luz = LOOK.mix(col, '#f0d8c0', 0.25);
          const cuelloT = cuelloTunica;
          const sup = borde(t => cuelloT(t) - gruesoEscote(t) * 0.5);
          g.save(); clipTr(); poli(sup.concat([[TX(180), tb.y + tb.h + 3], [TX(-180), tb.y + tb.h + 3]])); g.fillStyle = col; g.fill(); g.clip();
          trama(tb, 'lino', 0.4);
          suave(tb, 2.4, 'multiply', 0.7, k => {
            for (const sg of [1, -1]) {
              curvaT(k, [[TX(sg * 60), TY(d.ya + 0.01)], [TX(sg * 44), TY(d.ya - 0.08)], [TX(sg * 26), TY(d.cintura + 0.05)]], 2.2, osc);
              curvaT(k, [[TX(sg * 118), TY(d.ya + 0.01)], [TX(sg * 134), TY(d.ya - 0.09)], [TX(sg * 158), TY(d.cintura + 0.05)]], 2.2, osc);
              for (let i = 0; i < 4; i++) curvaT(k, [[TX(sg * (10 + i * 40)), TY(d.cintura + 0.022)], [TX(sg * (22 + i * 40)), TY(d.cintura + 0.06)], [TX(sg * (30 + i * 40)), TY(d.cintura + 0.02)]], 2, osc);
              curvaT(k, [[TX(sg * 24), TY(d.ya + 0.02)], [TX(sg * 16), TY(d.ya - 0.04)], [TX(sg * 14), TY(d.cintura + 0.03)]], 1.4, osc);
            }
          });
          g.restore();
          g.save(); clipTr(); g.strokeStyle = LOOK.mix(col, '#2b1612', 0.14); g.lineWidth = 0.5; g.beginPath(); g.moveTo(TX(0), TY(d.yt - 0.05)); g.lineTo(TX(0), TY(d.cintura)); g.stroke(); g.restore();
          // Ribete de contraste del escote: la tira que lleva la cinta en relieve
          { const cu2 = R.cuello, cL2 = LOOK.mix(LOOK.sobrio(tunica.camisola || '#d3c9b4'), LOOK.sobrio(tunica.color), 0.12), hL = cu2.h * 0.44; g.fillStyle = rib; g.fillRect(cu2.x, cu2.y, cu2.w, cu2.h); trama(cu2, 'lino', 0.35); g.fillStyle = LOOK.mix(rib, '#2b1612', 0.4); g.fillRect(cu2.x, cu2.y + cu2.h - 2.5, cu2.w, 2.5);
            g.fillStyle = cL2; g.fillRect(cu2.x, cu2.y, cu2.w, hL); g.strokeStyle = LOOK.mix(cL2, '#4a3a2a', 0.45); g.lineWidth = 0.6; for (let u = 0; u < cu2.w; u += 1.7) { g.globalAlpha = 0.12 + rn() * 0.16; g.beginPath(); g.moveTo(cu2.x + u, cu2.y); g.lineTo(cu2.x + u + (rn() - 0.5) * 1.2, cu2.y + hL); g.stroke(); } g.globalAlpha = 1;
            g.fillStyle = 'rgba(50,34,24,0.3)'; g.fillRect(cu2.x, cu2.y + hL - 1.2, cu2.w, 1.2); g.fillStyle = LOOK.mix(cL2, '#4a3a2a', 0.22); g.fillRect(cu2.x, cu2.y, cu2.w, 1); }
          manga(col, finManga, null, 'lino'); puno(col, finManga);
          // Falda
          const f = R.falda; relleno(f, col, 2); trama(f, 'lino', 0.36);
          const XF = t => f.x + f.w * (t + 180) / 360;
          suave(f, 4, 'multiply', 0.26, k => {
            for (let i = 0; i < 11; i++) { const t = -180 + 33 * i + rn() * 16, w = 5 + rn() * 5; curvaT(k, [[XF(t), f.y + 14 + rn() * 26], [XF(t + (rn() - 0.5) * 6), f.y + f.h * 0.55], [XF(t + (rn() - 0.5) * 8), f.y + f.h]], w, osc); }
            for (const sg of [1, -1]) { curvaT(k, [[XF(sg * 90), f.y + 4], [XF(sg * 76), f.y + 20], [XF(sg * 52), f.y + 34]], 2.4, osc); curvaT(k, [[XF(sg * 122), f.y + 6], [XF(sg * 140), f.y + 22], [XF(sg * 158), f.y + 38]], 2.4, osc); }
          });
          suave(f, 4, 'screen', 0.12, k => { for (let i = 0; i < 8; i++) { const t = -170 + 45 * i + rn() * 20; curvaT(k, [[XF(t), f.y + 24 + rn() * 20], [XF(t + 2), f.y + f.h * 0.6], [XF(t + (rn() - 0.5) * 6), f.y + f.h]], 5, luz); } });
          // Suciedad abajo y ribete del bajo
          const gd = g.createLinearGradient(0, f.y + f.h * 0.62, 0, f.y + f.h); gd.addColorStop(0, 'rgba(84,66,48,0)'); gd.addColorStop(1, 'rgba(84,66,48,0.42)'); g.fillStyle = gd; g.fillRect(f.x, f.y + f.h * 0.62, f.w, f.h * 0.38);
          g.fillStyle = LOOK.mix(col, '#100a08', 0.28); g.fillRect(f.x, f.y + f.h - 6, f.w, 0.8); g.fillStyle = LOOK.mix(col, '#100a08', 0.45); g.fillRect(f.x, f.y + f.h - 1.4, f.w, 1.4);
          { const xP = XF(112), yP = f.y + f.h * 0.56, cP = LOOK.mix(col, '#4a3024', 0.34); g.fillStyle = cP; g.fillRect(xP, yP, 13, 11); trama({ x: xP, y: yP, w: 13, h: 11 }, 'lino', 0.5); g.strokeStyle = LOOK.mix(col, '#e8d8c0', 0.4); g.lineWidth = 0.5; g.setLineDash([1.2, 1.1]); g.strokeRect(xP + 0.5, yP + 0.5, 12, 10); g.setLineDash([]); }   // remiendo
          // Interior oscuro y cinturón
          const ci = R.cinto, deli = tiene('delantal'); g.fillStyle = deli ? LOOK.mix(LOOK.sobrio(deli.color), '#6a5a44', 0.2) : LOOK.mix(rib, '#2b2016', 0.55); g.fillRect(ci.x, ci.y, ci.w, ci.h); trama(ci, deli ? 'lino' : 'cuero', 0.3);
        }
        if (tiene('pantalon')) {
          // Cinturón
          const col = LOOK.sobrio('#3f2f22'), yw = d.cintura - 0.02; g.fillStyle = col; g.fillRect(tb.x, TY(yw), tb.w, 5.5); g.fillStyle = 'rgba(255,230,200,0.12)'; g.fillRect(tb.x, TY(yw), tb.w, 0.9);
        }
        const chal = tiene('chaleco');
        if (chal) {
          const col = LOOK.sobrio(chal.color), rib = chal.ribete ? LOOK.sobrio(chal.ribete) : LOOK.mix(col, '#0e1218', 0.32), osc = LOOK.mix(col, '#10141c', 0.5), luz = LOOK.mix(col, '#d8d8c8', 0.25);
          const yb = d.yChaleco + 0.0025;
          const tope = topeCh;
          const baj = t => { const a = abs(t); return yb - (a < 16 ? 0.012 * (1 - a / 16) : 0); };
          const sup = []; for (let t = -180; t <= 180; t += 2) sup.push([TX(t), TY(tope(t))]);
          const inf = []; for (let t = 180; t >= -180; t -= 4) inf.push([TX(t), TY(baj(t))]);
          g.save(); clipTr(); poli(sup.concat(inf)); g.fillStyle = col; g.fill(); g.clip();
          trama(tb, 'sarga', 0.3);
          // Espalda de otro paño, más mate, y pinzas
          suave(tb, 2.2, 'multiply', 0.7, k => {
            for (const sg of [1, -1]) {
              curvaT(k, [[TX(sg * 58), TY(d.ya)], [TX(sg * 34), TY(d.cintura + 0.06)], [TX(sg * 26), TY(yb)]], 2.2, osc);
              curvaT(k, [[TX(sg * 122), TY(d.ya)], [TX(sg * 146), TY(d.cintura + 0.08)], [TX(sg * 148), TY(yb)]], 2.2, osc);
              curvaT(k, [[TX(sg * 86), TY(d.ya - 0.03)], [TX(sg * 90), TY(d.cintura + 0.06)], [TX(sg * 86), TY(yb)]], 2.4, osc);
            }
          });
          suave(tb, 2.2, 'screen', 0.28, k => { for (const sg of [1, -1]) curvaT(k, [[TX(sg * 24), TY(d.yt - 0.03)], [TX(sg * 20), TY(d.ya - 0.07)], [TX(sg * 18), TY(d.cintura)]], 3, luz); });
          g.restore();
          // Sisa: la camisa asoma en un óvalo alrededor del brazo, y la manga sigue sin corte hasta el hombro
          const cam2 = tiene('camisa');
          if (cam2) for (const sg of [1, -1]) { g.fillStyle = LOOK.sobrio(cam2.color); const ov = []; for (let i = 0; i < 32; i++) { const f = 2 * PI * i / 32; ov.push([TX(sg * (90 + sisa.rt * pw(cos(f), 0.55))), TY(sisa.yc + sisa.ry * pw(sin(f), 0.55))]); } poli(ov); g.fill(); }
          // La cinta en relieve de los bordes, algo más oscura que el paño
          { const cu3 = R.cinto, cc3 = LOOK.mix(col, '#10141c', 0.3); g.fillStyle = cc3; g.fillRect(cu3.x - 1, cu3.y - 1, cu3.w + 2, cu3.h + 2); trama(cu3, 'sarga', 0.3); g.fillStyle = LOOK.mix(col, '#d8d8c8', 0.06); g.fillRect(cu3.x, cu3.y + cu3.h * 0.46, cu3.w, 1); }
          // Un remiendo atrás: la prenda ha vivido
          { const xP = TX(-146), yP = TY(d.cintura + 0.09), cP = LOOK.mix(col, '#3a3428', 0.4); g.fillStyle = cP; g.fillRect(xP, yP, 11, 10); g.strokeStyle = LOOK.mix(col, '#d8d0b8', 0.35); g.lineWidth = 0.5; g.setLineDash([1.2, 1.1]); g.strokeRect(xP + 0.5, yP + 0.5, 10, 9); g.setLineDash([]); }
          // Ribete, botones
          g.save(); clipTr(); g.lineJoin = 'round'; g.strokeStyle = rib; g.lineWidth = 1.5;
                    g.lineWidth = 1.2; poli(inf.filter(p => p[0] > TX(-40) && p[0] < TX(40)), false); g.stroke();
          g.strokeStyle = LOOK.mix(col, '#10141c', 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(TX(0), TY(d.yt - 0.062)); g.lineTo(TX(0), TY(yb)); g.stroke();
          for (let i = 0; i < 6; i++) { const yy = lerp(d.yt - 0.075, yb + 0.02, i / 5); g.fillStyle = LOOK.sobrio('#46382a'); g.beginPath(); g.ellipse(TX(2.4), TY(yy), 1.4, 1.4, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(30,20,10,0.5)'; g.beginPath(); g.ellipse(TX(2.4) + 0.3, TY(yy) + 0.4, 0.8, 0.8, 0, 0, 7); g.fill(); }
          // Bolsillo
          for (const sg of [1, -1]) { g.strokeStyle = LOOK.mix(col, '#10141c', 0.55); g.lineWidth = 0.9; g.beginPath(); g.moveTo(TX(sg * 19), TY(d.cintura + 0.012)); g.lineTo(TX(sg * 40), TY(d.cintura + 0.020)); g.stroke(); }
          g.restore();
          // Sombra que deja el chaleco sobre lo de abajo
          g.fillStyle = 'rgba(30,24,18,0.45)'; g.fillRect(tb.x, TY(baj(90)) + 0.2, tb.w, 2);
        }
        // ---- 6. delantal
        const del = tiene('delantal');
        if (del) {
          const col = LOOK.sobrio(del.color), osc = LOOK.mix(col, '#4a3a2a', 0.55), r = R.delantal;
          relleno(r, col, 2); trama(r, 'lino', 0.55);
          suave(r, 3.5, 'multiply', 0.42, k => { for (let i = 0; i < 6; i++) { const x = r.x + r.w * (0.1 + i * 0.16 + rn() * 0.05); curvaT(k, [[x, r.y + 1], [x + (rn() - 0.5) * 7, r.y + r.h * 0.5], [x + (rn() - 0.5) * 9, r.y + r.h]], 3.4, osc); } });
          // Mancha de uso en el centro y al borde
          suave(r, 4, 'multiply', 0.14, k => { k.fillStyle = LOOK.mix(col, '#7c6a52', 0.8); k.beginPath(); k.ellipse(r.x + r.w * 0.5, r.y + r.h * 0.42, r.w * 0.22, r.h * 0.18, 0, 0, 7); k.fill(); });
          const gr = g.createLinearGradient(0, r.y + r.h * 0.7, 0, r.y + r.h); gr.addColorStop(0, 'rgba(110,90,66,0)'); gr.addColorStop(1, 'rgba(110,90,66,0.35)'); g.fillStyle = gr; g.fillRect(r.x, r.y + r.h * 0.7, r.w, r.h * 0.3);
          g.fillStyle = LOOK.mix(col, '#4a3a2a', 0.45); g.fillRect(r.x, r.y + r.h - 3.5, r.w, 0.8); g.fillRect(r.x + 1.2, r.y, 0.8, r.h); g.fillRect(r.x + r.w - 2, r.y, 0.8, r.h);
        }
        // ---- 7. polvo y capa
        const conP = look.hairStyle && estilos[look.hairStyle], esPanuelo = look.hairStyle === 'panuelo', capa = esPanuelo ? LOOK.sobrio(look.panuelo || '#6f5f44') : pelo;
        if (conP) {
          const est2 = estilos[look.hairStyle], vCapa = LOOK.hsv(capa)[2], hCapa = LOOK.hsv(capa), calido = hCapa[1] > 0.3 && (hCapa[0] < 0.11 || hCapa[0] > 0.95), claro = vCapa > 0.5 ? LOOK.mix(capa, '#f3f0ea', 0.4) : LOOK.mix(capa, calido ? '#e2b77a' : '#c9b08a', calido ? 0.3 : 0.26), oscu = vCapa > 0.5 ? LOOK.mix(capa, '#2a2622', 0.5) : LOOK.mix(capa, '#080605', 0.42);
          // Cuero cabelludo: el capa también está pintado, con borde suave, para que el casquete no deje hueco ni corte
          // Borde blando: una mancha difuminada, el color lleno un poco más arriba y pelos finos que salen del borde en la dirección del peinado
          const conRaya = est2.raya !== undefined ? est2.raya : look.hairStyle !== 'corto';
          const relleno2 = (k2, dhF) => { const yy = t => CY(est2.hl(abs(t)) + dhF(abs(t))); k2.beginPath(); k2.moveTo(R.cara.x - 3, yy(180)); for (let t = -180; t <= 180; t += 2) k2.lineTo(CX(t), yy(t)); k2.lineTo(R.cara.x + R.cara.w + 3, yy(180)); k2.lineTo(R.cara.x + R.cara.w + 3, R.cara.y - 3); k2.lineTo(R.cara.x - 3, R.cara.y - 3); k2.closePath(); k2.fill(); };
          suave(R.cara, 4, 'multiply', 0.15, k2 => { k2.fillStyle = pielSom; relleno2(k2, () => -0.022); });
          if (!conRaya) suave(R.cara, 4, 'source-over', 0.3, k2 => { k2.fillStyle = capa; relleno2(k2, a => -0.012 - 0.04 * sm(50, 95, a)); });   // sienes y nuca, en degradado
          suave(R.cara, 3, 'source-over', conRaya ? 0.36 : 0.4, k2 => { k2.fillStyle = LOOK.mix(capa, piel, 0.35); relleno2(k2, () => -0.004); });
          g.fillStyle = capa; relleno2(g, () => 0.008);
          g.save(); g.beginPath(); g.rect(R.cara.x, R.cara.y, R.cara.w, R.cara.h); g.clip(); g.lineCap = 'round';
          if (res > 512 && !esPanuelo) for (let t = -176; t <= 176; t += 0.95) {
            const a = abs(t), hl0 = est2.hl(a), nuca = sm(100, 130, a), largo = (conRaya ? 0.02 + 0.016 * rn() : 0.012 + 0.014 * rn() + 0.014 * nuca * rn()), hA = hl0 + 0.022, hB2 = hl0 - largo * (0.45 + 0.55 * rn());
            const tB = t + (rn() - 0.5) * 1.5, tA = conRaya ? tB * lerp(0.9, 1, nuca) : tB + (a < 90 ? -5 : 0);
            g.strokeStyle = capa; g.globalAlpha = (0.12 + rn() * 0.22) * lerp(1, 0.6, nuca); g.lineWidth = 0.3 + rn() * 0.34; g.beginPath(); g.moveTo(CX(tA), CY(hA)); g.lineTo(CX(tB), CY(hB2)); g.stroke();
          }
          g.restore(); g.globalAlpha = 1;
          const hebras = (r, n, ang = 0, a1 = 0.45, a2 = 0.35, gr = 1) => { g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.lineCap = 'round'; for (let i = 0; i < n; i++) { const x = r.x + rn() * r.w, y0 = r.y + rn() * r.h * 0.8, l = r.h * (0.2 + rn() * 0.6), cl = rn() < 0.42; g.strokeStyle = cl ? claro : oscu; g.globalAlpha = (cl ? a2 : a1) * (0.4 + rn() * 0.6); g.lineWidth = (0.25 + rn() * 0.6) * gr; g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + (rn() - 0.5) * 3 + ang * l * 0.5, y0 + l * 0.5, x + ang * l + (rn() - 0.5) * 3, y0 + l); g.stroke(); } g.globalAlpha = 1; g.restore(); };
          relleno(R.casco, capa, 2);
          if (esPanuelo) {
            const r = R.casco, oc = LOOK.mix(capa, '#1c130c', 0.5); trama(r, 'lino', 0.45);
            suave(r, 2.5, 'multiply', 0.5, k2 => { for (let i = 0; i < 9; i++) { const u = r.x + r.w * (0.04 + i * 0.115); curvaT(k2, [[u, r.y + r.h * 0.2], [u + (rn() - 0.5) * 8, r.y + r.h * 0.55], [lerp(u, r.x + r.w * (u < r.x + r.w * 0.5 ? 0.04 : 0.96), 0.5), r.y + r.h]], 2.2, oc); } });
            g.fillStyle = LOOK.mix(capa, '#1c130c', 0.35); g.fillRect(r.x, r.y + r.h - 3, r.w, 3);
          } else if (conRaya) {   // el casquete se pinta siguiendo el peinado: de la raya hacia atrás, no desde la coronilla
            const r = R.casco, UU = t => r.x + r.w * (t + 180) / 360, VV = v => r.y + r.h * v; g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); g.lineCap = 'round';
            const volumen = (k2, c0, n0, w0) => { for (const sg of [1, -1]) for (let i = 0; i < n0; i++) { const v0 = (i + 0.5 + rn() * 0.5) / n0, fin = lerp(172, 92, v0); curvaT(k2, [[UU(sg * 1.5), VV(v0)], [UU(sg * fin * 0.42), VV(v0 * 0.72 + 0.1)], [UU(sg * fin), VV(min(1, v0 * 0.25 + 0.72))]], w0, c0); } };
            suave(r, 4, 'multiply', 0.09, k2 => volumen(k2, oscu, 7, 3.2)); suave(r, 4, 'screen', 0.06, k2 => volumen(k2, claro, 5, 3));
            for (const sg of [1, -1]) for (let i = 0; i < 700; i++) { const v0 = pow(rn(), 0.8), fin = lerp(172, 92, v0) * (0.9 + rn() * 0.12), cl = rn() < 0.4; g.strokeStyle = cl ? claro : oscu; g.globalAlpha = (cl ? 0.09 : 0.13) * (0.4 + rn() * 0.6); g.lineWidth = 0.22 + rn() * 0.34; g.beginPath(); g.moveTo(UU(sg * (0.5 + rn() * 3)), VV(v0)); g.quadraticCurveTo(UU(sg * fin * 0.42), VV(v0 * 0.72 + 0.1), UU(sg * fin), VV(min(1, v0 * 0.25 + 0.72 + rn() * 0.12))); g.stroke(); }
            g.restore(); g.globalAlpha = 1;
          } else hebras(R.casco, 420, 0.12, 0.3, 0.18);
          // Sombra en el borde y brillo mate en la parte alta
          { const r = R.casco, gg = g.createLinearGradient(0, r.y, 0, r.y + r.h); gg.addColorStop(0, 'rgba(0,0,0,0.1)'); gg.addColorStop(0.3, 'rgba(255,240,215,0.1)'); gg.addColorStop(0.55, 'rgba(255,240,215,0.04)'); gg.addColorStop(1, 'rgba(0,0,0,0.06)'); g.fillStyle = gg; g.fillRect(r.x, r.y, r.w, r.h); }
          if (look.hairStyle !== 'corto' && !esPanuelo) { const r = R.casco; g.strokeStyle = LOOK.mix(piel, capa, 0.86); g.lineWidth = 0.4; g.beginPath(); g.moveTo(r.x + r.w / 2, r.y + r.h * 0.4); g.lineTo(r.x + r.w / 2, r.y + r.h); g.stroke(); }
          relleno(R.mechon, capa, 2); hebras(R.mechon, 500, 0, 0.17, 0.09);
          { const r = R.mechon, gg = g.createLinearGradient(0, r.y, 0, r.y + r.h); gg.addColorStop(0, 'rgba(255,240,215,0.06)'); gg.addColorStop(0.5, 'rgba(255,240,215,0.04)'); gg.addColorStop(1, 'rgba(0,0,0,0.05)'); g.fillStyle = gg; g.fillRect(r.x, r.y, r.w, r.h); }
          if (look.hairStyle === 'trenza') {
            const r = R.trenza; relleno(r, capa, 2); g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
            const paso = r.h * 0.94 / 13, U = u => r.x + r.w * u; g.lineCap = 'round'; g.fillStyle = oscu; g.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
            // Cada vuelta es un ramal ancho en diagonal que tapa al anterior: oscuro abajo, color del pelo y unas hebras claras encima
            for (let i = -1; i < 15; i++) for (const u0 of [0.25, 0.75]) { const y = r.y + i * paso, sg = i % 2 ? 1 : -1, tray = dx => [[U(u0 - sg * 0.22 + dx), y - paso * 0.1], [U(u0 + sg * 0.02 + dx), y + paso * 0.32], [U(u0 + sg * 0.21 + dx), y + paso * 1.05]];
              const ramal = (dx, c0, al, w0) => { const q = tray(dx); g.strokeStyle = c0; g.globalAlpha = al; g.lineWidth = w0; g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.quadraticCurveTo(q[1][0], q[1][1], q[2][0], q[2][1]); g.stroke(); };
              ramal(0, oscu, 1, 9.2); ramal(0, capa, 1, 7.9); for (const [dx, cc, al, w] of [[-0.09, claro, 0.2, 0.8], [-0.05, oscu, 0.26, 0.7], [-0.015, claro, 0.3, 0.9], [0.03, oscu, 0.24, 0.7], [0.07, claro, 0.22, 0.8], [0.11, oscu, 0.3, 0.8]]) ramal(dx, cc, al, w); }
            g.restore(); g.globalAlpha = 1;
            g.fillStyle = LOOK.sobrio(tiene('tunica') ? tiene('tunica').ribete || '#b08a4e' : '#6d5c4c'); g.fillRect(r.x, r.y + r.h * 0.915, r.w, r.h * 0.03);
          }
          if (look.hairStyle === 'mono') { const r = R.mono; relleno(r, capa, 2); hebras(r, 60, 0.5); }
          if (peinado) peinado.pinta({ g, R, capa, claro, oscu, piel, pielSom, rn, res, s, suave, relleno, curvaT, CX, CY, est: est2, look });
        }
        if (look.sombrero) {
          const r = look.hairStyle === 'trenza' ? R.mono : R.trenza, paja = look.sombrero === 'paja', base = LOOK.sobrio(look.sombreroColor || (paja ? '#b49c66' : '#3f3b39')), oc = LOOK.mix(base, '#1a120c', 0.5), lz = LOOK.mix(base, '#efe0b8', 0.3);
          relleno(r, base, 2); trama(r, paja ? 'cuero' : 'punto', 0.4);
          if (paja) { for (let y = r.y; y < r.y + r.h; y += 3.4) { g.fillStyle = rn() < 0.5 ? oc : lz; g.globalAlpha = 0.16 + rn() * 0.16; g.fillRect(r.x, y, r.w, 1.1); } g.globalAlpha = 1; g.fillStyle = LOOK.mix(base, '#3a2c20', 0.72); g.fillRect(r.x, r.y + r.h * 0.56, r.w, r.h * 0.11); const gg = g.createLinearGradient(0, r.y, 0, r.y + r.h * 0.34); gg.addColorStop(0, 'rgba(40,28,16,0.34)'); gg.addColorStop(1, 'rgba(40,28,16,0.06)'); g.fillStyle = gg; g.fillRect(r.x, r.y, r.w, r.h * 0.34); }
          else { g.fillStyle = LOOK.mix(base, '#000000', 0.3); g.fillRect(r.x, r.y, r.w, r.h * 0.22); }
        }
        // Costuras: se copia el borde de cada bloque hacia fuera, para que el mipmap no traiga otro color a la costura
        g.setTransform(1, 0, 0, 1, 0, 0);
        const lienzo = g.canvas, mg = ceil(2 * s);
        for (const k of ['tronco', 'brazo', 'pierna', 'falda', 'casco', 'casco2', 'mano', 'pie', 'trenza', 'mechon', 'delantal', 'cuello', 'cinto', 'oreja', 'dedo']) {
          const r = R[k], X0 = Math.round(r.x * s), Y0 = Math.round(r.y * s), W0 = Math.round(r.w * s), H0 = Math.round(r.h * s);
          g.drawImage(lienzo, X0 + 1, Y0, 1, H0, X0 - mg, Y0, mg + 1, H0);
          g.drawImage(lienzo, X0 + W0 - 2, Y0, 1, H0, X0 + W0 - 1, Y0, mg + 1, H0);
          g.drawImage(lienzo, X0 - mg, Y0 + 1, W0 + 2 * mg, 1, X0 - mg, Y0 - mg, W0 + 2 * mg, mg + 1);
          g.drawImage(lienzo, X0 - mg, Y0 + H0 - 2, W0 + 2 * mg, 1, X0 - mg, Y0 + H0 - 1, W0 + 2 * mg, mg + 1);
        }
      });
      return atlasC;
    }
  }

  // ---------------------------------------------------------------- tramas grises compartidas
  const cacheAtlas = {}, cacheTramas = {};
  function patron(k) {
    if (cacheTramas[k]) return cacheTramas[k];
    const S = 128, c = LOOK.rawCanvas(S, (g) => LOOK.pixels(g, S, S, (x, y) => {
      let v = 128;
      const n = LOOK.noise2(x / 16, y / 16, 8, 8), n2 = LOOK.noise2(x / 3 + 5, y / 3 + 9, 42, 42);
      if (k === 'lino') { v += ((x % 2) ^ (y % 2) ? 6 : -6) * (0.6 + n * 0.8) + (n2 - 0.5) * 30 + (n - 0.5) * 22; }
      else if (k === 'sarga') { v += (((x + y) % 3) === 0 ? 8 : -4) + (n2 - 0.5) * 26 + (n - 0.5) * 24; }
      else if (k === 'punto') { v += ((x % 3 === 0) ? -18 : 7) + ((y % 3 === 0) ? -12 : 5) + (n2 - 0.5) * 20; }
      else if (k === 'cuero') { v += (n2 - 0.5) * 60 + (n - 0.5) * 50; }
      else { v += (n2 - 0.5) * 24 + (n - 0.5) * 30; }
      return [v, v, v];
    }));
    return (cacheTramas[k] = c);
  }
  function hexRgb(h) { const n = parseInt(String(h).replace('#', ''), 16); return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255); }

  // Objetos sencillos, cada uno una llamada: cesta (el origen es el asa), azada (el origen es el suelo), cubo (el origen es el asa)
  const cacheMimbre = {};
  function prop(tipo) {
    const T = THREE, cil = (r0, r1, h, n, col, y = 0) => { const c = new T.CylinderGeometry(r1, r0, h, n, 1, false); c.translate(0, y + h / 2, 0); return LOOK.tint(c, col); };
    const arco = (r, g0, col, y) => { const c = new T.TorusGeometry(r, g0, 4, 10, PI); c.translate(0, y, 0); return LOOK.tint(c, col); };
    let geos, map = null;
    if (tipo === 'cesta') {
      map = cacheMimbre.t || (cacheMimbre.t = LOOK.canvas(128, (g, w, h) => { g.fillStyle = '#7c6240'; g.fillRect(0, 0, w, h); for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) { const sube = (x + y) % 2, X = x * w / 16, Y = y * h / 8; g.fillStyle = sube ? '#a48a5e' : '#5a452c'; g.fillRect(X + 0.6, Y + (sube ? 0 : 3), w / 16 - 1.2, h / 8 - (sube ? 0 : 6)); } }));
      const b0 = -0.31, cuerpo = cil(0.115, 0.15, 0.17, 12, '#ffffff', b0), fondo = LOOK.tint(new T.CircleGeometry(0.135, 10).rotateX(-PI / 2).translate(0, b0 + 0.13, 0), '#4a3a28');
      const pan = (x, z, r, col) => { const c = new T.IcosahedronGeometry(r, 0); c.scale(1, 0.72, 1); c.translate(x, b0 + 0.155, z); return LOOK.tint(c, col); };
      geos = [cuerpo, fondo, pan(0.05, 0.03, 0.06, '#8d6236'), pan(-0.06, -0.02, 0.055, '#94703a'), pan(0.0, -0.07, 0.045, '#7f4e2e'), arco(0.14, 0.008, '#6b5436', b0 + 0.17)];
    } else if (tipo === 'azada') {
      const palo = LOOK.tint(new T.CylinderGeometry(0.014, 0.016, 1.34, 6).translate(0, 0.67, 0), '#6a533a'), hoja = LOOK.box(0.15, 0.13, 0.012, 0, 0.1, 0.05, '#4f5254'), cubo2 = LOOK.box(0.05, 0.05, 0.05, 0, 0.14, 0.012, '#3e3f40');
      geos = [palo, hoja, cubo2];
    } else {
      const b0 = -0.36, aros = [cil(0.112, 0.114, 0.018, 12, '#4f5254', b0 + 0.05), cil(0.122, 0.124, 0.018, 12, '#4f5254', b0 + 0.19)];
      geos = [cil(0.105, 0.128, 0.24, 12, '#7d654a', b0), LOOK.tint(new T.CircleGeometry(0.118, 10).rotateX(-PI / 2).translate(0, b0 + 0.21, 0), '#39444a'), ...aros, arco(0.124, 0.005, '#4f5254', b0 + 0.235)];
    }
    const mesh = new T.Mesh(LOOK.merge(geos), new T.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.88 }));
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = tipo;
    return mesh;
  }
  // Coloca un objeto en la persona ya posada, en el sitio de un hueso, sin girar con él: para las fotos fijas de esta prueba
  function sujeta(p, obj, hueso, off = [0, 0, 0]) {
    p.root.updateMatrixWorld(true);
    const v = new THREE.Vector3(off[0], off[1], off[2]); p.bones[hueso].localToWorld(v); p.root.worldToLocal(v);
    obj.position.copy(v); p.root.add(obj); return obj;
  }

  return { build, DIMS, LOOKS, GARMENTS, POSTURAS, prop, sujeta };
};
