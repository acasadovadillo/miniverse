# Servidor para jugar juntos en directo. Es un repetidor de mensajes (WebSocket): lo que manda cada jugador
# se lo pasa a los demás. No entiende lo que reparte, porque el juego cifra sus mensajes con la clave del
# mundo, que solo tienen las cuentas; aquí solo se ve a quién va cada uno.
#
# Para que se pueda entrar desde otra casa abre un túnel con cloudflared (gratis y sin cuenta: una dirección
# https://….trycloudflare.com que cambia cada vez) y abre el juego en el navegador ya conectado a él. El
# juego del admin publica esa dirección en GitHub y así los demás la encuentran al iniciar sesión. Mientras
# esté abierto se puede jugar en el mundo aunque el admin no esté jugando: lo lleva el juego del primero que entra.
#
#   python3 multijugador.py              servidor, túnel y el juego abierto
#   python3 multijugador.py --sin-tunel  solo el servidor, en ws://localhost:8790 (para probar en este ordenador)
#   --sin-mundo                          sin el mundo del servidor (lo lleva el primero que entra a jugar)
#   --juego <dirección>                  el juego que se abre para jugar (por omisión, el publicado)
#   --puerto <n>                         otro puerto (por omisión, 8790; el juego para el mundo del servidor, el siguiente)
#   --datos <carpeta>                    dónde guardar los op, los vetos, las copias… (por omisión, junto a este archivo)
#   --sin-navegador                      no abrir el juego en el navegador (lo que habría que abrir sale en el terminal)
#
# Además abre el mundo del servidor: el mismo juego en un Chrome invisible (sin dibujo ni jugador visible) que lleva
# el mundo compartido mientras esto esté abierto, aunque no juegue nadie, como un servidor de Minecraft: hace pasar
# la hora y crecer los cultivos, reparte los cambios, no deja los que no tocan y lo guarda (cifrado). Ese juego lo
# sirve este programa desde esta carpeta, solo para este ordenador (http://127.0.0.1:8791). Para llevar el mundo
# necesita la clave del mundo y el token del admin para guardarlo en GitHub: se los da el juego del admin la primera
# vez que entra con la pestaña que se abre (o tras /link), siempre dentro de este ordenador (nunca por el
# túnel), y quedan en servidor-secretos.json, junto a los op.
#
# Mientras está abierto, en su terminal se escriben los comandos del servidor (como en Minecraft; /help los
# lista): op y deop (los op pueden usar los comandos del juego: /gamemode, /tp, /give…), kick, ban y pardon, la
# lista blanca, list, say, tp, save-all, save-off y save-on, setidletimeout, tps y stop. Y, como en la consola de
# Minecraft, cualquier comando del juego (/time, /weather, /give, /fill…): lo ejecuta el mundo del servidor. Cada juego dice al entrar de qué cuenta es (el servidor no lee nada
# más). Los op, los vetados y la lista blanca se guardan en ops.json, banned.json y whitelist.json, junto a este
# archivo, y las copias del mundo (cifradas: el servidor no puede abrirlas) en backups/.
#
# Solo usa la biblioteca estándar de Python. El túnel necesita cloudflared: brew install cloudflared
import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from urllib.parse import quote

from urllib.parse import unquote


def option(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv[:-1] else default


PORT = int(option('--puerto', 8790))
WEB_PORT = PORT + 1   # el juego, para el mundo del servidor: solo en este ordenador (el túnel no llega)
GAME = option('--juego', 'https://acasadovadillo.github.io/miniverse/')
LOCAL_GAME = f'http://127.0.0.1:{WEB_PORT}/'
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'   # el de la norma de WebSocket, para responder al saludo
MAX = 32 * 1024 * 1024                          # el mensaje más grande que se acepta (el mundo entero cabe de sobra)

peers = {}        # número de conexión → su escritor
next_id = 1
HERE = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))   # (el juego, que se sirve al mundo del servidor)
DATA = os.path.abspath(option('--datos', HERE))
os.makedirs(DATA, exist_ok=True)
OPS_FILE, BANS_FILE, WHITE_FILE = (os.path.join(DATA, n) for n in ('ops.json', 'banned.json', 'whitelist.json'))
BACKUPS = os.path.join(DATA, 'backups')
BACKUP_EVERY = 15 * 60   # segundos: como mucho, una copia del mundo cada tanto (la manda el juego que lo lleva)
BACKUP_KEEP = 48         # las copias que se guardan (las más antiguas se borran)
IDENT_WAIT = 10          # con la lista blanca puesta, lo que se espera a que un juego diga de qué cuenta es


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


ops = {str(u).lower() for u in load_json(OPS_FILE, [])}   # las cuentas op (su usuario, en minúsculas)
bans = {str(u).lower(): str(r) for u, r in load_json(BANS_FILE, {}).items()}   # vetadas → el motivo
white = load_json(WHITE_FILE, {'enabled': False, 'users': []})                  # la lista blanca
white = {'enabled': bool(white.get('enabled')), 'users': sorted({str(u).lower() for u in white.get('users', [])})}
users = {}           # número de conexión → la cuenta que ha dicho su juego
SECRETS_FILE = os.path.join(DATA, 'servidor-secretos.json')
SETTINGS_FILE = os.path.join(DATA, 'ajustes.json')   # (lo que se pone con comandos del terminal y se queda: /setidletimeout)
CHROME_DIR = os.path.join(DATA, 'servidor-chrome')
WEB_FILES = re.compile(r'^(index\.html|accounts\.json|src/[\w/.-]+\.js)$')   # lo único que se sirve
WEB_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json'}
CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
           '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
PASE = base64.urlsafe_b64encode(os.urandom(18)).decode()   # lo que enseña el mundo del servidor para que se le den las claves
world_keys = load_json(SECRETS_FILE, None)   # { key, token }: la clave del mundo y con qué guardarlo
link_until = 0       # (tras /link, hasta cuándo se aceptan claves nuevas)
settings = load_json(SETTINGS_FILE, {}) if os.path.exists(SETTINGS_FILE) else {}
autosave = True      # (/save-off y /save-on)
servers = set()      # las conexiones del mundo del servidor
local = set()        # las conexiones desde este ordenador (no por el túnel): solo a ellas se les piden o dan claves
chrome = None        # su proceso
world_task = None
last_backup = 0
tunnel_url = None    # wss://… del túnel, cuando lo hay
stop_asked = False   # (Ctrl+C)
stop_asked_at = 0    # cuándo se pidió cerrar
stopping = None      # (se avisa para cerrar el servidor: /stop)


def frame(op, data):
    n = len(data)
    head = bytes([0x80 | op])
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack('>H', n)
    else:
        head += bytes([127]) + struct.pack('>Q', n)
    return head + data


def unmask(data, mask):
    if not data:
        return data
    n = len(data)
    key = int.from_bytes((mask * (n // 4 + 1))[:n], 'big')
    return (int.from_bytes(data, 'big') ^ key).to_bytes(n, 'big')


async def messages(reader, writer):
    # Va dando los mensajes de texto completos (juntando los trozos); contesta a los ping y para al cerrar
    parts, kind = [], None
    while True:
        b1, b2 = await reader.readexactly(2)
        fin, op, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
        if n == 126:
            n = struct.unpack('>H', await reader.readexactly(2))[0]
        elif n == 127:
            n = struct.unpack('>Q', await reader.readexactly(8))[0]
        if n > MAX:
            return
        mask = await reader.readexactly(4) if b2 & 0x80 else None
        data = await reader.readexactly(n)
        if mask:
            data = unmask(data, mask)
        if op == 8:                      # cerrar
            writer.write(frame(8, data[:2]))
            return
        if op == 9:                      # ping
            writer.write(frame(10, data))
            continue
        if op == 10:                     # pong
            continue
        if op in (1, 2):
            parts, kind = [data], op
        elif op == 0 and kind:
            parts.append(data)
        if fin and kind:
            whole = b''.join(parts)
            parts, kind = [], None
            if len(whole) <= MAX:
                yield whole


def send(peer_id, obj):
    w = peers.get(peer_id)
    if w and not w.is_closing():
        w.write(frame(1, json.dumps(obj, separators=(',', ':')).encode()))


def everyone(obj):
    for p in list(peers):
        send(p, obj)


def kick(peer_id, reason):
    # Se le dice por qué (su juego lo enseña y deja de reconectar) y se cierra su conexión
    send(peer_id, {'t': 'kicked', 'reason': reason})
    w = peers.get(peer_id)
    if w:
        w.close()


def refused(user):
    # Por qué no puede entrar esa cuenta (o None si puede)
    if user in bans:
        return f'Estás vetado en este servidor{": " + bans[user] if bans[user] else ""}.'
    if white['enabled'] and user not in white['users']:
        return 'No estás en la lista blanca de este servidor.'
    return None


async def check_ident(peer_id):
    # Con la lista blanca puesta, quien no dice de qué cuenta es (un juego de antes) no se queda
    await asyncio.sleep(IDENT_WAIT)
    if peer_id in peers and peer_id not in users and peer_id not in servers and white['enabled']:
        kick(peer_id, 'Este servidor tiene lista blanca: actualiza el juego (recarga la página).')


def backup(data):
    global last_backup
    now = time.time()
    if now - last_backup < BACKUP_EVERY:
        return
    try:
        raw = base64.b64decode(data, validate=True)
    except ValueError:
        return
    os.makedirs(BACKUPS, exist_ok=True)
    name = time.strftime('mundo-%Y-%m-%d_%H-%M.enc')
    with open(os.path.join(BACKUPS, name), 'wb') as f:
        f.write(raw)
    last_backup = now
    old = sorted(n for n in os.listdir(BACKUPS) if n.startswith('mundo-') and n.endswith('.enc'))
    for n in old[:-BACKUP_KEEP]:
        os.remove(os.path.join(BACKUPS, n))
    print(f'  Copia del mundo: backups/{name} ({len(raw) // 1024} KB)')


async def handle(reader, writer):
    global next_id
    # La petición: el WebSocket del juego o una visita normal (para comprobar que el servidor está en marcha)
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
    except Exception:
        writer.close()
        return
    lines = head.decode('latin-1').split('\r\n')
    headers = {k.strip().lower(): v.strip() for k, _, v in (l.partition(':') for l in lines[1:] if ':' in l)}
    key = headers.get('sec-websocket-key')
    if not key or 'websocket' not in headers.get('upgrade', '').lower():
        body = 'Servidor de Miniverse para jugar juntos: en marcha.\n'.encode()
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\n'
                     b'Content-Length: %d\r\nConnection: close\r\n\r\n' % len(body) + body)
        await writer.drain()
        writer.close()
        return
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                  'Sec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
    me, next_id = next_id, next_id + 1
    others = list(peers)
    peers[me] = writer
    # (por el túnel llega con el nombre del túnel y sus cabeceras; desde este ordenador, a 127.0.0.1 o localhost)
    if headers.get('host', '').rsplit(':', 1)[0] in ('127.0.0.1', 'localhost') and not any(k.startswith('cf-') for k in headers):
        local.add(me)
    send(me, {'t': 'you', 'id': me, 'peers': others, 'ops': sorted(ops), 'need': me in local and need_keys(),
              'servers': sorted(servers), 'idle': settings.get('idle', 0), 'autosave': autosave})
    for p in others:
        send(p, {'t': 'join', 'id': me})
    print(f'  + Se ha conectado alguien ({len(peers)} conectados)')
    waiting = asyncio.create_task(check_ident(me))
    try:
        async for raw in messages(reader, writer):
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            # (de qué cuenta es: para los op, los vetos y la lista blanca; y la copia del mundo, que va cifrada)
            if msg.get('t') == 'ident' and isinstance(msg.get('user'), str):
                user = msg['user'].lower()[:32]
                first = me not in users
                users[me] = user
                why = refused(user)
                if why:
                    print(f'  ! {user} no puede entrar: {why}')
                    kick(me, why)
                elif first:
                    print(f'  + {user} ha entrado')
                continue
            if msg.get('t') == 'backup' and me in users and isinstance(msg.get('d'), str):
                backup(msg['d'])
                continue
            # El mundo del servidor enseña su pase y recibe las claves; el juego del admin se las da; y lo que va
            # contando el mundo del servidor sale aquí
            if msg.get('t') == 'pase' and msg.get('pase') == PASE and me in local:
                first = me not in servers
                servers.add(me)
                users[me] = 'servidor'
                send(me, {'t': 'secretos', **(world_keys or {}), 'tunnel': tunnel_url})
                if first:
                    print('  + El mundo del servidor está conectado')
                    everyone({'t': 'servers', 'ids': sorted(servers)})   # (los juegos solo se fían del mundo del servidor que diga esto)
                continue
            if msg.get('t') == 'idle' and me not in servers and settings.get('idle'):
                mins = f'{settings["idle"]} minuto{"" if settings["idle"] == 1 else "s"}'
                print(f'  {users.get(me, "Alguien")} lleva {mins} sin moverse: fuera')
                kick(me, f'Te han echado por estar {mins} sin moverte.')
                continue
            if msg.get('t') == 'secrets' and me in local and me in users and need_keys():
                take_keys(msg, me)
                continue
            if msg.get('t') == 'log' and me in servers and isinstance(msg.get('text'), str):
                print(f'  [mundo] {msg["text"][:300]}')
                continue
            if msg.get('t') == 'saved' and me in servers and stop_asked_at:
                # (cerrando: el mundo ya está guardado; se espera lo justo a que guarden los demás)
                asyncio.get_running_loop().call_later(max(0, 3 - (time.time() - stop_asked_at)), shutdown)
                continue
            if msg.get('t') != 'msg':
                continue
            out = {'t': 'msg', 'from': me}
            for k in ('d', 'p'):
                if k in msg:
                    out[k] = msg[k]
            to = msg.get('to')   # (sin destinatario, a todos los demás)
            for p in [p for p in peers if p != me] if to is None else [to] if to in peers else []:
                send(p, out)
            await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        waiting.cancel()
        peers.pop(me, None)
        who = users.pop(me, None)
        local.discard(me)
        was_server = me in servers
        servers.discard(me)
        for p in list(peers):
            send(p, {'t': 'leave', 'id': me})
        writer.close()
        if was_server:
            print('  - El mundo del servidor se ha desconectado')
            everyone({'t': 'servers', 'ids': sorted(servers)})
        else:
            print(f'  - {who + " se ha ido" if who else "Se ha ido alguien"} ({len(peers)} conectados)')


async def tunnel():
    # Abre el túnel y devuelve su dirección (https://…) cuando ya está registrado en Cloudflare. Antes no se
    # puede ni preguntar por ella: el nombre todavía no existe y el ordenador se queda un minuto creyendo que
    # no existe. El proceso sigue abierto mientras dure el servidor.
    exe = shutil.which('cloudflared')
    if not exe:
        print('Falta cloudflared, que abre el túnel para que se pueda entrar desde otra casa. Instálalo con:\n\n'
              '    brew install cloudflared\n\no prueba solo en este ordenador con: python3 multijugador.py --sin-tunel')
        sys.exit(1)
    # (por http2, que pasa por donde pasa la web; QUIC va por UDP y en algunas redes está cortado)
    proc = await asyncio.create_subprocess_exec(exe, 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', f'http://127.0.0.1:{PORT}',
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    async def registered():
        url = None
        while True:
            line = (await proc.stdout.readline()).decode(errors='replace')
            if not line:
                print('cloudflared se ha cerrado sin abrir el túnel.')
                sys.exit(1)
            m = re.search(r'https://[-a-z0-9]+\.trycloudflare\.com', line)
            url = url or (m and m.group(0))
            if url and 'Registered tunnel connection' in line:
                return url
    try:
        url = await asyncio.wait_for(registered(), 90)
    except asyncio.TimeoutError:
        print('El túnel no ha llegado a abrirse. ¿Hay conexión a internet?')
        sys.exit(1)
    async def drain():                   # (lo que siga escribiendo cloudflared, que no se atasque)
        while await proc.stdout.readline():
            pass
    asyncio.create_task(drain())
    return proc, url


def answers(url):
    # ¿Responde ya este servidor por el túnel? (recién abierto, Cloudflare tarda un poco en encontrarlo)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Miniverse'}), timeout=5) as r:
            return b'Miniverse' in r.read()
    except Exception:
        return False


async def ready(url, limit=60):
    for _ in range(limit // 3):
        await asyncio.sleep(1)
        if await asyncio.to_thread(answers, url):
            return True
        await asyncio.sleep(2)
    return False


HELP = '''  Comandos del servidor:
    /op <usuario>, /deop <usuario>, /op list  dar o quitar los comandos de op, y quién los tiene
    /kick <usuario> [motivo]                  echar a alguien (puede volver a entrar)
    /ban <usuario> [motivo], /pardon <usuario>, /banlist   vetar, quitar el veto y ver los vetados
    /whitelist on|off|add <usuario>|remove <usuario>|list  la lista blanca (puesta, solo entran los de la lista)
    /list                                     quién está conectado
    /say <texto>                              un aviso en el chat de todos
    /tp <usuario> <usuario>, /tp <usuario> home   llevar a alguien adonde está otro, o a su casa (@a: todos; también /teleport)
    /save-off, /save-on                       dejar de guardar el mundo (para copiarlo a mano) y volver a guardarlo
    /setidletimeout <minutos>                 echar a quien lleve esos minutos sin moverse (0: nunca)
    /tps                                      cómo va el mundo del servidor (pasos por segundo)
    y cualquier comando del juego (/time, /weather, /gamerule, /give, /gamemode, /kill, /fill, /locate…): lo
    ejecuta el mundo del servidor, que es op (tiene que estar abierto)
    /save-all                                 que todos guarden ya (quien lleva el mundo, también el mundo)
    /world                                    cómo está el mundo del servidor
    /link                                     pedir otra vez las claves del mundo al juego del admin (5 minutos)
    /stop                                     guardar y cerrar el servidor (también con Ctrl+C)
    /help                                     esta lista'''


def forward(line):
    # Un comando del juego escrito en el terminal: lo ejecuta el mundo del servidor (lo que cuenta sale como [mundo])
    text = '/' + line.strip().lstrip('/')
    for c in sorted(servers)[:1]:
        send(c, {'t': 'cmd', 'text': text})


def need_keys():
    return world_keys is None or time.time() < link_until


def take_keys(msg, sender=None):
    # Las claves que da el juego del admin: la del mundo (32 bytes) y el token con que guardarlo
    global world_keys, link_until
    try:
        if len(base64.b64decode(msg.get('key', ''), validate=True)) != 32:
            return
    except ValueError:
        return
    token = msg.get('token') if isinstance(msg.get('token'), str) else None
    world_keys = {'key': msg['key'], 'token': token}
    save_json(SECRETS_FILE, world_keys)
    os.chmod(SECRETS_FILE, 0o600)
    link_until = 0
    print(f'  Claves del mundo recibidas (de {users.get(sender, "?")}) y guardadas en servidor-secretos.json')
    if chrome and chrome.returncode is None:
        chrome.terminate()   # (vuelve a abrirse solo, ya con las nuevas)
    start_world()


async def web(reader, writer):
    # El juego para el mundo del servidor (y para darle las claves): solo en este ordenador, y solo sus archivos
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
        method, target = head.decode('latin-1').split('\r\n')[0].split(' ')[:2]
        path = unquote(target.split('?')[0]).lstrip('/') or 'index.html'
        full = os.path.realpath(os.path.join(HERE, path))
        if method == 'GET' and WEB_FILES.match(path) and '..' not in path and full.startswith(HERE + os.sep) and os.path.isfile(full):
            with open(full, 'rb') as f:
                body = f.read()
            status, kind = '200 OK', WEB_TYPES[os.path.splitext(path)[1]]
        else:
            body, status, kind = b'No encontrado\n', '404 Not Found', 'text/plain; charset=utf-8'
        writer.write(f'HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {len(body)}\r\n'
                     f'Cache-Control: no-cache\r\nConnection: close\r\n\r\n'.encode() + body)
        await writer.drain()
    except Exception:
        pass
    finally:
        writer.close()


def stale_chrome():
    # Un mundo del servidor de otra vez que se quedó abierto (se cerró este programa de golpe): se cierra
    # (solo si ese proceso es de verdad un Chrome con la carpeta del mundo del servidor)
    try:
        pid = int(os.readlink(os.path.join(CHROME_DIR, 'SingletonLock')).rsplit('-', 1)[1])
        cmd = subprocess.run(['ps', '-o', 'command=', '-p', str(pid)], capture_output=True, text=True).stdout
        if f'--user-data-dir={CHROME_DIR}' in cmd:
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
    except (OSError, ValueError, IndexError):
        pass


def find_chrome():
    return next((c for c in CHROMES if os.path.exists(c)), None) or shutil.which('google-chrome') or shutil.which('chromium')


async def world_loop():
    # El mundo del servidor: el juego en un Chrome invisible. Si se cierra solo, se vuelve a abrir
    global chrome
    exe = find_chrome()
    if not exe:
        print('  No encuentro Chrome (ni Chromium, Brave o Edge): sin él, el mundo lo lleva el primero que entra a jugar.')
        return
    stale_chrome()
    while not stopping.is_set():
        url = f'{LOCAL_GAME}?servidor={quote(f"ws://127.0.0.1:{PORT}", safe="")}&modo=servidor&pase={PASE}'
        chrome = await asyncio.create_subprocess_exec(
            exe, '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
            f'--user-data-dir={CHROME_DIR}', url, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        print('  Abriendo el mundo del servidor (el juego, en un Chrome invisible)…')
        await chrome.wait()
        if stopping.is_set():
            return
        print('  El mundo del servidor se ha cerrado: lo vuelvo a abrir en 5 segundos')
        await asyncio.sleep(5)


def start_world():
    global world_task
    if '--sin-mundo' in sys.argv and world_keys:
        print(f'Sin el mundo del servidor (--sin-mundo). Para abrirlo a mano: {LOCAL_GAME}?servidor={quote(f"ws://127.0.0.1:{PORT}", safe="")}&modo=servidor&pase={PASE}')
    if '--sin-mundo' in sys.argv or not world_keys or (world_task and not world_task.done()):
        return
    world_task = asyncio.get_running_loop().create_task(world_loop())


def conns_of(user):
    return [c for c, u in users.items() if u == user]


def command(line):
    # Un comando escrito en este terminal (con o sin la barra)
    name, _, arg = line.strip().lstrip('/').partition(' ')
    name = name.lower()
    if name == 'teleport':   # (como en Minecraft, /teleport es lo mismo que /tp)
        name = 'tp'
    user, _, rest = arg.strip().partition(' ')
    user, rest = user.lower(), rest.strip()
    if not name:
        return
    if name == 'op' and user == 'list':
        print(f'  Op: {", ".join(sorted(ops)) or "nadie"}')
    elif name in ('op', 'deop'):
        if not user:
            print(f'  Uso: /{name} <usuario>' + (' (o /op list)' if name == 'op' else ''))
            return
        if name == 'op':
            ops.add(user)
        else:
            ops.discard(user)
        save_json(OPS_FILE, sorted(ops))
        everyone({'t': 'ops', 'ops': sorted(ops)})
        print(f'  {user} {"ya es op" if name == "op" else "ya no es op"} (op: {", ".join(sorted(ops)) or "nadie"})')
    elif name == 'kick':
        if not user:
            print('  Uso: /kick <usuario> [motivo]')
            return
        found = conns_of(user)
        for c in found:
            kick(c, f'Te han echado del servidor{": " + rest if rest else ""}.')
        print(f'  {user} {"echado" if found else "no está conectado"}')
    elif name == 'ban':
        if not user:
            print('  Uso: /ban <usuario> [motivo]')
            return
        bans[user] = rest
        save_json(BANS_FILE, bans)
        for c in conns_of(user):
            kick(c, refused(user))
        print(f'  {user} vetado{": " + rest if rest else ""}')
    elif name == 'pardon':
        print(f'  {user} {"ya puede entrar" if bans.pop(user, None) is not None else "no estaba vetado"}')
        save_json(BANS_FILE, bans)
    elif name == 'banlist':
        print('  Vetados: ' + (', '.join(f'{u}{" (" + r + ")" if r else ""}' for u, r in sorted(bans.items())) or 'nadie'))
    elif name == 'whitelist':
        sub = user
        target = rest.split(' ')[0].lower() if rest else ''
        if sub in ('on', 'off'):
            white['enabled'] = sub == 'on'
            if white['enabled']:
                for c, u in list(users.items()):
                    if refused(u):
                        kick(c, refused(u))
        elif sub in ('add', 'remove') and target:
            white['users'] = sorted(set(white['users']) | {target} if sub == 'add' else set(white['users']) - {target})
        elif sub != 'list':
            print('  Uso: /whitelist on|off|add <usuario>|remove <usuario>|list')
            return
        save_json(WHITE_FILE, white)
        print(f'  Lista blanca {"puesta" if white["enabled"] else "quitada"}: {", ".join(white["users"]) or "nadie"}')
    elif name == 'list':
        who = sorted(set(users.values()))
        print(f'  Conectados ({len(peers)}): {", ".join(who) or "nadie"}' + (f' y {len(peers) - len(users)} sin decir quién' if len(peers) > len(users) else ''))
    elif name == 'say':
        text = arg.strip()
        if text:
            everyone({'t': 'say', 'text': text[:300]})
            print(f'  [Servidor] {text}')
    elif name == 'tp':
        # (el servidor no sabe dónde está nadie: se lo pide al juego de quien va, que sabe dónde están los demás)
        target = rest.split(' ')[0].lower() if rest else ''
        if re.fullmatch(r'~?-?\d*\.?\d*', target or 'x') and target and servers:   # (a unas coordenadas: el mundo del servidor)
            forward(line)
            return
        if not user or not target:
            print('  Uso: /tp <usuario> <usuario> · /tp <usuario> home · /tp @a home')
            return
        movers = [c for c, u in users.items() if c not in servers and (user == '@a' or u == user)]
        if not movers:
            print(f'  {user} no está conectado')
            return
        if target == 'home':
            for c in movers:
                send(c, {'t': 'tp', 'home': True})
            print(f'  {"Todos van" if user == "@a" else user + " va"} a casa')
        elif target not in users.values():
            print(f'  {target} no está conectado')
        else:
            for c in movers:
                if users.get(c) != target:
                    send(c, {'t': 'tp', 'to': target})
            print(f'  {"Todos van" if user == "@a" else user + " va"} adonde está {target} (si está en el mundo de fuera)')
    elif name in ('save-off', 'save-on'):
        global autosave
        autosave = name == 'save-on'
        everyone({'t': 'autosave', 'on': autosave})
        print('  Se vuelve a guardar el mundo' if autosave else '  Ya no se guarda el mundo (hasta /save-on): ahora se puede copiar a mano')
    elif name == 'setidletimeout':
        if not re.fullmatch(r'\d+', user or ''):
            print(f'  Uso: /setidletimeout <minutos> (ahora: {settings.get("idle", 0) or "nunca"})')
            return
        settings['idle'] = int(user)
        save_json(SETTINGS_FILE, settings)
        everyone({'t': 'idle', 'minutes': settings['idle']})
        print(f'  A quien lleve {settings["idle"]} minuto{"" if settings["idle"] == 1 else "s"} sin moverse, fuera' if settings['idle'] else '  Ya no se echa a nadie por no moverse')
    elif name == 'tps':
        if not servers:
            print('  El mundo del servidor no está abierto')
            return
        for c in servers:
            send(c, {'t': 'tps'})
    elif name == 'save-all':
        everyone({'t': 'save'})
        print('  Guardando: cada juego guarda lo suyo, y quien lleva el mundo, el mundo')
    elif name == 'world':
        state = 'conectado' if servers else 'abriéndose' if chrome and chrome.returncode is None else 'cerrado'
        print(f'  Mundo del servidor: {state}' + ('' if world_keys else ' (sin claves: que entre el admin)'))
    elif name == 'link':
        global link_until
        link_until = time.time() + 300
        for c in local:
            send(c, {'t': 'need'})
        print(f'  Esperando las claves (5 minutos): entra con la cuenta del admin en la pestaña que se abre ({LOCAL_GAME})')
        open_page(admin_link())
    elif name == 'stop':
        global stop_asked_at
        if stop_asked_at:
            return
        stop_asked_at = time.time()
        everyone({'t': 'stop'})
        print('  Cerrando el servidor (los juegos guardan antes)…')
        # (el mundo del servidor avisa cuando ha guardado: como mucho, se le espera un poco)
        asyncio.get_running_loop().call_later(15 if servers else 3, shutdown)
    elif name == 'help':
        print(HELP)
    elif servers:
        forward(line)   # (un comando del juego: lo ejecuta el mundo del servidor)
    else:
        print(f'  No existe el comando /{name} en el servidor, y los del juego (/time, /give…) necesitan el mundo del servidor abierto. /help los lista.')


def console(loop):
    # Lo que se escribe en el terminal, línea a línea, en su propio hilo (que no impide cerrar el programa)
    for line in sys.stdin:
        loop.call_soon_threadsafe(command, line)


def open_page(url):
    if '--sin-navegador' not in sys.argv:
        webbrowser.open(url)


def admin_link():
    # La pestaña para dar las claves: el juego servido aquí, conectado aquí mismo (y, si lo hay, con el túnel)
    url = tunnel_url or f'ws://127.0.0.1:{PORT}'
    return f'{LOCAL_GAME}?servidor={quote(url, safe="")}&local={quote(f"ws://127.0.0.1:{PORT}", safe="")}'


def stop_signal():
    # Ctrl+C cierra como /stop (los juegos guardan antes); otro Ctrl+C, ya
    global stop_asked
    if stop_asked or stopping.is_set():
        os._exit(1)
    stop_asked = True
    command('stop')


def shutdown():
    if stopping.is_set():
        return
    for w in list(peers.values()):
        w.close()
    if chrome and chrome.returncode is None:
        chrome.terminate()
    stopping.set()


async def main():
    global stopping
    stopping = asyncio.Event()
    global tunnel_url
    server = await asyncio.start_server(handle, '127.0.0.1', PORT)
    site = await asyncio.start_server(web, '127.0.0.1', WEB_PORT)
    print(f'Servidor de Miniverse para jugar juntos, en el puerto {PORT}.')
    print(f'Escribe aquí los comandos del servidor (/help para verlos). Op ahora: {", ".join(sorted(ops)) or "nadie"}.')
    threading.Thread(target=console, args=(asyncio.get_running_loop(),), daemon=True).start()
    asyncio.get_running_loop().add_signal_handler(signal.SIGINT, stop_signal)
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop_signal)
    keys_first = not world_keys and '--sin-mundo' not in sys.argv
    proc = None
    if '--sin-tunel' in sys.argv:
        print(f'Sin túnel: solo desde este ordenador, en ws://localhost:{PORT}')
    else:
        print('Abriendo el túnel…')
        proc, https = await tunnel()
        url = tunnel_url = 'wss://' + https[len('https://'):]
        print(f'Túnel abierto: {url}\nEsperando a que responda (suele tardar unos segundos)…')
        if not await ready(https):
            print('El túnel todavía no responde. Abro el juego igualmente: seguirá intentando conectar.')
        link = f'{GAME}?servidor={quote(url, safe="")}'
        if not keys_first:
            print(f'Listo. Abriendo el juego: {link}\n'
                  'Entra con tu cuenta y juega: los demás verán que estás jugando. Para cerrar el servidor, Ctrl+C.')
            open_page(link)
    start_world()   # (después del túnel: el mundo del servidor publica su dirección)
    if keys_first:
        # (la primera vez, el juego se abre servido desde aquí: así el del admin puede darle las claves al mundo del
        # servidor sin que pasen por el túnel)
        print(f'Todavía no tengo las claves del mundo. Abro el juego desde este ordenador: entra con la cuenta del admin\n'
              f'y se las da al mundo del servidor (no salen de este ordenador). {admin_link()}')
        open_page(admin_link())
    try:
        async with server, site:
            await stopping.wait()
        print('Servidor cerrado.')
    finally:
        if proc and proc.returncode is None:
            proc.terminate()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nServidor cerrado.')
