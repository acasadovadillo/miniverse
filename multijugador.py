# Servidor para jugar juntos en directo. Es un repetidor de mensajes (WebSocket): lo que manda cada jugador
# se lo pasa a los demás. No entiende lo que reparte, porque el juego cifra sus mensajes con la clave del
# mundo, que solo tienen las cuentas; aquí solo se ve a quién va cada uno.
#
# Para que se pueda entrar desde otra casa abre un túnel con cloudflared (gratis y sin cuenta: una dirección
# https://….trycloudflare.com que cambia cada vez) y abre el juego en el navegador ya conectado a él. El
# juego del admin publica esa dirección en GitHub y así los demás la encuentran al iniciar sesión.
#
#   python3 multijugador.py              servidor, túnel y el juego abierto
#   python3 multijugador.py --sin-tunel  solo el servidor, en ws://localhost:8790 (para probar en este ordenador)
#
# Solo usa la biblioteca estándar de Python. El túnel necesita cloudflared: brew install cloudflared
import asyncio
import base64
import hashlib
import json
import re
import shutil
import struct
import sys
import webbrowser
from urllib.parse import quote

PORT = 8790
GAME = 'https://acasadovadillo.github.io/miniverse/'
GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'   # el de la norma de WebSocket, para responder al saludo
MAX = 32 * 1024 * 1024                          # el mensaje más grande que se acepta (el mundo entero cabe de sobra)

peers = {}        # número de conexión → su escritor
next_id = 1


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
    send(me, {'t': 'you', 'id': me, 'peers': others})
    for p in others:
        send(p, {'t': 'join', 'id': me})
    print(f'  + Se ha conectado alguien ({len(peers)} conectados)')
    try:
        async for raw in messages(reader, writer):
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict) or msg.get('t') != 'msg':
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
        peers.pop(me, None)
        for p in list(peers):
            send(p, {'t': 'leave', 'id': me})
        writer.close()
        print(f'  - Se ha ido alguien ({len(peers)} conectados)')


async def tunnel():
    # Abre el túnel y devuelve su dirección (wss://…). El proceso sigue abierto mientras dure el servidor.
    exe = shutil.which('cloudflared')
    if not exe:
        print('Falta cloudflared, que abre el túnel para que se pueda entrar desde otra casa. Instálalo con:\n\n'
              '    brew install cloudflared\n\no prueba solo en este ordenador con: python3 multijugador.py --sin-tunel')
        sys.exit(1)
    proc = await asyncio.create_subprocess_exec(exe, 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{PORT}',
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    while True:
        line = await proc.stdout.readline()
        if not line:
            print('cloudflared se ha cerrado sin abrir el túnel.')
            sys.exit(1)
        m = re.search(r'https://[-a-z0-9]+\.trycloudflare\.com', line.decode(errors='replace'))
        if m:
            break
    async def drain():                   # (lo que siga escribiendo cloudflared, que no se atasque)
        while await proc.stdout.readline():
            pass
    asyncio.create_task(drain())
    return proc, 'wss://' + m.group(0)[len('https://'):]


async def main():
    server = await asyncio.start_server(handle, '127.0.0.1', PORT)
    print(f'Servidor de Miniverse para jugar juntos, en el puerto {PORT}.')
    proc = None
    if '--sin-tunel' in sys.argv:
        print(f'Sin túnel: solo desde este ordenador, en ws://localhost:{PORT}')
    else:
        print('Abriendo el túnel…')
        proc, url = await tunnel()
        link = f'{GAME}?servidor={quote(url, safe="")}'
        print(f'Túnel abierto: {url}\nAbriendo el juego: {link}\n'
              'Entra con tu cuenta y los demás verán que estás jugando. Para cerrar el servidor, Ctrl+C.')
        webbrowser.open(link)
    try:
        async with server:
            await server.serve_forever()
    finally:
        if proc and proc.returncode is None:
            proc.terminate()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\nServidor cerrado.')
