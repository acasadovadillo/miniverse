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
#   --codigo <rama|commit>|trabajo       el código del mundo del servidor (por omisión, origin/main: lo publicado)
#   --update-a-mano                      no pasar solo el mundo del servidor a lo publicado (solo con /update)
#   --copia-fija <nombre>                solo hace una copia fija de la copia más reciente de backups/ y sale (sin abrir
#                                        nada: vale con el servidor abierto o cerrado; mejor /backup <nombre> en su terminal)
#   --codigo-llave [archivo]             copia al portapapeles el código de recuperación de la llave del mundo que tiene el
#                                        servidor (servidor-secretos.json u otro) y sale; no lo escribe en ningún sitio
#
# Además abre el mundo del servidor: el mismo juego en un Chrome invisible (sin dibujo ni jugador visible) que lleva
# el mundo compartido mientras esto esté abierto, aunque no juegue nadie, como un servidor de Minecraft: hace pasar
# la hora y crecer los cultivos, reparte los cambios, no deja los que no tocan y lo guarda (cifrado). Ese juego lo
# sirve este programa solo para este ordenador (http://127.0.0.1:8791), y no desde esta carpeta, donde se edita, sino
# desde una copia fija de lo publicado (origin/main) en .publicado/: al arrancar, solo en cuanto se publica una versión
# nueva (cuando la web ya la tiene) y con /update, que la renuevan y vuelven a abrir el mundo del servidor (guardando
# antes). Así, si su Chrome se reinicia, nunca corre código a medias. Para llevar el mundo
# necesita la clave del mundo y el token del admin para guardarlo en GitHub: se los da el juego del admin la primera
# vez que entra con la pestaña que se abre (o tras /link), siempre dentro de este ordenador (nunca por el
# túnel), y quedan en servidor-secretos.json, junto a los op.
#
# Mientras está abierto, en su terminal se escriben los comandos del servidor (como en Minecraft; /help los
# lista): op y deop (los op pueden usar los comandos del juego: /gamemode, /tp, /give…), kick, ban y pardon, la
# lista blanca, list, say, tp, save-all, save-off y save-on, setidletimeout, tps y stop. Y, como en la consola de
# Minecraft, cualquier comando del juego (/time, /weather, /give, /fill…): lo ejecuta el mundo del servidor. Cada juego dice al entrar de qué cuenta es (el servidor no lee nada
# más). Los op, los vetados y la lista blanca se guardan en ops.json, banned.json y whitelist.json, junto a este
# archivo, y las copias del mundo (cifradas: el servidor no puede abrirlas) en backups/: una cada 15 minutos, de las que se
# guardan las 12 últimas, la última de cada una de las 24 horas más recientes y la última de cada uno de los 14 días más
# recientes; y en backups/fijas/, las que no se borran nunca: /backup <nombre>, y solas antes de cada /update (con la
# versión nueva) y de cada /restore. /restore <copia> vuelve a una (ver restore_cmd).
#
# Solo usa la biblioteca estándar de Python. El túnel necesita cloudflared: brew install cloudflared
import asyncio
import base64
import hashlib
import io
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
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
HERE = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))   # (el juego, con su git: de aquí sale lo publicado)
DATA = os.path.abspath(option('--datos', HERE))
os.makedirs(DATA, exist_ok=True)
CODE = option('--codigo', 'origin/main')   # lo que corre el mundo del servidor ('trabajo': esta carpeta, tal cual)
AUTO_UPDATE = CODE != 'trabajo' and '--update-a-mano' not in sys.argv   # (pasarlo solo a lo publicado: ver watch_published)
PUBLISHED = os.path.join(DATA, '.publicado')   # las copias fijas de ese código, una carpeta por commit (ver publish_copy)
OPS_FILE, BANS_FILE, WHITE_FILE = (os.path.join(DATA, n) for n in ('ops.json', 'banned.json', 'whitelist.json'))
BACKUPS = os.path.join(DATA, 'backups')
FIXED = os.path.join(BACKUPS, 'fijas')   # las copias fijas, con nombre: no se borran nunca
BACKUP_EVERY = 15 * 60   # segundos: como mucho, una copia del mundo cada tanto (la manda el juego que lo lleva)
BACKUP_RECENT = 12       # de las copias, se guardan las últimas (unas 3 horas)…
BACKUP_HOURS = 24        # …la última de cada una de las horas más recientes con copias…
BACKUP_DAYS = 14         # …y la última de cada uno de los días más recientes (las demás se borran: ver prune_backups)
BACKUP_RE = re.compile(r'^mundo-(\d{4}-\d\d-\d\d)_(\d\d)-\d\d\.enc$')   # (las que rotan; las fijas van aparte)
# Las fijas que se hacen solas (antes de cada /update o paso a lo publicado, antes de cada /restore y la copia del navegador
# del mundo del servidor cuando el mundo de GitHub no se abre: copia-del-servidor): de estas se quedan
# las últimas (con unas 20 versiones al día crecerían sin fin); las de /backup <nombre> y --copia-fija no se borran nunca
AUTO_FIXED_RE = re.compile(r'^mundo-(antes-de-(restaurar|actualizar|\d{4}-\d\d-\d\d[\w.]*)|copia-del-servidor)-\d{4}-\d\d-\d\d_\d\d-\d\d\.enc$')
AUTO_FIXED_KEEP = 30
FIXED_STAMP = re.compile(r'-\d{4}-\d\d-\d\d_\d\d-\d\d\.enc$')   # (la fecha al final del nombre de una fija)
KEEP_WAIT = 30           # segundos: si la copia fija pedida con /backup no llega en este rato, se avisa
RESTORE_WAIT = 240       # segundos: lo que se espera, como mucho, a que el mundo del servidor vuelva con la copia restaurada
RESTORING = 'El servidor está volviendo a una copia del mundo: entra otra vez en un par de minutos.'
TOKEN_CHECK_EVERY = 6 * 3600   # cada cuánto se mira cuándo caduca el token del mundo del servidor (el del admin)
TOKEN_WARN = 7 * 86400         # y cuánto antes se avisa
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


def save_secret(path, data):
    # Como save_json, pero que solo lo pueda leer este usuario desde el primer momento (lleva la llave del mundo y el
    # token): se escribe aparte, ya con permisos 600, y luego se cambia el nombre
    tmp = path + '.nuevo'
    try:
        os.remove(tmp)
    except OSError:
        pass
    with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


ops = {str(u).lower() for u in load_json(OPS_FILE, [])}   # las cuentas op (su usuario, en minúsculas)
bans = {str(u).lower(): str(r) for u, r in load_json(BANS_FILE, {}).items()}   # vetadas → el motivo
white = load_json(WHITE_FILE, {'enabled': False, 'users': []})                  # la lista blanca
white = {'enabled': bool(white.get('enabled')), 'users': sorted({str(u).lower() for u in white.get('users', [])})}
users = {}           # número de conexión → la cuenta que ha dicho su juego
SECRETS_FILE = os.path.join(DATA, 'servidor-secretos.json')
OLD_SECRETS = 'servidor-secretos.viejo-{}.json'   # (si /link trae otra llave del mundo, la de antes: una por fecha, no se pisan)
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
token_recheck = None  # (para mirar ya cuándo caduca el token: llegan claves nuevas)
code_dir = None      # la copia de lo publicado que se sirve ahora (su carpeta en .publicado/: el commit corto); None: esta carpeta
code_note = ''       # qué código es, para el terminal
versions = {}        # número de conexión → la versión del juego que dice (al servidor, en ident; '' si no la dice: de antes)
server_version = None   # la del mundo del servidor (en su pase); None si no la dice o no está
server_ready = False    # (si ya tiene el mundo en marcha: antes no se echa a nadie, ver reference_version)
told_newer = set()   # (las versiones más nuevas que la del mundo del servidor de las que ya se ha avisado)
restart_pending = None  # (/update: esperando a que el mundo del servidor guarde para cerrarlo)
code_version = ''       # la versión del juego de la copia de ahora (para la copia fija de antes de /update)
restoring = None        # (/restore: { label, at, done }; mientras, no entra nadie más que el mundo del servidor)
token_warning = None    # (lo que hay que decir del token del mundo del servidor: que caduca pronto o que ya no vale)
keep_waiting = {}       # (/backup <nombre>: las copias fijas pedidas al mundo del servidor que aún no han llegado → cuándo)
OUTDATED = 'Hay una versión nueva del juego: recarga la página.'
VERSION_RE = re.compile(r'<meta name="miniverse-version" content="([^"]+)"')
WATCH_EVERY = 60     # segundos: cada cuánto se mira si se ha publicado algo nuevo (ver watch_published)


def version_key(v):
    # Para comparar versiones (miniverse-version: 2026-11-11.3): sus números. Sin versión, la más vieja (como en src/version.js)
    return tuple(int(n) for n in re.findall(r'\d+', v)) if isinstance(v, str) else ()


def git(*args):
    return subprocess.run(['git', '-C', HERE, *args], capture_output=True, check=True, timeout=60).stdout


def publish_copy():
    # El código del mundo del servidor: una copia fija del commit publicado (CODE, origin/main), sacada con git archive a
    # .publicado/<commit>/ (solo lo que se sirve: index.html, accounts.json y src/). No depende de la carpeta de trabajo,
    # donde se edita: si el Chrome del servidor se reinicia a media edición, abre lo publicado. Cada commit, su carpeta
    # (el Chrome que ya está abierto sigue leyendo la suya hasta que se cierra). Devuelve True si ha cambiado
    global code_dir, code_note, code_version
    if CODE == 'trabajo':
        code_dir, code_note = None, 'la carpeta de trabajo, tal cual (--codigo trabajo)'
        return False
    try:
        sha = git('rev-parse', '--verify', CODE + '^{commit}').decode().strip()
        short = sha[:12]
        target = os.path.join(PUBLISHED, short)
        if not os.path.isfile(os.path.join(target, 'index.html')):
            names = set(git('ls-tree', '--name-only', sha).decode().split('\n'))
            tar = git('archive', '--format=tar', sha, *[n for n in ('index.html', 'accounts.json', 'src') if n in names])
            tmp = target + '.nuevo'
            shutil.rmtree(tmp, ignore_errors=True)
            os.makedirs(tmp)
            with tarfile.open(fileobj=io.BytesIO(tar)) as t:
                try:
                    t.extractall(tmp, filter='data')
                except TypeError:   # (Python de antes de 3.12, sin filter: es nuestro propio git)
                    t.extractall(tmp)
            os.replace(tmp, target)
        with open(os.path.join(target, 'index.html'), encoding='utf-8') as f:
            found = VERSION_RE.search(f.read())
        changed = code_dir != short
        code_version = found.group(1) if found else ''
        code_dir, code_note = short, f'lo publicado ({CODE}: {short[:7]}, versión {code_version or "?"})'
        return changed
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as e:
        why = (e.stderr.decode(errors='replace').strip() if isinstance(e, subprocess.CalledProcessError) and e.stderr else str(e))[:200]
        if code_dir:
            print(f'  ! No he podido sacar {CODE} ({why}): sigo con {code_note}')
        else:
            code_note = f'la carpeta de trabajo (no he podido sacar {CODE}: {why})'
            print(f'  ! OJO: el mundo del servidor usará {code_note}. ¿Es una copia sin git?')
        return False


def target_code():
    # Lo publicado ahora (CODE): (su commit corto, su versión). Sin git o sin ese commit, None
    try:
        sha = git('rev-parse', '--verify', CODE + '^{commit}').decode().strip()
        found = VERSION_RE.search(git('show', f'{sha}:index.html').decode('utf-8', 'replace'))
        return sha[:12], found.group(1) if found else ''
    except (OSError, subprocess.SubprocessError):
        return None


def web_version():
    # La versión que tiene ahora la web (GitHub Pages, GAME): tarda un minuto o dos en tener lo que se acaba de subir con
    # git push, y los que recargan la página antes siguen con la de antes. None si no se sabe
    try:
        url = f'{GAME.rstrip("/")}/index.html?version={int(time.time())}'
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Miniverse', 'Cache-Control': 'no-cache'}), timeout=10) as r:
            found = VERSION_RE.search(r.read(400000).decode('utf-8', 'replace'))
        return found.group(1) if found else None
    except Exception:
        return None


def tidy_copies():
    # Quita de .publicado/ las copias que ya no se usan (la de ahora se queda). Solo al arrancar: una pestaña abierta
    # antes de /update (la de dar las claves) sigue leyendo la suya
    if not os.path.isdir(PUBLISHED):
        return
    for n in os.listdir(PUBLISHED):
        if n != code_dir:
            shutil.rmtree(os.path.join(PUBLISHED, n), ignore_errors=True)


def code_url():
    # El juego del mundo del servidor (y el de dar las claves): el de la copia de ahora
    return f'{LOCAL_GAME}{code_dir}/' if code_dir else LOCAL_GAME


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


def reference_version():
    # Con qué versión se compara a quien está conectado: la del mundo del servidor, pero solo cuando ya tiene el mundo en
    # marcha (dice ready): mientras se abre, quien llevaba el mundo (con la versión de antes, tras /update) se lo tiene que
    # poder dar, con lo hecho mientras tanto. Sin mundo del servidor (--sin-mundo, sin claves, sin Chrome), la más nueva
    # de las que dicen los juegos conectados: un juego de antes que no sabe de versiones no se entera de otra forma
    if servers or (world_task and not world_task.done()):
        return server_version if servers and server_ready else None
    return max((versions.get(p, '') for p in users if p not in local), key=version_key, default='') or None


def check_version(peer_id):
    # Un juego con una versión más vieja no se queda: no puede tocar el mundo con código viejo (los de antes de que se
    # mandara la versión, tampoco). Se le dice que recargue (su juego lo enseña, también los de antes). Uno con una más
    # nueva que el mundo del servidor sí entra, y aquí se dice (el mundo del servidor pasa a ella al publicarse: ver
    # watch_published). (Lo de este ordenador, no: la pestaña de dar las claves es de la copia del servidor)
    ref = reference_version()
    if ref is None or peer_id in servers or peer_id in local or peer_id not in users:
        return
    v, who = versions.get(peer_id, ''), users[peer_id]
    if version_key(v) < version_key(ref):
        print(f'  ! {who} tiene una versión anterior del juego ({v or "sin número"}; {"el mundo del servidor" if servers else "otro juego"}, {ref}): fuera hasta que recargue la página')
        send(peer_id, {'t': 'kicked', 'reason': OUTDATED, 'outdated': True, 'v': ref})
        w = peers.get(peer_id)
        if w:
            w.close()
    elif servers and version_key(v) > version_key(server_version) and v not in told_newer:
        told_newer.add(v)
        print(f'  ! {who} tiene una versión más nueva del juego ({v}) que el mundo del servidor ({server_version}): '
              + ('se pasará solo a ella en cuanto esté publicada (o escribe /update)' if AUTO_UPDATE else 'escribe /update'))


def check_all():
    for p in list(users):
        check_version(p)


def rotating_backups():
    # Las copias que rotan, de la más nueva a la más vieja (el nombre lleva la fecha y la hora: se ordenan por él)
    try:
        return sorted((n for n in os.listdir(BACKUPS) if BACKUP_RE.match(n)), reverse=True)
    except OSError:
        return []


def fixed_backups():
    try:
        return sorted((n for n in os.listdir(FIXED) if n.startswith('mundo-') and n.endswith('.enc')), reverse=True)
    except OSError:
        return []


def prune_backups():
    # Se quedan las BACKUP_RECENT últimas, la última de cada una de las BACKUP_HOURS horas más recientes que tienen copia y
    # la última de cada uno de los BACKUP_DAYS días más recientes. Se cuentan las horas y los días que tienen copias, no
    # los del reloj: con el servidor cerrado unas semanas, al volver no se borra todo lo de antes
    keep, hours, days = set(), [], []
    names = rotating_backups()
    for i, n in enumerate(names):
        m = BACKUP_RE.match(n)
        day, hour = m.group(1), m.group(1) + m.group(2)
        if i < BACKUP_RECENT:
            keep.add(n)
        if hour not in hours:
            hours.append(hour)
            if len(hours) <= BACKUP_HOURS:
                keep.add(n)
        if day not in days:
            days.append(day)
            if len(days) <= BACKUP_DAYS:
                keep.add(n)
    for n in names:
        if n not in keep:
            try:
                os.remove(os.path.join(BACKUPS, n))
            except OSError:
                pass


def prune_fixed():
    # De las fijas que se hacen solas, se quedan las AUTO_FIXED_KEEP más recientes (las de /backup <nombre>, todas)
    # (por la fecha del final del nombre: por el nombre, «restaurar» iría antes que las versiones, y la .10 antes que la .9)
    auto = sorted((n for n in fixed_backups() if AUTO_FIXED_RE.match(n)), key=lambda n: n[-len('2026-01-01_00-00.enc'):], reverse=True)
    for n in auto[AUTO_FIXED_KEEP:]:
        try:
            os.remove(os.path.join(FIXED, n))
        except OSError:
            pass


def clean_name(name):
    # Un nombre para una copia fija: letras, números, guiones y puntos (lo demás, guiones)
    return re.sub(r'-{2,}', '-', re.sub(r'\.{2,}', '-', re.sub(r'[^\w.-]+', '-', str(name)))).strip('-.')[:48] or 'copia'


def write_copy(path, raw):
    # (de una vez: primero a un archivo aparte y luego se cambia el nombre, para que no quede una copia a medias)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.nuevo'
    with open(tmp, 'wb') as f:
        f.write(raw)
    os.replace(tmp, path)


def backup(data, name=None):
    # Una copia del mundo (cifrada, como en GitHub). Sin nombre, de las que rotan: como mucho una cada BACKUP_EVERY (al
    # cerrar el servidor, la última siempre). Con nombre, una fija en backups/fijas/, que no se borra nunca
    global last_backup
    now = time.time()
    if not name and now - last_backup < BACKUP_EVERY and not stop_asked_at:
        return
    try:
        raw = base64.b64decode(data, validate=True)
    except ValueError:
        return
    stamp = time.strftime('%Y-%m-%d_%H-%M')
    if name:
        label = f'fijas/mundo-{clean_name(name)}-{stamp}.enc'
        write_copy(os.path.join(FIXED, label[len('fijas/'):]), raw)
        auto = AUTO_FIXED_RE.match(label[len('fijas/'):])
        keep_waiting.pop(clean_name(name), None)
        if auto:
            prune_fixed()
        print(f'  Copia fija del mundo: backups/{label} ({len(raw) // 1024} KB; ' + (f'de las que se hacen solas se quedan las {AUTO_FIXED_KEEP} últimas)' if auto else 'esta no se borra)'))
        return
    label = f'mundo-{stamp}.enc'
    write_copy(os.path.join(BACKUPS, label), raw)
    last_backup = now
    prune_backups()
    print(f'  Copia del mundo: backups/{label} ({len(raw) // 1024} KB)')


def copy_info(path):
    # (tamaño y fecha de una copia, para el terminal)
    try:
        st = os.stat(path)
        return f'{max(1, st.st_size // 1024)} KB, del {time.strftime("%d/%m %H:%M", time.localtime(st.st_mtime))}'
    except OSError:
        return '?'


def find_backup(text):
    # Las copias que encajan con lo escrito: [(nombre para el terminal, ruta)]. Vale el nombre entero (con o sin
    # «mundo-», «.enc» o «fijas/») o un trozo (2026-11-10_18, antes-de-…); si hay uno exacto, solo ese
    want = text.strip().lower().removeprefix('backups/').removesuffix('.enc')
    if not want:
        return []
    found = [(n, os.path.join(BACKUPS, n)) for n in rotating_backups()] + [(f'fijas/{n}', os.path.join(FIXED, n)) for n in fixed_backups()]
    exact = [c for c in found if c[0].lower().removesuffix('.enc') in (want, f'mundo-{want}', f'fijas/{want}', f'fijas/mundo-{want}')]
    if exact:
        return exact[:1]
    found = [c for c in found if want in c[0].lower()]
    # (varias fijas con el mismo nombre y distinta fecha, como antes-de-restaurar: la más reciente)
    stems = {FIXED_STAMP.sub('', n) for n, _ in found}
    if len(found) > 1 and len(stems) == 1 and all(n.startswith('fijas/') for n, _ in found):
        return [max(found, key=lambda c: c[0][-len('2026-01-01_00-00.enc'):])]
    return found


def list_backups():
    fixed, rot = fixed_backups(), rotating_backups()
    print(f'  Copias del mundo en {BACKUPS}: {len(rot)} que rotan' + (f' y {len(fixed)} fijas' if fixed else '') + ' (de la más nueva a la más vieja)')
    for n in fixed[:20]:
        print(f'    fijas/{n}  ({copy_info(os.path.join(FIXED, n))})')
    for n in rot[:16]:
        print(f'    {n}  ({copy_info(os.path.join(BACKUPS, n))})')
    if len(rot) > 16:
        print(f'    … y {len(rot) - 16} más antiguas (la más vieja: {rot[-1]})')
    print('  Para volver a una: /restore <copia> (vale un trozo del nombre). Para hacer una fija ahora: /backup <nombre>')


def restore_cmd(arg):
    # /restore <copia> [ya]: el mundo vuelve a esa copia. Sin «ya», solo se dice cuál sería y qué pasará. Lo hace el mundo
    # del servidor (es quien tiene la llave: aquí no se puede abrir): se echa al menú a los que juegan y no se deja entrar a
    # nadie hasta que vuelve (si no, el juego de uno pasaría a llevar el mundo de antes y se lo daría al volver); él guarda
    # el de ahora como copia fija («antes-de-restaurar»), guarda la copia como el mundo de ahora (aquí, en su navegador y en
    # GitHub, con la fecha de ahora, así que gana a todas) y se vuelve a abrir con ella
    global restoring
    words = arg.split()
    sure = len(words) > 1 and words[-1].lower() == 'ya'
    which = ' '.join(words[:-1] if sure else words)
    if not which:
        print('  Uso: /restore <copia> (/backups las lista)')
        return
    if restoring:
        print(f'  Ya se está volviendo a {restoring["label"]}: un momento')
        return
    if restart_pending or stop_asked_at:
        # (el mundo del servidor está guardando para cerrarse: si se cerrara a mitad de restaurar, la copia podría no quedar puesta)
        print(f'  Hay un {"/stop" if stop_asked_at else "/update"} en marcha (el mundo del servidor se está cerrando): espera a que acabe y vuelve a escribirlo.')
        return
    found = find_backup(which)
    if not found:
        print(f'  No hay ninguna copia que encaje con «{which}» (/backups las lista)')
        return
    if len(found) > 1:
        print(f'  Hay {len(found)} copias que encajan con «{which}»: ' + ', '.join(n for n, _ in found[:6]) + (' …' if len(found) > 6 else '') + '. Escribe más del nombre.')
        return
    label, path = found[0]
    if not servers:
        print('  Para volver a una copia hace falta el mundo del servidor abierto (es quien tiene la llave del mundo): /world dice cómo está')
        return
    if not sure:
        print(f'  Volver a {label} ({copy_info(path)}): el mundo queda como estaba entonces. Antes se guarda el de ahora como copia fija '
              f'(antes-de-restaurar), y los que estén jugando salen al menú un par de minutos (lo suyo se guarda). Para hacerlo: /restore {which} ya')
        return
    try:
        with open(path, 'rb') as f:
            raw = f.read()
    except OSError as e:
        print(f'  No se puede leer {label}: {e}')
        return
    restoring = {'label': label, 'at': time.time(), 'done': False}
    # (fuera todos menos el mundo del servidor: también los que no han dicho quién son, un juego de antes, que si no podría
    # darle el mundo de antes al mundo del servidor cuando este se vuelva a abrir)
    out = [c for c in list(peers) if c not in servers]
    names = sorted({users[c] for c in out if c in users})
    for c in out:
        kick(c, RESTORING)
    print(f'  Volviendo a {label}' + (f' (fuera, un momento: {", ".join(names)})' if names else '') + '…')
    send(sorted(servers)[0], {'t': 'restore', 'd': base64.b64encode(raw).decode(), 'name': label})
    asyncio.get_running_loop().call_later(RESTORE_WAIT, restore_timeout, restoring['at'])


def restore_timeout(at):
    global restoring
    if restoring and restoring['at'] == at:
        print('  ! El mundo del servidor no ha terminado de volver a la copia' + (' (ya la había guardado: se está abriendo)' if restoring['done'] else
              ' (no ha contestado: ¿tiene una versión de antes? /update)') + '. Ya se puede entrar otra vez.')
        restoring = None


def keep_cmd(arg):
    # /backup <nombre>: una copia fija del mundo de ahora (la hace el mundo del servidor, que lo tiene abierto); sin él, de la
    # copia más reciente de backups/ (fixed_from_latest)
    name = clean_name(arg) if arg.strip() else 'copia'
    if servers and server_ready:
        send(sorted(servers)[0], {'t': 'keep', 'name': name})
        keep_waiting[name] = time.time()
        asyncio.get_running_loop().call_later(KEEP_WAIT, keep_late, name, keep_waiting[name])
        print(f'  Pidiendo al mundo del servidor una copia fija del mundo de ahora ({name})…')
    else:
        fixed_from_latest(name)


def keep_late(name, at):
    # La copia fija pedida con /backup no ha llegado: un mundo del servidor de una versión anterior no sabe hacerla (o no
    # puede ahora). Se dice, y cómo sacar una de la copia más reciente de backups/
    if keep_waiting.get(name) == at:
        keep_waiting.pop(name, None)
        print(f'  ! No ha llegado la copia fija «{name}»: ¿el mundo del servidor tiene una versión de antes (/world, /update)? '
              f'Puedes sacarla de la copia más reciente de backups/ (de hasta 15 minutos antes) con: python3 multijugador.py --copia-fija {name}')


def fixed_from_latest(name):
    # Una copia fija de la copia más reciente de backups/ (sin el mundo del servidor: puede ser de hasta 15 minutos antes)
    rot = rotating_backups()
    if not rot:
        print('  No hay ninguna copia en backups/ de la que sacarla')
        return False
    with open(os.path.join(BACKUPS, rot[0]), 'rb') as f:
        raw = f.read()
    label = f'mundo-{clean_name(name)}-{rot[0][len("mundo-"):-len(".enc")]}.enc'
    write_copy(os.path.join(FIXED, label), raw)
    print(f'  Copia fija: backups/fijas/{label} (de {rot[0]}; esta no se borra)')
    return True


UNKNOWN = object()   # (token_expiry: GitHub no ha contestado)


def token_expiry():
    # Cuándo caduca el token del mundo del servidor (el del admin): lo dice GitHub en una cabecera de cada respuesta (el
    # navegador no la puede leer; aquí sí). /rate_limit no gasta peticiones. Devuelve los segundos que quedan, 0 si GitHub
    # ya no lo acepta o None si no caduca o no se sabe. (El token no se escribe en ningún sitio)
    token = (world_keys or {}).get('token')
    if not token:
        return None
    req = urllib.request.Request('https://api.github.com/rate_limit', headers={
        'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'User-Agent': 'Miniverse'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            text = r.headers.get('github-authentication-token-expiration')
    except urllib.error.HTTPError as e:
        return 0 if e.code == 401 else UNKNOWN
    except Exception:
        return UNKNOWN   # (sin conexión: no se sabe; lo que se dijera se sigue diciendo)
    m = re.match(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) ?(UTC|[+-]\d\d:?\d\d)?$', (text or '').strip())
    if not m:
        return None
    tz = '+0000' if not m.group(2) or m.group(2) == 'UTC' else m.group(2).replace(':', '')
    try:
        return max(0.0, datetime.strptime(f'{m.group(1)} {tz}', '%Y-%m-%d %H:%M:%S %z').timestamp() - time.time())
    except ValueError:
        return None


B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   # (base 32 de Crockford, como el código de recuperación del juego: worldkey.js)


def recovery_code(raw):
    # El código de recuperación de la llave del mundo (32 bytes), igual que recoveryCode en worldkey.js: la llave y 2 bytes
    # de su SHA-256, en base 32, «MV1-» y grupos de 5
    v = bits = 0
    out = ''
    for b in raw + hashlib.sha256(raw).digest()[:2]:
        v, bits = (v << 8) | b, bits + 8
        while bits >= 5:
            out += B32[(v >> (bits - 5)) & 31]
            bits -= 5
        v &= (1 << bits) - 1
    if bits:
        out += B32[(v << (5 - bits)) & 31]
    return 'MV1-' + '-'.join(out[i:i + 5] for i in range(0, len(out), 5))


def copy_key_code(path=None):
    # --codigo-llave [archivo]: el código de recuperación de la llave del mundo que tiene el servidor (servidor-secretos.json,
    # u otro: uno de los .viejo-…), al portapapeles, para pegarlo en el gestor de contraseñas o en Ajustes › Llave del
    # mundo si la del juego del admin se ha perdido. No se escribe en el terminal ni en ningún sitio
    path = os.path.join(DATA, path) if path and not os.path.isabs(path) else path or SECRETS_FILE
    keys = load_json(path, None)
    try:
        raw = base64.b64decode((keys or {}).get('key', ''), validate=True)
    except ValueError:
        raw = b''
    if len(raw) != 32:
        print(f'No hay una llave del mundo en {os.path.basename(path)}.')
        return False
    try:
        subprocess.run(['pbcopy'], input=recovery_code(raw).encode(), check=True)
    except (OSError, subprocess.CalledProcessError):
        print('No se ha podido copiar al portapapeles (hace falta pbcopy, el de macOS). No lo escribo aquí para que no quede a la vista.')
        return False
    print(f'Copiado al portapapeles el código de recuperación de la llave del mundo de {os.path.basename(path)}: pégalo en tu gestor '
          'de contraseñas (o en el juego, Ajustes › Llave del mundo, si allí se ha perdido) y luego copia otra cosa encima.')
    return True


def token_text(left):
    # Lo que se dice del token (left: los segundos que quedan, de token_expiry), o None si no hace falta decir nada
    if left is None or left > TOKEN_WARN:
        return None
    if left <= 0:
        head = 'GitHub ya no acepta el token del mundo del servidor (tu token de admin: ¿ha caducado?)'
    else:
        days = max(1, -(-int(left) // 86400))
        head = f'El token del mundo del servidor (tu token de admin) caduca el {time.strftime("%d/%m", time.localtime(time.time() + left))} ({"en menos de un día" if left < 86400 else f"en {days} días"})'
    return head + ': crea uno nuevo en GitHub, cámbialo en tu juego (Ajustes › Guardado en GitHub) y escribe /link en este terminal.'


async def watch_token():
    # Cada pocas horas (y en cuanto llegan unas claves nuevas: ver take_keys), cuándo caduca: una semana antes, se dice aquí
    # y al admin en su juego (a los op conectados: su juego solo lo enseña si es el del admin)
    global token_warning
    while not stopping.is_set():
        left = await asyncio.to_thread(token_expiry)
        was, token_warning = token_warning, token_warning if left is UNKNOWN else token_text(left)
        if token_warning:
            print(f'  ! {token_warning}')
        if token_warning or was:
            # (y, si ya no hace falta, que lo quiten: text vacío)
            for c, u in list(users.items()):
                if u in ops:
                    send(c, {'t': 'notice', 'kind': 'token', 'text': token_warning or ''})
        if was and not token_warning:
            print('  El token del mundo del servidor vuelve a estar bien.')
        try:
            await asyncio.wait_for(token_recheck.wait(), TOKEN_CHECK_EVERY)
        except asyncio.TimeoutError:
            pass
        token_recheck.clear()


async def handle(reader, writer):
    global next_id, server_version, server_ready, restoring
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
                versions[me] = msg['v'][:32] if isinstance(msg.get('v'), str) else ''
                why = refused(user) or (RESTORING if restoring else None)
                if why:
                    print(f'  ! {user} no puede entrar: {why}')
                    kick(me, why)
                elif first:
                    print(f'  + {user} ha entrado')
                    check_all()   # (sin mundo del servidor, uno más nuevo deja fuera a los demás: ver reference_version)
                    if token_warning and user in ops:
                        send(me, {'t': 'notice', 'kind': 'token', 'text': token_warning})
                continue
            # (las fijas, con nombre, solo del mundo del servidor: /backup, antes de /update y de /restore)
            if msg.get('t') == 'backup' and me in users and isinstance(msg.get('d'), str) and (me in servers or not restoring):
                backup(msg['d'], msg.get('name') if me in servers and isinstance(msg.get('name'), str) else None)
                continue
            if msg.get('t') == 'restored' and me in servers and restoring:
                # (el mundo del servidor ya ha guardado la copia como el mundo de ahora y se vuelve a abrir; o no ha podido)
                if msg.get('ok'):
                    restoring['done'] = True
                else:
                    restoring = None
                    print('  Ya se puede entrar otra vez (el mundo sigue como estaba).')
                continue
            # El mundo del servidor enseña su pase y recibe las claves; el juego del admin se las da; y lo que va
            # contando el mundo del servidor sale aquí
            if msg.get('t') == 'pase' and msg.get('pase') == PASE and me in local:
                first = me not in servers
                servers.add(me)
                users[me] = 'servidor'
                server_version = msg['v'][:32] if isinstance(msg.get('v'), str) and msg['v'] else None
                server_ready = False   # (a los que ya estaban se les mira al tener el mundo en marcha: ready)
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
            if msg.get('t') == 'ready' and me in servers:
                # (el mundo del servidor ya tiene el mundo: los que ya estaban, con su versión, ¿pueden seguir? Al rato,
                # para que quien se lo ha dado tenga tiempo de guardar lo suyo)
                server_ready = True
                asyncio.get_running_loop().call_later(5, check_all)
                if restoring and restoring['done']:
                    print(f'  Hecho: el mundo vuelve a estar como en {restoring["label"]}. Ya se puede entrar.')
                    restoring = None
                continue
            if msg.get('t') == 'saved' and me in servers and restart_pending and not stop_asked_at:
                close_world()   # (/update: ya ha guardado; se abre solo otra vez, con el código nuevo)
                continue
            if msg.get('t') == 'saved' and me in servers and stop_asked_at:
                # (cerrando: el mundo ya está guardado; se espera lo justo a que guarden los demás)
                asyncio.get_running_loop().call_later(max(0, 3 - (time.time() - stop_asked_at)), shutdown)
                continue
            if msg.get('t') != 'msg' or (restoring and me not in servers):
                continue   # (volviendo a una copia, nadie más que el mundo del servidor: ver restore_cmd)
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
        versions.pop(me, None)
        local.discard(me)
        was_server = me in servers
        servers.discard(me)
        for p in list(peers):
            send(p, {'t': 'leave', 'id': me})
        writer.close()
        if was_server:
            if not servers:
                server_version, server_ready = None, False
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
    /backups                                  las copias del mundo que hay (en backups/)
    /backup <nombre>                          una copia fija del mundo de ahora, que no se borra (antes de un cambio grande)
    /restore <copia> [ya]                     volver a una copia del mundo (sin ya, dice cuál y qué pasará)
    /world                                    cómo está el mundo del servidor (y con qué código)
    /update [ya]                              el mundo del servidor pasa a lo publicado (guarda antes; lo hace solo al
                                              publicar, si no es con --update-a-mano; ya: sin esperar a que lo tenga la web)
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
    if world_keys and world_keys.get('key') and world_keys['key'] != msg['key']:
        # (otra llave del mundo: la de antes no se pierde, que con ella se abren el mundo y las copias de hasta ahora. Cada
        # una en su archivo, con la fecha: si llegaran varias seguidas, ninguna pisa a otra)
        stamp, n = time.strftime('%Y-%m-%d_%H-%M-%S'), 1
        old = os.path.join(DATA, OLD_SECRETS.format(stamp))
        while os.path.exists(old):
            n += 1
            old = os.path.join(DATA, OLD_SECRETS.format(f'{stamp}-{n}'))
        save_secret(old, world_keys)
        print(f'  ! OJO: la llave del mundo que llega no es la de antes. La de antes queda en {os.path.basename(old)}: '
              'sin ella, el mundo guardado y las copias de backups/ no se podrían abrir.')
    world_keys = {'key': msg['key'], 'token': token}
    save_secret(SECRETS_FILE, world_keys)
    link_until = 0
    if token_recheck:
        token_recheck.set()   # (¿cuándo caduca el token nuevo?)
    print(f'  Claves del mundo recibidas (de {users.get(sender, "?")}) y guardadas en servidor-secretos.json')
    if chrome and chrome.returncode is None:
        chrome.terminate()   # (vuelve a abrirse solo, ya con las nuevas)
    start_world()


async def web(reader, writer):
    # El juego para el mundo del servidor (y para darle las claves): solo en este ordenador, y solo sus archivos. De la
    # copia de lo publicado: /<commit>/… sale de .publicado/<commit>/ (ver publish_copy); sin copia, de esta carpeta
    try:
        head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 10)
        method, target = head.decode('latin-1').split('\r\n')[0].split(' ')[:2]
        path = unquote(target.split('?')[0]).lstrip('/')
        root, extra = HERE, ''
        first, _, rest = path.partition('/')
        commit = re.fullmatch(r'[0-9a-f]{7,40}', first)
        if code_dir and commit and os.path.isdir(os.path.join(PUBLISHED, first)):
            root, path = os.path.realpath(os.path.join(PUBLISHED, first)), rest
        elif code_dir and (path in ('', 'index.html') or (commit and rest in ('', 'index.html'))):
            # (la dirección de siempre, sin commit, o la de una copia que ya no está: a la página de la copia de ahora)
            extra = f'Location: /{code_dir}/{"?" + target.split("?", 1)[1] if "?" in target else ""}\r\n'
        elif code_dir:
            root = None
        path = path or 'index.html'
        full = os.path.realpath(os.path.join(root, path)) if root else ''
        if extra:
            body, status, kind = b'', '302 Found', 'text/plain; charset=utf-8'
        elif root and method == 'GET' and WEB_FILES.match(path) and '..' not in path and full.startswith(root + os.sep) and os.path.isfile(full):
            with open(full, 'rb') as f:
                body = f.read()
            status, kind = '200 OK', WEB_TYPES[os.path.splitext(path)[1]]
        else:
            body, status, kind = b'No encontrado\n', '404 Not Found', 'text/plain; charset=utf-8'
        writer.write(f'HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {len(body)}\r\n{extra}'
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
        url = f'{code_url()}?servidor={quote(f"ws://127.0.0.1:{PORT}", safe="")}&modo=servidor&pase={PASE}'
        chrome = await asyncio.create_subprocess_exec(
            exe, '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
            f'--user-data-dir={CHROME_DIR}', url, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True)
        # (en su propia sesión: el Ctrl+C del terminal le llega solo a este programa, que cierra como /stop y deja al mundo
        # del servidor guardar antes; si le llegara también a Chrome, se cerraría de golpe sin guardar. Lo cierra shutdown)
        print(f'  Abriendo el mundo del servidor (el juego, en un Chrome invisible), con {code_note}…')
        await chrome.wait()
        if closing():
            return
        print('  El mundo del servidor se ha cerrado: lo vuelvo a abrir en 5 segundos')
        await asyncio.sleep(5)
        if closing():
            return


def closing():
    # Cerrando el servidor (/stop, Ctrl+C): el mundo del servidor ya no se vuelve a abrir
    return stopping.is_set() or bool(stop_asked_at)


def start_world():
    global world_task
    if '--sin-mundo' in sys.argv and world_keys:
        print(f'Sin el mundo del servidor (--sin-mundo). Para abrirlo a mano: {code_url()}?servidor={quote(f"ws://127.0.0.1:{PORT}", safe="")}&modo=servidor&pase={PASE}')
    if '--sin-mundo' in sys.argv or not world_keys or (world_task and not world_task.done()):
        return
    world_task = asyncio.get_running_loop().create_task(world_loop())


async def update_code(force=False):
    # /update: renueva la copia de lo publicado y, si es otra, vuelve a abrir el mundo del servidor con ella (guardando
    # antes: se lo pide y, cuando dice que ya ha guardado, o como mucho al rato, se cierra; world_loop lo abre otra vez).
    # Antes mira que la web ya tenga esa versión (GitHub Pages tarda un minuto o dos tras el push): si no, los que
    # recargan seguirían con la de antes y el servidor los echaría por viejos. Si no la tiene, lo hace solo cuando la
    # tenga (watch_published); force (/update ya): sin mirar
    global restart_pending
    if restart_pending:
        print('  El mundo del servidor ya está pasando al código nuevo: un momento')
        return
    if restoring:
        # (cerrarlo a mitad de restaurar podría dejar la copia sin poner; el paso solo a lo publicado lo vuelve a mirar luego)
        print(f'  El mundo del servidor está volviendo a {restoring["label"]}: ' + ('lo paso a lo publicado en cuanto acabe' if AUTO_UPDATE else 'vuelve a escribir /update cuando acabe'))
        return
    target = None if force or CODE == 'trabajo' else await asyncio.to_thread(target_code)
    if target and target[0] != code_dir:
        web = await asyncio.to_thread(web_version)
        if web is None or version_key(web) < version_key(target[1]):
            print(f'  La web todavía no tiene la versión {target[1] or "nueva"} ({"no responde" if web is None else f"tiene la {web}"}): GitHub Pages tarda un minuto o dos tras publicar. '
                  + ('Lo hago yo solo en cuanto la tenga' if AUTO_UPDATE else 'Vuelve a escribir /update en un rato') + ' (o /update ya, sin esperar)')
            return
    changed = await asyncio.to_thread(publish_copy)
    if not changed:
        print(f'  El mundo del servidor ya tiene {code_note}' + ('' if CODE == 'trabajo' else f'. (¿Has publicado? Se toma de {CODE}: lo que se ha subido con git push desde esta carpeta)'))
        return
    print(f'  Copia nueva: {code_note}')
    if not (chrome and chrome.returncode is None):
        start_world()   # (sin el mundo abierto: se abrirá ya con ella)
        return
    print('  Guardando el mundo del servidor para abrirlo con el código nuevo…')
    restart_pending = asyncio.get_running_loop().call_later(20, close_world)
    for c in servers:
        # (el mundo del servidor que dice su versión entiende restart: guarda y avisa; uno de antes, solo save. keep: antes,
        # una copia fija del mundo de ahora, por si la versión nueva lo estropeara; uno de antes no la hace)
        send(c, {'t': 'restart', 'keep': f'antes-de-{code_version or "actualizar"}'} if server_version else {'t': 'save'})


def close_world():
    global restart_pending
    if restart_pending:
        restart_pending.cancel()
    restart_pending = None
    if chrome and chrome.returncode is None:
        chrome.terminate()   # (world_loop lo vuelve a abrir en 5 segundos, ya con la copia nueva)


async def watch_published():
    # Tras publicar (git push desde esta carpeta, que mueve origin/main), el mundo del servidor pasa solo a lo publicado
    # en cuanto la web lo tiene, como con /update: así no sigue llevando el mundo con el código de antes mientras entran
    # los que ya tienen el nuevo. Cada minuto mira el commit (barato, sin red); la web, solo si hay uno nuevo
    while not stopping.is_set():
        await asyncio.sleep(WATCH_EVERY)
        if restart_pending or restoring or stop_asked_at or not code_dir:
            continue
        target = await asyncio.to_thread(target_code)
        if not target or target[0] == code_dir:
            continue
        web = await asyncio.to_thread(web_version)
        if web is not None and version_key(web) >= version_key(target[1]):
            print(f'  Se ha publicado la versión {target[1] or "nueva"}: paso el mundo del servidor a ella (como /update)')
            await update_code(force=True)


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
        print(f'  Mundo del servidor: {state}' + ('' if world_keys else ' (sin claves: que entre el admin)') + f', con {code_note}')
    elif name == 'update':
        asyncio.get_running_loop().create_task(update_code(force=user == 'ya'))
    elif name == 'backups':
        list_backups()
    elif name == 'backup':
        keep_cmd(arg)
    elif name == 'restore':
        restore_cmd(arg)
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
        if restoring and not restoring['done']:
            # (a mitad de /restore, se espera a que el mundo del servidor haya puesto la copia: si no, podría quedar a medias;
            # como mucho RESTORE_WAIT, que restore_timeout lo deja. Otro Ctrl+C cierra ya)
            if not restoring.get('stop'):
                restoring['stop'] = True
                print('  Espero a que el mundo del servidor acabe de volver a la copia para cerrar (otro Ctrl+C: cerrar ya)…')
            asyncio.get_running_loop().call_later(1, command, 'stop')
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
    return f'{code_url()}?servidor={quote(url, safe="")}&local={quote(f"ws://127.0.0.1:{PORT}", safe="")}'


def stop_signal():
    # Ctrl+C cierra como /stop (los juegos guardan antes); otro Ctrl+C, ya
    global stop_asked
    if stop_asked or stopping.is_set():
        if chrome and chrome.returncode is None:
            chrome.terminate()   # (va en su propia sesión: si no, se quedaría abierto)
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
    global stopping, token_recheck
    stopping = asyncio.Event()
    token_recheck = asyncio.Event()
    global tunnel_url
    server = await asyncio.start_server(handle, '127.0.0.1', PORT)
    site = await asyncio.start_server(web, '127.0.0.1', WEB_PORT)
    print(f'Servidor de Miniverse para jugar juntos, en el puerto {PORT}.')
    publish_copy()
    tidy_copies()
    print(f'El mundo del servidor usa {code_note}. '
          + ('Al publicar una versión nueva, pasa solo a ella en cuanto la tenga la web (o con /update).' if AUTO_UPDATE else 'Tras publicar una versión nueva, escribe /update.'))
    if AUTO_UPDATE:
        asyncio.get_running_loop().create_task(watch_published())
    asyncio.get_running_loop().create_task(watch_token())
    print(f'Escribe aquí los comandos del servidor (/help para verlos). Op ahora: {", ".join(sorted(ops)) or "nadie"}.')
    threading.Thread(target=console, args=(asyncio.get_running_loop(),), daemon=True).start()
    asyncio.get_running_loop().add_signal_handler(signal.SIGINT, stop_signal)
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop_signal)
    asyncio.get_running_loop().add_signal_handler(signal.SIGHUP, stop_signal)   # (cerrar la ventana del terminal: igual)
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
        if chrome and chrome.returncode is None:
            # (shutdown ya le ha dicho que se cierre: se le espera un poco, que no quede a medias)
            try:
                await asyncio.wait_for(chrome.wait(), 5)
            except asyncio.TimeoutError:
                chrome.kill()
        print('Servidor cerrado.')
    finally:
        if proc and proc.returncode is None:
            proc.terminate()
        if chrome and chrome.returncode is None:
            chrome.terminate()   # (si se sale por un fallo: el Chrome, en su propia sesión, no se cierra solo)


if __name__ == '__main__':
    if '--copia-fija' in sys.argv:
        sys.exit(0 if fixed_from_latest(option('--copia-fija', 'copia')) else 1)
    if '--codigo-llave' in sys.argv:
        arg = option('--codigo-llave', None)
        sys.exit(0 if copy_key_code(None if not arg or arg.startswith('--') else arg) else 1)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nServidor cerrado.')
