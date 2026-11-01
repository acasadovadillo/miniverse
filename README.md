# Pueblo Brotes

Sandbox en 3D (con estética cálida y de pocos polígonos, al estilo de los juegos de vida en un pueblo) con un mundo infinito. Empiezas en Pueblo Brotes, una aldea hecha a mano; a partir de ahí el mundo se genera solo en todas direcciones. Hay un solo mundo, el mismo para todas las partidas. Puedes recolectar, fabricar, construir y decorar, cultivar, criar animales, pescar, hacer amigos, explorar cuevas y templos… y buscar el faro del confín del mundo.

Estado: **fases 0 a 10 completadas** y la parte sin servidor de la fase 11. Consulta el plan en [docs/roadmap.md](docs/roadmap.md).

## Cómo jugar

En Mac, haz **doble clic en `jugar.command`**: arranca un servidor local y abre el juego en el navegador. Cierra la ventana del terminal para apagarlo.

En cualquier sistema también puedes ejecutar esto dentro de la carpeta y entrar en <http://localhost:8000>:

```bash
python3 servidor.py 8000
```

(`servidor.py` es como `python3 -m http.server`, pero evita que el navegador se quede con versiones viejas del código. Abrir `index.html` con doble clic no funciona: el código usa módulos de JavaScript y el navegador los bloquea sin servidor.)

### Primeros pasos

1. **Crea una cuenta** (local, en este navegador) y pulsa **Nueva partida**: nombre y aspecto.
2. Empiezas con hacha, pico, guadaña, azada, tres manzanas y 100 monedas. **Habla con Nilo** en la plaza: te enseña a hacer un banco de carpintero.
3. Tala, pica y siega fuera del pueblo, fabrica (C) y coloca estaciones. Cada material nuevo desbloquea recetas.
4. Tu casa es parte del mundo: entras andando por la puerta y el tejado se oculta. Está hecha de las mismas piezas que puedes construir tú (B) en cualquier parte, y puedes cambiarla o amueblarla a tu gusto. Siembra, compra animales a Rosa, pesca con Lía, haz encargos del tablón y paga los proyectos del pueblo.
5. Explora: cuevas con niveles infinitos, ruinas, campamentos, torres, barcos hundidos, templos con puzles y aldeas lejanas. Los cofres guardan las páginas del diario del farero…

La partida se guarda sola cada 15 segundos, al entrar o salir de una casa y al dormir.

### Controles

| Acción | Teclado y ratón | Móvil |
| --- | --- | --- |
| Caminar / correr | WASD / Shift (arriba es hacia donde mira la cámara) | Cruceta |
| Usar lo que llevas (talar, picar, regar, sembrar, pescar, atacar, comer, colocar…) | Espacio o clic (mantén para seguir) | Botón ⚒ |
| Interactuar (hablar, puertas, cofres, estaciones, dormir, cosechar, animales) | E o Enter | Botón E |
| Elegir objeto | 1–9 o rueda | Tocar la casilla |
| Girar lo que vas a colocar | R | — |
| Mochila / Fabricar / Construir | I / C / B | 🎒 / 🧰 / 🔨 |
| En modo construcción | Clic pone (arrastra para pintar), clic derecho o X quita | Tocar pone; pestaña «Quitar» |
| Diario (historia, vecinos, habilidades, museo, logros) | J | Desde el menú ☰ |
| Mapa (con él abierto: moverlo, acercarlo y volver a tu sitio) | M o clic en el minimapa (WASD, flechas o arrastrar; Shift, más rápido; + y − o rueda; ⌖) | Tocar el minimapa (arrastrar; botones + y −; ⌖) |
| Pausa (guardar, diario, controles, ajustes) | Esc | Botón ☰ |
| Chat y comandos (`/ayuda`, `/admin`) | T, o / para empezar con el comando | — |
| Girar la cámara (suave, mientras se mantiene) | Flecha izquierda / flecha derecha | — |
| Subir o bajar la cámara (de casi cenital a ras de suelo) | Flecha arriba / flecha abajo | — |
| Acercar o alejar la cámara | + / − (o Ctrl + rueda, o pellizcar el panel táctil) | — |
| Ver el rendimiento | F | — |
| Colocar muebles y estaciones | Apunta con el ratón (hasta 4 casillas) y clic o Espacio; sin ratón, la casilla de delante | Delante del jugador |

## Lo que hay en el juego

- **Mundo infinito** con 12 biomas, ríos, lagos y mar; día y noche (un día dura 20 minutos), cuatro estaciones de 7 días que cambian los colores, y clima: lluvia, tormenta, niebla y nieve.
- **Recolectar y fabricar**: herramientas de madera, piedra, cobre, hierro y oro; banco, horno, yunque, telar y cocina; recetas que se desbloquean.
- **Todo en cuadrícula**, como en Minecraft: cada árbol, roca, arbusto, farola, cartel o puesto ocupa una casilla, y las casas del pueblo y de las aldeas están hechas de piezas de construcción. Solo las personas, los animales y las partículas se mueven libres.
- **Construir**: suelos, muros (de madera, de piedra y de entramado con zócalo; tabiques finos que se unen solos en esquinas, T y cruces, y miden el doble que una persona; el suelo de debajo llega hasta el muro y no asoma por fuera), ventanas (con o sin contraventanas y jardinera), puertas que se abren y cierran, tejados a cuatro aguas en cinco materiales (al entrar en una casa se ocultan el tejado y las paredes que dan a la cámara; el tejado sigue dando sombra y el sol entra por las ventanas), hogar con chimenea que da luz y echa humo, candelabro en cada casa, y vallas que se unen solas; muebles que se giran, cofres, camas de dos casillas, lámparas. Las casas miden 12×10 casillas. Tu casa se amplía hablando con Nilo.
- **Granja**: siete cultivos por estación, regadera, aspersores, abono, árboles que se plantan, manzanos; gallinas, vacas, ovejas, colmenas y comederos; pesca con doce peces según agua, estación y hora.
- **Personajes** chibi en 3D hechos con el mismo "look" que se elige al crear el personaje (ocho peinados, colores, ropa), que andan, respiran y miran hacia donde van; el retrato de quien habla sale en los diálogos. Llevan en la mano la herramienta elegida y la balancean al golpear.
- **Pueblo vivo**: Rosa, Lía, Bruno, Nilo y, si construyes su casa, Dani. Horarios, charlas, regalos, amistad con eventos, tiendas, tablón de encargos y cuatro proyectos (fuente, muelle, mercado y casa nueva).
- **Aventura**: cuevas con niveles infinitos (vetas, gemas, fósiles, criaturas), templos con puzles (palanca, llave y bloque sobre placa), combate ligero con corazones, barca y caballo, y una historia ligera hasta el faro del confín.
- **Progreso**: ocho habilidades que suben con el uso, museo con 33 piezas (minerales, fósiles, peces e insectos), 20 logros y estadísticas.
- **Ajustes**: volúmenes, música generada, resolución (automática o fija), texto grande y reducir destellos. Los controles están en su propia sección de la pausa.
- **Compartir sin servidor**: exportar e importar la partida a un archivo y visitar lo que ha hecho otra persona sin guardar nada.

## Publicar en GitHub Pages

El juego es estático: basta con subir la carpeta a un repositorio y activar Pages.

1. Crea un repositorio en GitHub y sube el contenido de esta carpeta (con `index.html` en la raíz).
2. En *Settings → Pages*, elige *Deploy from a branch*, rama `main` y carpeta `/ (root)`.
3. En un minuto estará en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

Las cuentas y partidas se guardan en el navegador de cada jugador (IndexedDB), así que cada persona tiene las suyas.

## Cómo está hecho

- JavaScript con módulos y **Three.js** (r160, se carga de jsDelivr: la primera vez hace falta internet), sin paso de compilación. Todos los modelos, texturas y la música se generan con código.
- **Dibujo en 3D** (`src/three/`): la lógica del juego no sabe nada del dibujo; cada fotograma, la vista copia el estado del mundo a la escena. Cámara orbital con giro, inclinación y zoom suaves que no atraviesa el suelo y sube por encima de los tejados; sol según la hora con sombras, luna, cielo con nubes y estrellas, niebla, lluvia, nieve y tormentas; luces cercanas (hogares, antorchas, lámparas, candelabros) repartidas entre las fuentes más próximas. Ver [docs/migracion-3d.md](docs/migracion-3d.md).
- **Mundo por trozos** de 16×16 casillas: cerca de la cámara va todo (con la naturaleza y la hierba en bloques de 2×2 trozos); más lejos, solo los árboles, sencillos y sin sombra, hasta donde llega la niebla. El suelo va en bloques de 64 casillas pintados con los colores de cada bioma y estación.
- **Un solo mundo**: se genera siempre igual a partir de una semilla fija (`WORLD_SEED` en `src/world/gen.js`), con los mismos lugares y las mismas cuevas para todos. Una partida guardada en otro mundo (de antes de este cambio) pasa a este: lo construido se queda, y el mapa y los lugares se descubren de nuevo.
- **Cambios del jugador por trozo**: lo talado, picado y segado (que no vuelve a crecer: la casilla queda libre), lo labrado, lo construido en tres capas (suelo, objeto y tejado), cultivos, árboles plantados, cofres… Solo se guardan los trozos que cambian.
- **Sistemas que se enchufan**: tiempo, huerto, granja, pesca, vecinos, tablón, combate, exploración y progreso se registran en el juego con los mismos ganchos (guardar, actualizar, dibujar, interactuar, cambio de día).
- Bucle de paso fijo (60 pasos por segundo). En un Intel Iris Plus, un fotograma cuesta unos 6 ms y unos 11 ms cuando se rehace el mapa de sombras (cada dos fotogramas); la resolución baja sola si va lento.

## Archivos

```
index.html             Página, estilos e interfaz
jugar.command          Lanzador para Mac
servidor.py            Servidor local sin caché
src/main.js            Punto de entrada
src/game.js            Núcleo: estado, bucle, interacciones y sistemas
src/camera.js          Estado de la cámara (giro, inclinación y distancia)
src/three/             Dibujo en 3D: motor, suelo, mundo por trozos, construcción, modelos, naturaleza, personas y animales, efectos, cuevas
src/entities.js        Personas y jugador (movimiento, barca, caballo)
src/input.js           Teclado, ratón y controles táctiles
src/items.js           Objetos, niveles de herramienta, cultivos, peces, insectos y recolección
src/recipes.js         Estaciones y recetas
src/inventory.js       Mochila
src/gather.js          Recolectar, colocar, comer y efectos
src/crafting.js        Fabricar
src/pieces.js          Piezas de construcción
src/build.js           Modo construcción
src/time.js            Hora, días, estaciones, clima y luz
src/farm.js            Huerto y árboles plantados
src/ranch.js           Animales, colmenas y comederos
src/fishing.js         Pesca
src/neighbors.js       Vecinos, horarios, amistad y regalos
src/board.js           Tablón de encargos y proyectos del pueblo
src/economy.js         Precios y tiendas
src/combat.js          Vida, criaturas y combate
src/explore.js         Lugares del mundo, cofres, cuevas, templos, barca y caballo
src/progress.js        Estadísticas, habilidades, museo, logros e historia
src/music.js           Música generada
src/settings.js        Ajustes
src/share.js           Exportar, importar y visitar
src/audio.js           Sonidos
src/db.js, accounts.js, save.js, worldstore.js   Guardado en IndexedDB
src/util.js, iso.js, physics.js                   Utilidades, proyección y colisiones
src/art/               Personajes, naturaleza, iconos, estaciones, construcción, granja, exploración y estaciones del año
src/world/             Biomas, generador, trozos, pueblo, interiores, escenas y subterráneos
src/ui/                HUD, menús, mapa, mochila, fabricar, construir, cofre, tienda, diario y ajustes
docs/roadmap.md        Plan por fases
capturas/              Capturas de cada fase
```
