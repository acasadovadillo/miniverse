# Paso del juego a 3D

El juego entero pasa del dibujo isométrico en 2D (lienzo y sprites) a 3D con Three.js. **La lógica no cambia**: casillas, trozos y deltas del mundo, mochila, construcción, sistemas (tiempo, huerto, rancho, pesca, vecinos, tablón, combate, exploración, progreso), guardado y menús. Lo que cambia es el dibujo, la cámara y lo que depende de la proyección (moverse según la cámara, saber qué casilla hay bajo el ratón).

## Arquitectura

- `src/three/engine.js` — `View3D`: renderizador, escena, cámara orbital (giro ← →, inclinación ↑ ↓, zoom + − y Ctrl+rueda) o en primera persona (Z; ↑ ↓ miran arriba y abajo, y lo que se lleva en la mano se ve delante), sol con sombras, luz del cielo, cielo con nubes, niebla, día y noche, lluvia, nieve y tormenta según `time.js`, calidad automática, silueta del jugador detrás de las cosas, y `tileAt(clientX, clientY)` (rayo desde la cámara hasta el suelo).
- `src/three/terrain.js` — suelo por trozos de 16 casillas alrededor de la cámara (colores del bioma con la estación, camino y estanque del pueblo, agua de mares y lagos), y un anillo lejano más basto para el horizonte.
- `src/three/world3d.js` — lo que hay en cada trozo (`Overworld.contentFor`): naturaleza, piezas construidas, muebles, estaciones, cultivos, árboles plantados, lugares, cofres del tesoro y cosas del pueblo. Cada trozo se reconstruye solo cuando cambia su firma (lista de objetos y estados).
- `src/three/build3d.js` — piezas: suelos, muros (madera, piedra, entramado, ventanas, cuadro) que se unen con sus vecinos, puertas que se abren y cierran, vallas, hogar y tejados por regiones (a cuatro aguas con la forma que calcula `roofGeometry`), con chimenea. Dentro de una casa: fuera el tejado y las paredes que tapan la vista.
- `src/three/models.js` — modelos de muebles, estaciones, cosas del pueblo, cultivos, lugares (ruinas, campamento, torre, barco, templo, altar, cueva, faro, aldeas).
- `src/three/actors.js` — personas (jugador, Nilo, vecinos, mercaderes), animales (gallina, vaca, oveja), monstruos (limo, murciélago, esqueleto), caballo y barca, con animaciones.
- `src/three/fx.js` — casilla apuntada, vista previa de lo que se coloca o construye, objetos caídos, textos flotantes, astillas, herramienta al golpear, fuego, humo, mariposas, sedal y corcho.
- `src/three/cave3d.js` — cuevas y mazmorras (`GridScene`): roca, suelos, vetas, cristales, escaleras, rejas, palancas, placas, bloques y antorchas.
- `src/camera.js` — estado de la cámara que comparten la lógica y el dibujo (giro, inclinación, distancia).

## Cambios en la lógica

- Moverse: arriba en pantalla es hacia donde mira la cámara (`entities.js`, con el giro de `src/camera.js`).
- Flechas: ← → giran la cámara, ↑ ↓ la inclinan; ya no mueven al jugador (con el mapa abierto sí lo mueven, como antes). + y − acercan y alejan (con el mapa abierto, su zoom).
- La rueda sigue cambiando de objeto; Ctrl+rueda (o pellizcar el panel táctil) acerca y aleja.
- Z cambia entre tercera y primera persona. En primera persona se mira (y se apunta) hacia donde mira la cámara, las casas se ven enteras por dentro y en las cuevas no se recortan las paredes.
- Textos flotantes y astillas se guardan en coordenadas del mundo.
- El mapa grande y el minimapa siguen en 2D y giran con la cámara.

## Estado (01-11-2026)

Hecho y revisado en el navegador:

- Motor: cámara orbital suave (giro, inclinación y zoom), que no atraviesa el suelo y sube por encima de los tejados; cielo con nubes y estrellas, sol según la hora y luna, sombras, niebla, lluvia, nieve, tormentas con rayos y niebla espesa; luces cercanas repartidas entre las fuentes más próximas; silueta del jugador detrás de lo que lo tapa.
- Mundo: suelo con los colores de cada bioma y estación (camino y estanque del pueblo con borde suave), agua con ondas, naturaleza de cada bioma (robles, frutales con flores o manzanas, pinos, sauces, palmeras, cactus, arbustos, matojos, rocas y peñascos con vetas) que cambia con las estaciones, hierba, flores, setas, juncos y piedrecitas, y bosques lejanos hasta la niebla.
- Construcción: suelos, muros que se unen (madera, piedra, entramado, ventanas, contraventanas con jardinera, cuadro), puertas animadas, vallas y muretes, tejados por regiones con chimenea y humo, candelabro en cada casa; dentro de casa se ocultan el tejado y las paredes que dan a la cámara (siguen dando sombra).
- Modelos: estaciones, muebles, rancho, cultivos en cada fase, cosas del pueblo (puestos, tablón, vitrina, fuente, muelle, buzón, farola, cartel), lugares (ruinas, campamento, torre, barco hundido, templo, altar, cueva, faro) y cofres del tesoro.
- Personas (jugador, Nilo, vecinos, mercaderes), animales (gallina, vaca, oveja), monstruos (limo, murciélago, esqueleto), caballo y barca de remos, con su herramienta en la mano y el golpe.
- Efectos: casilla y objeto apuntados, vista previa al colocar y al construir, objetos caídos, textos flotantes, astillas, fuego, humo, mariposas, sedal y corcho, fuente, faro y el destello al recibir un golpe.
- Cuevas y mazmorras: suelo, paredes de roca (o sillares) que se abren entre la cámara y el jugador, vetas, cristales que brillan, escaleras, cofres, rejas, palancas, placas, bloques y antorchas, con el farol del jugador.
- Interfaz: el creador de personaje enseña el modelo en 3D; el mapa y el minimapa giran con la cámara; ajuste de resolución (automática o fija) y F para ver el rendimiento.

Rendimiento (Intel Iris Plus, resolución ×1): unas 140 llamadas de dibujo y 5–6 ms por fotograma; el mapa de sombras se rehace cada dos fotogramas (o cuando se mueve su zona, a saltos de 2 m) y suma unos 5 ms. Lo que se puede pintar por vértice comparte material (`tints.js`); la naturaleza y la hierba van en bloques de 2 × 2 trozos.

La versión en 2D ya no existe (01-11-2026): el juego en 3D está en `main`. Se han quitado el dibujo en 2D de los sistemas (los `draw`, `drawGround` y `drawOverlay`), los lienzos del suelo por trozos (`world/chunks.js`), los sprites de la naturaleza, los lugares, las cuevas, los cultivos y las personas (`art/props.js`, `art/explore.js`, `art/people.js`), y los campos de dibujo de cada objeto (`img`, `ax`, `ay`, sombras pintadas). En `src/art/` solo queda lo que usa la interfaz: iconos de objetos, de piezas de construcción y de animales, colores del suelo por estación y los datos de lo que se coloca (luz, fuego, camas de dos casillas). Las criaturas (`MONSTERS`) viven ahora en `combat.js`. Los retratos de los diálogos son la cara del muñeco en 3D (`three/portrait.js`); el dibujo de personas en pixel art (`art/people3.js`) ya no existe.
