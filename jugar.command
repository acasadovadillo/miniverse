#!/bin/bash
# Lanzador para Mac: arranca un servidor local y abre el juego en el navegador.
# Doble clic para jugar. Cierra esta ventana para apagar el servidor.
cd "$(dirname "$0")"
PORT=8000
while lsof -i :"$PORT" >/dev/null 2>&1; do PORT=$((PORT + 1)); done
echo "Miniverse en http://localhost:$PORT  (cierra esta ventana para salir)"
(sleep 1 && open "http://localhost:$PORT") &
python3 servidor.py "$PORT"
