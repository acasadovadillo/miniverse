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
#
# Mientras está abierto, en su terminal se escriben los comandos del servidor (como en Minecraft; /ayuda los
# lista): op y deop (los op pueden usar los comandos del juego: /gamemode, /tp, /give…), kick, ban y pardon, la
# lista blanca, list, say, save-all y stop. Cada juego dice al entrar de qué cuenta es (el servidor no lee nada
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
import struct
import sys
import threading
import time
import urllib.request
import webbrowser
from urllib.parse import quote

PORT = 8790
GAME = 'https://acasadovadillo.github.io/miniverse/'
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'   # el de la norma de WebSocket, para responder al saludo
MAX = 32 * 1024 * 1024                          # el mensaje más grande que se acepta (el mundo entero cabe de sobra)

peers = {}        # número de conexión → su escritor
next_id = 1
HERE = os.path.dirname(os.path.abspath(__file__))
OPS_FILE, BANS_FILE, WHITE_FILE = (os.path.join(HERE, n) for n in ('ops.json', 'banned.json', 'whitelist.json'))
BACKUPS = os.path.join(HERE, 'backups')
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
last_backup = 0
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
    if peer_id in peers and peer_id not in users and white['enabled']:
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
    send(me, {'t': 'you', 'id': me, 'peers': others, 'ops': sorted(ops)})
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
        for p in list(peers):
            send(p, {'t': 'leave', 'id': me})
        writer.close()
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
    /op <usuario>, /deop <usuario>, /ops      dar o quitar los comandos de op, y quién los tiene
    /kick <usuario> [motivo]                  echar a alguien (puede volver a entrar)
    /ban <usuario> [motivo], /pardon <usuario>, /banlist   vetar, quitar el veto y ver los vetados
    /whitelist on|off|add <usuario>|remove <usuario>|list  la lista blanca (puesta, solo entran los de la lista)
    /list                                     quién está conectado
    /say <texto>                              un aviso en el chat de todos
    /save-all                                 que todos guarden ya (quien lleva el mundo, también el mundo)
    /stop                                     guardar y cerrar el servidor'''


def conns_of(user):
    return [c for c, u in users.items() if u == user]


def command(line):
    # Un comando escrito en este terminal (con o sin la barra)
    name, _, arg = line.strip().lstrip('/').partition(' ')
    name = name.lower()
    user, _, rest = arg.strip().partition(' ')
    user, rest = user.lower(), rest.strip()
    if not name:
        return
    if name in ('op', 'deop'):
        if not user:
            print(f'  Uso: /{name} <usuario>')
            return
        if name == 'op':
            ops.add(user)
        else:
            ops.discard(user)
        save_json(OPS_FILE, sorted(ops))
        everyone({'t': 'ops', 'ops': sorted(ops)})
        print(f'  {user} {"ya es op" if name == "op" else "ya no es op"} (op: {", ".join(sorted(ops)) or "nadie"})')
    elif name == 'ops':
        print(f'  Op: {", ".join(sorted(ops)) or "nadie"}')
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
    elif name == 'save-all':
        everyone({'t': 'save'})
        print('  Guardando: cada juego guarda lo suyo, y quien lleva el mundo, el mundo')
    elif name == 'stop':
        everyone({'t': 'stop'})
        print('  Cerrando el servidor (los juegos guardan antes)…')
        asyncio.get_running_loop().call_later(3, shutdown)
    else:
        print(HELP)


def console(loop):
    # Lo que se escribe en el terminal, línea a línea, en su propio hilo (que no impide cerrar el programa)
    for line in sys.stdin:
        loop.call_soon_threadsafe(command, line)


def shutdown():
    for w in list(peers.values()):
        w.close()
    stopping.set()


async def main():
    global stopping
    stopping = asyncio.Event()
    server = await asyncio.start_server(handle, '127.0.0.1', PORT)
    print(f'Servidor de Miniverse para jugar juntos, en el puerto {PORT}.')
    print(f'Escribe aquí los comandos del servidor (/ayuda para verlos). Op ahora: {", ".join(sorted(ops)) or "nadie"}.')
    threading.Thread(target=console, args=(asyncio.get_running_loop(),), daemon=True).start()
    proc = None
    if '--sin-tunel' in sys.argv:
        print(f'Sin túnel: solo desde este ordenador, en ws://localhost:{PORT}')
    else:
        print('Abriendo el túnel…')
        proc, https = await tunnel()
        url = 'wss://' + https[len('https://'):]
        print(f'Túnel abierto: {url}\nEsperando a que responda (suele tardar unos segundos)…')
        if not await ready(https):
            print('El túnel todavía no responde. Abro el juego igualmente: seguirá intentando conectar.')
        link = f'{GAME}?servidor={quote(url, safe="")}'
        print(f'Listo. Abriendo el juego: {link}\n'
              'Entra con tu cuenta y juega: los demás verán que estás jugando. Para cerrar el servidor, Ctrl+C.')
        webbrowser.open(link)
    try:
        async with server:
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
