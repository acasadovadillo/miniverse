# Servidor local para jugar: como `python3 -m http.server`, pero le dice al navegador que no guarde
# copias viejas del código (así, al actualizar el juego, siempre carga la versión nueva). Además deja que
# el juego guarde el archivo de datos cifrados de Alberto (alberto-miniverse-data.enc) en esta carpeta.
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


DATOS = 'alberto-miniverse-data.enc'
MAX_DATOS = 32 * 1024 * 1024


class SinCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    # Solo se puede escribir el archivo de datos cifrados, y solo si lo parece (empieza por "MVENC1")
    def do_PUT(self):
        if self.path.split('?')[0].lstrip('/') != DATOS:
            self.send_error(403)
            return
        size = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(size) if 0 < size <= MAX_DATOS else b''
        if not body.startswith(b'MVENC1'):
            self.send_error(400)
            return
        destino = Path(self.directory) / DATOS
        temporal = destino.with_suffix('.tmp')
        temporal.write_bytes(body)
        os.replace(temporal, destino)
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(SinCache, directory=str(Path(__file__).parent))
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
