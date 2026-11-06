# Pruebas automáticas: abre el juego en un Chrome invisible (como hace multijugador.py con el mundo del servidor) y
# deja que src/pruebas.js juegue y compruebe lo básico. Con dos jugadores (lo normal), además abre un relay de
# pruebas (multijugador.py en el puerto 8795, sin túnel ni mundo del servidor, con sus datos en una carpeta
# temporal: no toca los del servidor de verdad) y dos juegos que comparten mundo.
#
#   python3 probar.py          todas las pruebas (un jugador y dos jugadores)
#   python3 probar.py --solo   solo las de un jugador
#   python3 probar.py --dos    solo las de dos jugadores
#   python3 probar.py --ver    enseña además lo que dice la consola de cada juego
#
# Termina con 0 si todo ha ido bien y con 1 si algo falla (para poder ponerlo antes de publicar).
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_PORT, RELAY_PORT = 8797, 8795
CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
           '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
TIMEOUT = 720   # segundos para todas las pruebas (con dos Chromes por software todo va despacio)
SOLO = '--solo' in sys.argv
DOS = '--dos' in sys.argv   # (solo las de dos jugadores: para probarlas)
VERBOSE = '--ver' in sys.argv

results = []     # { who, name, ok, detail }
done = set()     # quién ha terminado ('a', 'b')
fail_main = 0    # cuántas veces más responder con un error al pedir src/main.js (para probar que el arranque se recupera)
lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    # Sirve el juego sin caché y recibe los resultados (POST /pruebas)
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        global fail_main
        if self.path.split('?')[0] == '/src/main.js':
            with lock:
                fail = fail_main > 0
                fail_main -= fail
            if fail:
                self.send_error(503)
                return
        super().do_GET()

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        try:
            m = json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            m = {}
        with lock:
            if m.get('fin'):
                done.add(m.get('who'))
            elif 'name' in m:
                results.append(m)
                print(f"  {'OK' if m['ok'] else 'KO'}  [{m.get('who')}] {m['name']}" + (f"  · {m['detail']}" if m.get('detail') else ''), flush=True)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *a):
        pass


def chrome():
    return next((c for c in CHROMES if os.path.exists(c)), None) or shutil.which('google-chrome') or shutil.which('chromium')


def free(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) != 0


def wait_port(port, secs):
    for _ in range(secs * 10):
        if not free(port):
            return True
        time.sleep(0.1)
    return False


def open_game(exe, who, profile_dir, part='solo', relay=None):
    url = f'http://127.0.0.1:{WEB_PORT}/?modo=pruebas&q=low&quien={who}&parte={part}' + (f'&relay={quote(relay, safe="")}' if relay else '')
    # (sin ventana ni gráfica: el dibujo va por software; sin frenar los temporizadores aunque no se vea)
    p = subprocess.Popen([exe, '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--no-first-run',
                          '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
                          '--disable-backgrounding-occluded-windows', '--window-size=640,480', f'--user-data-dir={profile_dir}']
                         + (['--enable-logging=stderr', '--v=0'] if VERBOSE else []) + [url],
                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE if VERBOSE else subprocess.DEVNULL)
    if VERBOSE:   # (lo que dice la consola del juego, línea a línea)
        def echo():
            for line in p.stderr:
                t = line.decode('utf-8', 'replace')
                if 'CONSOLE' in t:
                    print(f'    [{who}] ' + t.split('"', 1)[-1].rsplit('"', 1)[0].strip(), flush=True)
        threading.Thread(target=echo, daemon=True).start()
    return p


def main():
    exe = chrome()
    if not exe:
        print('No encuentro Chrome (ni Chromium, Brave o Edge).')
        return 2
    for port in (WEB_PORT,) + (() if SOLO else (RELAY_PORT,)):
        if not free(port):
            print(f'El puerto {port} está ocupado: cierra lo que lo use (o prueba con --solo).')
            return 2
    tmp = tempfile.mkdtemp(prefix='miniverse-pruebas-')
    server = ThreadingHTTPServer(('127.0.0.1', WEB_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    procs = []
    try:
        relay = None
        if not SOLO:
            procs.append(subprocess.Popen([sys.executable, os.path.join(HERE, 'multijugador.py'), '--puerto', str(RELAY_PORT), '--sin-tunel', '--sin-mundo', '--sin-navegador',
                                           '--datos', os.path.join(tmp, 'relay')], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            if not wait_port(RELAY_PORT, 15):
                print('El relay de pruebas no arranca.')
                return 2
            relay = f'ws://127.0.0.1:{RELAY_PORT}'
        # Primero un jugador solo; luego (si toca) dos a la vez compartiendo el mundo por el relay
        rounds = [] if DOS else [('un jugador', [('a', 'solo', None)])]
        if not SOLO:
            rounds.append(('dos jugadores', [('a', 'dos', relay), ('b', 'dos', relay)]))
        finished = True
        for label, players in rounds:
            print(f'Pruebas de {label} en Chrome invisible ({os.path.basename(exe)})…', flush=True)
            # (la primera vez, el servidor falla al dar el código del juego: tiene que recuperarse recargando solo)
            if label == 'un jugador':
                global fail_main
                fail_main = 2
            games = []
            for who, part, url in players:
                games.append(open_game(exe, who, os.path.join(tmp, f'{who}-{part}'), part, url))
                time.sleep(3)   # (el anfitrión entra antes que el invitado)
            want, t0 = {who for who, _, _ in players}, time.time()
            with lock:
                done.clear()
            while time.time() - t0 < TIMEOUT:
                with lock:
                    if want <= done:
                        break
                if any(p.poll() is not None for p in games):
                    print('Chrome se ha cerrado antes de terminar.')
                    break
                time.sleep(0.3)
            else:
                print(f'Pasado el tiempo ({TIMEOUT} s): no han terminado ' + ', '.join(sorted(want - done)) + '.')
            if not want <= done:
                finished = False
            for p in games:
                if p.poll() is None:
                    p.terminate()
            procs.extend(games)
        if not DOS:
            results.append({'who': 'a', 'name': 'arranque: se recupera de un error al cargar', 'ok': fail_main == 0})
            print(f"  {'OK' if fail_main == 0 else 'KO'}  [a] arranque: se recupera de un error al cargar", flush=True)
        ok = [r for r in results if r['ok']]
        ko = [r for r in results if not r['ok']]
        print(f'\n{len(ok)} bien, {len(ko)} mal' + ('' if finished else ' (y pruebas sin terminar)'))
        return 0 if not ko and finished else 1
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        server.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
