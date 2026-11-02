# Servidor local para jugar: como `python3 -m http.server`, pero le dice al navegador que no guarde
# copias viejas del código (así, al actualizar el juego, siempre carga la versión nueva).
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SinCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(SinCache, directory=str(Path(__file__).parent))
    ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
