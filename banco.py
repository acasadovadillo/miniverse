# Banco de medidas del dibujo: abre el juego (?banco=1) en un Chrome invisible que usa la gráfica de verdad, recoge
# lo que mide src/banco.js en cada parada (lo que tarda cada fotograma, llamadas y triángulos, con y sin sombras) y
# una captura de cada una, y lo enseña en una tabla. Con --contra compara con otra versión (un commit): las dos se
# turnan vuelta a vuelta, para que el ruido del ordenador (otros programas usando la gráfica) les toque por igual.
#
#   python3 banco.py                      una vuelta con el código de ahora
#   python3 banco.py --contra HEAD        el código de ahora contra el último commit (dos vueltas de cada)
#   python3 banco.py --vueltas 3          más vueltas (la tabla da la mediana)
#   python3 banco.py --solo plaza,noche   solo esas paradas
#   python3 banco.py --px 2               a doble resolución
#   python3 banco.py --tam 1440x900       otro tamaño de ventana (por defecto 1280x800)
#   python3 banco.py --sw                 con el dibujo por software, como probar.py (para comparar)
#   python3 banco.py --ab luces,cielo     en cada parada, lo que cuesta cada cosa, quitándola en tandas alternas
#                                         (grupos, personas, luces, cielo, cielo-primero, sombra, res0.75…)
#   python3 banco.py --desglose           qué se dibuja en cada parada y en qué se va el tiempo de procesador, y los
#                                         contadores (personas dibujadas, sombras rehechas, instancias, memoria);
#                                         con --contra, grupo a grupo antes y ahora
#   python3 banco.py --perfil --solo X    las funciones que más tiempo de procesador se llevan en la parada X
#   python3 banco.py --mismo-perfil       el mismo perfil de Chrome en todas las vueltas (como recargar la página: la
#                                         primera vuelta, con lo guardado vacío; las demás, con el relieve guardado)
#
# Guarda las cifras (resultados.json) y las capturas en .banco/<fecha-hora>/. No lo lances a la vez que probar.py
# ni que otro Chrome invisible: en este Mac, varios a la vez pueden colgarlo.
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
PORTS = {'ahora': 8798, 'antes': 8799}
CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
           '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
TIMEOUT = 720   # segundos por vuelta (con las doce paradas, en este Mac una vuelta va por los 7 minutos; por software, más)


def arg(name, default=None):
    a = sys.argv
    return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else default


CONTRA = arg('--contra')
LAPS = int(arg('--vueltas', '2' if CONTRA else '1'))
ONLY = arg('--solo')
PX = arg('--px', '1')
SIZE = arg('--tam', '1280x800')
SW = '--sw' in sys.argv
SAME_PROFILE = '--mismo-perfil' in sys.argv
OUT = os.path.join(HERE, '.banco', time.strftime('%Y%m%d-%H%M%S'))

lock = threading.Lock()
got = {}   # etiqueta → resultado de la vuelta en curso


def handler(root, label, inject):
    # Sirve una versión del juego sin caché y recoge lo que manda el banco. La versión de antes no sabe lanzar el banco:
    # se le añade a la página (se abre con ?modo=pruebas&parte=mirar, que le pone la cuenta de prueba y una partida
    # nueva) y src/banco.js sale siempre del código de ahora, para medir igual las dos.
    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=root, **k)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-cache')
            super().end_headers()

        def do_GET(self):
            path = self.path.split('?')[0]
            if path == '/src/banco.js' and root != HERE:
                return self.send_file(os.path.join(HERE, 'src', 'banco.js'), 'text/javascript')
            if inject and path in ('/', '/index.html'):
                with open(os.path.join(root, 'index.html'), encoding='utf-8') as f:
                    page = f.read()
                page = page.replace('</body>', INJECT + '</body>')
                return self.send_bytes(page.encode('utf-8'), 'text/html; charset=utf-8')
            super().do_GET()

        def send_file(self, p, kind):
            with open(p, 'rb') as f:
                self.send_bytes(f.read(), kind)

        def send_bytes(self, data, kind):
            self.send_response(200)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            n = int(self.headers.get('Content-Length') or 0)
            try:
                m = json.loads(self.rfile.read(n) or b'{}')
            except ValueError:
                m = {}
            path = self.path.split('?')[0]
            if path == '/banco/captura' and m.get('img', '').startswith('data:image/jpeg;base64,'):
                lap = got.get('lap', 0)
                name = re.sub(r'[^a-z0-9-]', '', m.get('parada', 'x'))
                with open(os.path.join(OUT, f'{label}-v{lap}-{name}.jpg'), 'wb') as f:
                    f.write(base64.b64decode(m['img'].split(',', 1)[1]))
            elif path == '/banco':
                with lock:
                    got[label] = m
            self.send_response(204)
            self.end_headers()

        def log_message(self, *a):
            pass
    return H


INJECT = """<script type="module">
  const t = setInterval(() => { const g = window.pueblo; if (g?.player) { clearInterval(t); import('./src/banco.js').then(m => m.runBench(g)); } }, 200);
</script>
"""


PERFIL = '--perfil' in sys.argv
DEBUG_PORT = 9333


class WS:
    # Lo justo de WebSocket (para hablar con Chrome por su protocolo de depuración, sin instalar nada)
    def __init__(self, url):
        import base64 as b64
        rest = url.split('://', 1)[1]
        hostport, path = rest.split('/', 1)
        host, port = hostport.split(':')
        self.s = socket.create_connection((host, int(port)))
        key = b64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.s.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]
        self.n = 0

    def read(self, k):
        while len(self.buf) < k:
            chunk = self.s.recv(1 << 16)
            if not chunk:
                raise ConnectionError('cerrado')
            self.buf += chunk
        out, self.buf = self.buf[:k], self.buf[k:]
        return out

    def send(self, method, params=None):
        self.n += 1
        data = json.dumps({'id': self.n, 'method': method, 'params': params or {}}).encode()
        mask = os.urandom(4)
        head = bytes([0x81]) + (bytes([0x80 | len(data)]) if len(data) < 126 else bytes([0x80 | 126]) + len(data).to_bytes(2, 'big') if len(data) < 65536 else bytes([0x80 | 127]) + len(data).to_bytes(8, 'big'))
        self.s.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        return self.n

    def recv(self):
        msg = b''
        while True:
            b0, b1 = self.read(2)
            k = b1 & 127
            if k == 126:
                k = int.from_bytes(self.read(2), 'big')
            elif k == 127:
                k = int.from_bytes(self.read(8), 'big')
            data = self.read(k)
            op = b0 & 15
            if op in (1, 0, 2):
                msg += data
                if b0 & 128:
                    return json.loads(msg)
            elif op == 8:
                raise ConnectionError('cerrado')


def cpu_profile(stop_event):
    # Se engancha a la página del banco y, entre 'perfil: empieza' y 'perfil: acaba', toma muestras del procesador
    import urllib.request
    for _ in range(100):
        try:
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{DEBUG_PORT}/json/list'))
            page = next(p for p in pages if p.get('type') == 'page' and 'banco=1' in p.get('url', ''))
            break
        except Exception:
            time.sleep(0.3)
    else:
        print('    perfil: no encuentro la página')
        return
    ws = WS(page['webSocketDebuggerUrl'])
    ws.send('Runtime.enable'); ws.send('Profiler.enable'); ws.send('Profiler.setSamplingInterval', {'interval': 250})
    stop_id = None
    while not stop_event.is_set():
        m = ws.recv()
        if m.get('method') == 'Runtime.consoleAPICalled':
            text = ' '.join(str(a.get('value', '')) for a in m['params'].get('args', []))
            if 'perfil: empieza' in text:
                ws.send('Profiler.start')
            elif 'perfil: acaba' in text:
                stop_id = ws.send('Profiler.stop')
        elif stop_id and m.get('id') == stop_id:
            show_profile(m['result']['profile'])
            return


def show_profile(p):
    nodes = {n['id']: n for n in p['nodes']}
    self_ms = {}
    for node, dt in zip(p['samples'], p['timeDeltas']):
        self_ms[node] = self_ms.get(node, 0) + dt / 1000
    total = sum(self_ms.values()) or 1
    by = {}
    for nid, ms in self_ms.items():
        cf = nodes[nid]['callFrame']
        name = cf['functionName'] or '(anónima)'
        where = os.path.basename(cf['url'].split('?')[0]) + (f":{cf['lineNumber'] + 1}" if cf['url'] else '')
        key = f'{name}  {where}'.strip()
        by[key] = by.get(key, 0) + ms
    print(f'\n  Perfil del procesador ({total:.0f} ms de muestras): lo que más se lleva, en tiempo propio')
    for key, ms in sorted(by.items(), key=lambda kv: -kv[1])[:30]:
        print(f'    {ms / total * 100:5.1f} %  {key}')


def chrome():
    return next((c for c in CHROMES if os.path.exists(c)), None) or shutil.which('google-chrome') or shutil.which('chromium')


def free(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) != 0


def run_once(exe, label, port, inject, profile):
    w, h = SIZE.split('x')
    query = ('modo=pruebas&parte=mirar&' if inject else '') + f'banco=1&px={PX}' + ('&perfil=1' if PERFIL else '') + (f"&diag={arg('--diag')}" if arg('--diag') else '') + (f'&solo={ONLY}' if ONLY else '') + (f"&ab={arg('--ab')}" if arg('--ab') else '')
    url = f'http://127.0.0.1:{port}/?{query}'
    gpu = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if SW else (['--use-angle=metal'] if sys.platform == 'darwin' else []) + ['--ignore-gpu-blocklist']
    p = subprocess.Popen([exe, '--headless=new', *gpu, '--mute-audio', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
                          '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars', f'--window-size={w},{h}',
                          f'--user-data-dir={profile}', '--enable-logging=stderr', '--v=0'] + ([f'--remote-debugging-port={DEBUG_PORT}'] if PERFIL else []) + [url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    errors = []

    def echo():   # (lo que va diciendo el banco, y los fallos)
        for line in p.stderr:
            t = line.decode('utf-8', 'replace')
            if 'CONSOLE' in t:
                msg = t.split('"', 1)[-1].rsplit('"', 1)[0].strip()
                if msg.startswith('BANCO ') and not msg.startswith('BANCO {'):
                    print(f'    [{label}] {msg[6:]}', flush=True)
                elif re.search(r'error|uncaught|fallo', msg, re.I):
                    errors.append(msg[:300])
    threading.Thread(target=echo, daemon=True).start()
    done_profiling = threading.Event()
    if PERFIL:
        threading.Thread(target=lambda: cpu_profile(done_profiling), daemon=True).start()
    t0 = time.time()
    try:
        while time.time() - t0 < TIMEOUT:
            with lock:
                if label in got:
                    return got.pop(label), errors
            if p.poll() is not None:
                print(f'    [{label}] Chrome se ha cerrado antes de terminar.')
                return None, errors
            time.sleep(0.5)
        print(f'    [{label}] Pasado el tiempo ({TIMEOUT} s) sin terminar.')
        return None, errors
    finally:
        if p.poll() is None:
            p.terminate()
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()


def table(runs):
    labels = [l for l in ('antes', 'ahora') if runs.get(l)]
    first = runs[labels[-1]][0]
    print(f"\nGráfica: {first['gpu']}\nLienzo {first['lienzo']} (px {first['px']}) · {len(runs[labels[-1]])} vuelta(s) · mediana de {first['lotes']} tandas de {first['n']} fotogramas por parada\n")

    def med(label, stop, key):
        vals = [s[key] for r in runs[label] for s in r['paradas'] if s['name'] == stop]
        return median(vals) if vals else None

    def same(label, key):
        vals = [r.get(key) for r in runs[label] if r.get(key) is not None]
        return median(vals) if vals else None
    stops = [s['name'] for s in first['paradas']]
    if len(labels) == 1:
        l = labels[0]
        print(f"{'parada':<16}{'ms':>7}{'fps':>7}{'sin sombras':>13}{'llamadas':>14}{'triángulos':>16}{'avanzar':>9}{'encargar':>10}")
        for s in stops:
            ms = med(l, s, 'ms')
            calls = '%.0f+%.0f' % (med(l, s, 'llamadas'), med(l, s, 'llamadasSombra'))
            tris = '%.0fk+%.0fk' % (med(l, s, 'triangulos') / 1000, med(l, s, 'triangulosSombra') / 1000)
            print(f"{s:<16}{ms:>7.1f}{1000 / ms:>7.1f}{med(l, s, 'msSinSombra'):>13.1f}{calls:>14}{tris:>16}{med(l, s, 'avanzar'):>9.2f}{med(l, s, 'encargar'):>10.2f}")
        if '--desglose' in sys.argv:   # (qué se lleva las llamadas en cada parada: normal / sombra)
            for s in stops:
                d = next(x for x in runs[l][0]['paradas'] if x['name'] == s).get('desglose') or {}
                keys = sorted(set(d.get('principal', {})) | set(d.get('sombra', {})), key=lambda k: -(d.get('principal', {}).get(k, [0])[0] + d.get('sombra', {}).get(k, [0])[0]))
                print(f'  {s}: ' + ', '.join(f"{k} {d.get('principal', {}).get(k, [0])[0]}/{d.get('sombra', {}).get(k, [0])[0]}" for k in keys))
                cpu = next(x for x in runs[l][0]['paradas'] if x['name'] == s).get('cpu') or {}
                print('    procesador (ms): ' + ', '.join(f'{k} {v}' for k, v in sorted(cpu.items(), key=lambda kv: -kv[1])))
                c = d.get('contadores')
                if c:
                    print('    ' + counters_line(c))
                p = next(x for x in runs[l][0]['paradas'] if x['name'] == s).get('personas')
                if p:
                    print('    personas (del juego): ' + ', '.join(f'{k} {v}' for k, v in p.items() if isinstance(v, (int, float))))
        print(f"\nListo en {same(l, 'arranque')} s · {same(l, 'programas')} programas · {same(l, 'texturas')} texturas ({same(l, 'vramMB')} MB en la gráfica, más {same(l, 'buferesMB')} MB de búferes) · {same(l, 'geometrias')} geometrías · {same(l, 'memoria')} MB de memoria")
        relief_line(runs, l)
        return
    print(f"{'parada':<16}{'ms antes':>10}{'ahora':>8}{'cambio':>9}   {'llamadas antes':>15}{'ahora':>12}   {'triángulos antes':>17}{'ahora':>14}")
    for s in stops:
        a, b = med('antes', s, 'ms'), med('ahora', s, 'ms')
        ca = f"{med('antes', s, 'llamadas'):.0f}+{med('antes', s, 'llamadasSombra'):.0f}"
        cb = f"{med('ahora', s, 'llamadas'):.0f}+{med('ahora', s, 'llamadasSombra'):.0f}"
        ta = f"{med('antes', s, 'triangulos') / 1000:.0f}k+{med('antes', s, 'triangulosSombra') / 1000:.0f}k"
        tb = f"{med('ahora', s, 'triangulos') / 1000:.0f}k+{med('ahora', s, 'triangulosSombra') / 1000:.0f}k"
        print(f"{s:<16}{a:>10.1f}{b:>8.1f}{(b - a) / a * 100:>+8.0f}%   {ca:>15}{cb:>12}   {ta:>17}{tb:>14}")
    warn_place(runs, stops)
    for key, name in (('arranque', 'listo en (s)'), ('programas', 'programas'), ('texturas', 'texturas'), ('vramMB', 'texturas (MB)'), ('buferesMB', 'búferes (MB)'), ('geometrias', 'geometrías'), ('memoria', 'memoria (MB)')):
        print(f"{name:<16}{str(same('antes', key)):>10}{str(same('ahora', key)):>10}")
    for l in ('antes', 'ahora'):
        relief_line(runs, l)
    if '--desglose' in sys.argv:
        compare_breakdown(runs, stops)


def relief_line(runs, label):
    # El relieve, vuelta a vuelta: cuánto tardó en estar listo y cuántos bloques salieron de lo guardado (con
    # --mismo-perfil, la primera vuelta sale fría y las demás calientes)
    laps = [r for r in runs.get(label, []) if r.get('relieve')]
    if not laps:
        return
    def one(r):
        v = r['relieve']
        hit = f"{v.get('hits', 0):.0f} guardados ({v.get('msHit', 0) / max(1, v.get('hits', 0)):.1f} ms)"
        calc = f"{v.get('calc', 0):.0f} calculados ({v.get('msCalc', 0) / max(1, v.get('calc', 0)):.1f} ms)"
        return f"listo en {r.get('arranque')} s, {hit}, {calc}"
    print(f'relieve ({label}): ' + ' · '.join(f'vuelta {i + 1}: {one(r)}' for i, r in enumerate(laps)))


def warn_place(runs, stops):
    # Con --contra: si las dos versiones no han medido en el mismo sitio (las paradas que se buscan, bosque y pradera,
    # salen del mundo: si gen.js cambia, pueden caer en otro trozo) o en la misma estación, la comparación no vale
    def first(label, key, s=None):
        r = runs[label][0]
        if s is None:
            return r.get(key)
        return next((x.get(key) for x in r['paradas'] if x['name'] == s), None)
    ea, eb = first('antes', 'estacion'), first('ahora', 'estacion')
    if ea is not None and eb is not None and ea != eb:
        print(f'\n¡Ojo! Estación distinta (antes {ea}, ahora {eb}): la hierba y los árboles no son los mismos.')
    for s in stops:
        a, b = first('antes', 'at', s), first('ahora', 'at', s)
        if a and b and (abs(a[0] - b[0]) > 0.05 or abs(a[1] - b[1]) > 0.05):
            print(f'¡Ojo! {s}: antes en {a[0]:g},{a[1]:g} y ahora en {b[0]:g},{b[1]:g}: no se ha medido el mismo sitio.')


def counters_line(c):
    # Los contadores pasivos de una parada (src/banco.js, counters), en una línea
    p, a, sh = c.get('personas', {}), c.get('animales', {}), c.get('sombras', {})
    mo = c.get('monstruos') or {}
    inst = ', '.join(f'{k} {v}' for k, v in sorted((c.get('instancias') or {}).items(), key=lambda kv: -kv[1]))
    m = c.get('memoria', {})
    return (f"personas {p.get('dibujadas')} dibujadas de {p.get('modelos')} ({p.get('enSombra')} en sombra) · animales {a.get('dibujados')} de {a.get('modelos')}"
            + (f" · monstruos {mo.get('dibujados')} de {mo.get('modelos')}" if mo.get('modelos') else '')
            + f" · sombras {sh.get('rehechasPorFotograma')}/fotograma, {sh.get('llamadasPorFotograma')} llamadas y {sh.get('triangulosPorFotograma', 0) / 1000:.0f}k triángulos"
            f" · instancias: {inst or '-'} · {m.get('geometrias')} geometrías, {m.get('texturas')} texturas"
            + (f" ({m.get('vramMB')} MB)" if m.get('vramMB') is not None else '') + f", {m.get('programas')} programas")


def compare_breakdown(runs, stops):
    # Con --contra --desglose: por parada, las llamadas y los triángulos de cada grupo en la pasada normal y en la de
    # sombra (antes → ahora), el procesador por partes (mediana de las vueltas) y los contadores. Lo que se dibuja no
    # cambia de una vuelta a otra: sale de la primera
    def stop_of(label, s, lap=0):
        return next((x for x in runs[label][lap]['paradas'] if x['name'] == s), None)

    def cpu_med(label, s):
        parts = {}
        for r in runs[label]:
            for k, v in (next((x for x in r['paradas'] if x['name'] == s), {}).get('cpu') or {}).items():
                parts.setdefault(k, []).append(v)
        return {k: median(v) for k, v in parts.items()}
    print('\nDesglose (llamadas/triángulos de cada grupo, antes → ahora; normal | sombra)')
    for s in stops:
        a, b = stop_of('antes', s), stop_of('ahora', s)
        if not a or not b:
            continue
        da, db = a.get('desglose') or {}, b.get('desglose') or {}
        print(f'  {s}:')
        groups = set()
        for d in (da, db):
            for side in ('principal', 'sombra'):
                groups |= set(d.get(side, {}))

        def cell(d, side, g):
            e = d.get(side, {}).get(g, [0, 0])
            return f'{e[0]}/{e[1] / 1000:.0f}k'
        weight = lambda g: -max(db.get('principal', {}).get(g, [0, 0])[1], da.get('principal', {}).get(g, [0, 0])[1])
        for g in sorted(groups, key=weight):
            print(f"    {g:<16}{cell(da, 'principal', g):>13} → {cell(db, 'principal', g):<13} | {cell(da, 'sombra', g):>11} → {cell(db, 'sombra', g)}")
        ca, cb = cpu_med('antes', s), cpu_med('ahora', s)
        keys = sorted(set(ca) | set(cb), key=lambda k: -max(ca.get(k, 0), cb.get(k, 0)))
        num = lambda x: '-' if x is None else f'{x:g}'
        print('    procesador (ms): ' + ', '.join(f'{k} {num(ca.get(k))}→{num(cb.get(k))}' for k in keys))
        for label, d in (('antes', da), ('ahora', db)):
            if d.get('contadores'):
                print(f'    {label}: ' + counters_line(d['contadores']))
        # (los contadores de las personas que guarda el propio juego, si alguna versión los lleva)
        pa, pb = a.get('personas') or {}, b.get('personas') or {}
        keys = [k for k in dict.fromkeys([*pa, *pb]) if isinstance(pa.get(k, pb.get(k)), (int, float))]
        if keys:
            print('    personas (del juego): ' + ', '.join(f'{k} {num(pa.get(k))}→{num(pb.get(k))}' for k in keys))


def main():
    if '-h' in sys.argv or '--help' in sys.argv:   # la ayuda es la cabecera de este archivo
        with open(__file__, encoding='utf-8') as f:
            for line in f:
                if not line.startswith('#'):
                    break
                print(line[2:].rstrip())
        return 0
    exe = chrome()
    if not exe:
        print('No encuentro Chrome (ni Chromium, Brave o Edge).')
        return 2
    if not free(8797):
        print('Parece que probar.py está en marcha (el puerto 8797 está ocupado): espera a que termine.')
        return 2
    for label in PORTS:
        if (label == 'ahora' or CONTRA) and not free(PORTS[label]):
            print(f'El puerto {PORTS[label]} está ocupado: cierra lo que lo use.')
            return 2
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='miniverse-banco-')
    servers = []
    try:
        trees = {'ahora': (HERE, False)}
        if CONTRA:   # (la otra versión, sacada de git a una carpeta aparte)
            old = os.path.join(tmp, 'antes')
            os.makedirs(old)
            archive = subprocess.run(['git', '-C', HERE, 'archive', CONTRA], capture_output=True)
            if archive.returncode:
                print(f'No encuentro la versión {CONTRA}: ' + archive.stderr.decode().strip())
                return 2
            subprocess.run(['tar', '-x', '-C', old], input=archive.stdout, check=True)
            with open(os.path.join(old, 'src', 'main.js'), encoding='utf-8') as f:
                knows = 'banco.js' in f.read()
            trees['antes'] = (old, not knows)
        for label, (root, inject) in trees.items():
            s = ThreadingHTTPServer(('127.0.0.1', PORTS[label]), handler(root, label, inject))
            threading.Thread(target=s.serve_forever, daemon=True).start()
            servers.append(s)
        order = [l for l in ('antes', 'ahora') if l in trees]
        runs = {l: [] for l in order}
        print(f"Banco en Chrome invisible ({os.path.basename(exe)}{', por software' if SW else ', con la gráfica'}): {LAPS} vuelta(s){' de cada versión, turnándose' if CONTRA else ''}…", flush=True)
        for lap in range(1, LAPS + 1):
            for label in order:
                got['lap'] = lap
                print(f'  Vuelta {lap}, {label}{f" ({CONTRA})" if label == "antes" else ""}…', flush=True)
                res, errors = run_once(exe, label, PORTS[label], trees[label][1], os.path.join(tmp, label if SAME_PROFILE else f'{label}-{lap}'))
                for e in errors[:5]:
                    print(f'    [{label}] fallo: {e}')
                if res:
                    runs[label].append(res)
                time.sleep(2)
        with open(os.path.join(OUT, 'resultados.json'), 'w', encoding='utf-8') as f:
            json.dump({'contra': CONTRA, 'px': PX, 'tam': SIZE, 'sw': SW, 'vueltas': runs}, f, ensure_ascii=False, indent=1)
        if not all(runs.values()):
            print('\nAlguna versión no ha terminado ninguna vuelta: no hay tabla.')
            return 1
        table(runs)
        print(f'\nCifras y capturas en {os.path.relpath(OUT, HERE)}/')
        return 0
    finally:
        for s in servers:
            s.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
