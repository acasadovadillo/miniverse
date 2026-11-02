# Miniverse

**Jugar: <https://acasadovadillo.github.io/miniverse/>**

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

Al entrar sale la pantalla de inicio de sesión. Las cuentas las crea el administrador (Alberto) y cada partida va cifrada con la contraseña de su jugador (ver *Cuentas*). La primera vez se entra con el código de invitación que da el administrador y se elige la contraseña.

1. Pulsa **Crear tu personaje**: nombre, cuerpo y ropa, cara (ojos y su color, cejas, nariz, orejas y mofletes) y pelo (23 peinados y barba). Mantén pulsados los botones de giro, las flechas ← → o arrastra sobre el personaje para girarlo; en la pestaña Cara la cámara se acerca.
2. Empiezas con hacha, pico, guadaña, azada, tres manzanas y 100 monedas. **Habla con Nilo** en la plaza: te enseña a hacer un banco de carpintero.
3. Tala, pica y siega fuera del pueblo, fabrica (C) y coloca estaciones. Cada material nuevo desbloquea recetas.
4. Tu casa es parte del mundo: entras andando por la puerta y el tejado se oculta. Está hecha de las mismas piezas que puedes construir tú (B) en cualquier parte, y puedes cambiarla o amueblarla a tu gusto. Siembra, compra animales a Rosa, pesca con Lía, haz encargos del tablón y paga los proyectos del pueblo.
5. Explora: cuevas con niveles infinitos, ruinas, campamentos, torres, barcos hundidos, templos con puzles y aldeas lejanas. Los cofres guardan las páginas del diario del farero…

La partida se guarda sola cada 15 segundos, al entrar o salir de una casa y al dormir.

### Controles

| Acción | Teclado y ratón | Móvil |
| --- | --- | --- |
| Caminar / correr | WASD / Shift (arriba es hacia donde mira la cámara) | Cruceta |
| Usar lo que llevas (talar, picar, regar, sembrar, pescar, atacar, comer, colocar…) | Clic izquierdo (mantén para seguir) | Botón ⚒ |
| Pescar | Con la caña, mantén el clic para coger fuerza y suelta para lanzar; cuando pique, clic. En la pelea, mantén el clic (o Espacio) para subir la red | Botón ⚒, igual |
| Saltar | Espacio (con un diálogo abierto, seguir) | Botón ⤒ |
| Interactuar (hablar, puertas, cofres, estaciones, dormir, cosechar, animales) | E o Enter | Botón E |
| Elegir objeto | 1–9 o rueda | Tocar la casilla |
| Girar lo que vas a colocar | R | — |
| Mochila / Fabricar / Construir | I / C / B | 🎒 / 🧰 / 🔨 |
| En modo construcción | Clic pone (arrastra para pintar), clic derecho o X quita | Tocar pone; pestaña «Quitar» |
| Diario (historia, vecinos, habilidades, pesca, museo, logros) | J | Desde el menú ☰ |
| Mapa (con él abierto: moverlo, acercarlo y volver a tu sitio) | M o clic en el minimapa (WASD, flechas o arrastrar; Shift, más rápido; + y − o rueda; ⌖) | Tocar el minimapa (arrastrar; botones + y −; ⌖) |
| Pausa (guardar, diario, controles, ajustes) | Esc | Botón ☰ |
| Chat y comandos (`/ayuda`, `/admin`) | T, o / para empezar con el comando | — |
| Girar la cámara (suave, mientras se mantiene) | Flecha izquierda / flecha derecha | — |
| Subir o bajar la cámara (de casi cenital a ras de suelo) | Flecha arriba / flecha abajo | — |
| Acercar o alejar la cámara | + / − (o Ctrl + rueda, o pellizcar el panel táctil) | — |
| Primera o tercera persona | Z (en primera persona, flecha arriba / abajo para mirar arriba y abajo) | — |
| Ver el rendimiento | F | — |
| Colocar muebles y estaciones | Apunta con el ratón (hasta 4 casillas) y clic | Delante del jugador |

## Lo que hay en el juego

- **Mundo infinito** con 12 biomas, ríos, lagos y mar; día y noche (un día dura 20 minutos), cuatro estaciones de 7 días que cambian los colores, y clima: lluvia, tormenta, niebla y nieve.
- **Recolectar y fabricar**: herramientas de madera, piedra, cobre, hierro y oro; banco, horno, yunque, telar y cocina; recetas que se desbloquean.
- **Todo en cuadrícula**, como en Minecraft: cada árbol, roca, arbusto, farola, cartel o puesto ocupa una casilla, y las casas del pueblo y de las aldeas están hechas de piezas de construcción. Solo las personas, los animales y las partículas se mueven libres.
- **Construir**: suelos, muros (de madera, de piedra y de entramado con zócalo; tabiques finos que se unen solos en esquinas, T y cruces, y miden el doble que una persona; el suelo de debajo llega hasta el muro y no asoma por fuera), ventanas (con o sin contraventanas y jardinera), puertas que se abren y cierran, tejados a cuatro aguas en cinco materiales (al entrar en una casa se ocultan el tejado y las paredes que dan a la cámara; el tejado sigue dando sombra y el sol entra por las ventanas), hogar con chimenea que da luz y echa humo, candelabro en cada casa, y vallas que se unen solas; muebles que se giran, cofres, camas de dos casillas, lámparas. Las casas miden 12×10 casillas. Tu casa se amplía hablando con Nilo.
- **Granja**: siete cultivos por estación, regadera, aspersores, abono, árboles que se plantan, manzanos; gallinas, vacas, ovejas, colmenas y comederos.
- **Pesca** con minijuego: mantén pulsado para coger fuerza y suelta para lanzar (más lejos, peces algo más grandes y raros). El corcho tiembla alguna vez sin que sea nada; cuando pica de verdad, pulsa a tiempo. En la pelea, el pez sube y baja por una columna de agua y hay que tenerlo dentro de la red, que sube mientras mantienes pulsado y baja al soltar; con el pez dentro se llena la barra de captura y fuera se vacía. Cada pez pelea a su manera (calmo, mixto, nervioso, del fondo o de superficie) y con su dificultad. A veces aparece un tesoro que se coge igual, con la red encima. Sin que el pez se salga nunca de la red, la captura es perfecta: más experiencia y más talla. Dieciséis peces según el agua, la estación, la hora y el tiempo (el siluro sale con lluvia), cada uno con su talla en centímetros y su récord en el cuaderno de pesca del diario. La caña de fibra de Lía hace la red más grande y que piquen antes; la habilidad de pesca también agranda la red.
- **Personajes** chibi en 3D hechos con el mismo "look" que se elige al crear el personaje (peinados, colores, ropa, forma de los ojos, cejas, nariz, orejas, barba y mofletes; ver `src/looks.js`), que andan, respiran y miran hacia donde van; en los diálogos sale la cara en 3D de quien habla (`src/three/portrait.js`). Llevan en la mano la herramienta elegida y la balancean al golpear.
- **Pueblo vivo**: Rosa, Lía, Bruno, Nilo y, si construyes su casa, Dani. Horarios, charlas, regalos, amistad con eventos, tiendas, tablón de encargos y cuatro proyectos (fuente, muelle, mercado y casa nueva).
- **Aventura**: cuevas con niveles infinitos (vetas, gemas, fósiles, criaturas), templos con puzles (palanca, llave y bloque sobre placa), combate ligero con corazones, barca y caballo, y una historia ligera hasta el faro del confín.
- **Inventario realista**: sin mochila solo llevas lo que cabe en las manos y los bolsillos (las 9 casillas de la barra). La mochila (a mano, con fibra y cuerda) se lleva a la espalda y desbloquea 27 casillas más; para quitártela tiene que estar vacía. La ropa son objetos que te pones y te quitas, cada uno en su hueco del cuerpo (cabeza, torso, encima, piernas, pies, ropa interior de arriba y de abajo, calcetines y espalda), y el personaje se ve con lo que lleva: camisa, túnica corta o larga, chaleco, delantal, pantalón, falda, botas, camiseta interior, calzoncillos o bragas, calcetines, hiyab, sombrero de paja y gorro de lana. Sin nada, es un muñeco liso. La ropa se teje en el telar (el sombrero, a mano).
- **Familia**: Nilo convierte la casa ampliada en la **casa familiar** (18 × 14 casillas), con dormitorio, cuarto de los niños, baño, cocina y salón. Los muebles nuevos se fabrican en el banco: cama doble (2 × 2), cama de niño, cuna, alacena, fregadero, bañera, retrete y lavabo. Jugando juntos, con los dos en casa, uno propone tener un bebé en la cama doble y el otro acepta: a los 7 días nace (hace falta una cuna libre) y se le pone nombre; a los 7 días más es un niño que pasea por casa y por el jardín de día y duerme en su cama de noche. Como mucho, dos; se parecen a los dos padres.
- **Progreso**: ocho habilidades que suben con el uso, museo con 37 piezas (minerales, fósiles, peces e insectos), 22 logros y estadísticas.
- **Ajustes**: volúmenes, música generada, resolución (automática o fija), texto grande y reducir destellos. Los volúmenes se guardan en la partida de cada cuenta y se usan al entrar, en cualquier ordenador; lo demás es de cada dispositivo. Los controles están en su propia sección de la pausa.

## Publicación

El juego es estático y se publica con GitHub Pages desde la rama `main` (carpeta raíz): cada `git push` a `main` actualiza <https://acasadovadillo.github.io/miniverse/> en un minuto o dos.

### Cuentas

- **Dónde están.** La lista de cuentas es `accounts.json`, en este repositorio. Las partidas, `<usuario>-miniverse-data.enc`, van en el repositorio privado [Miniverse-data](https://github.com/acasadovadillo/Miniverse-data) y, además, en el navegador de cada ordenador. Al entrar se usa la más reciente de las dos.
- **Cifrado.** Cada partida va cifrada con AES-GCM de 256 bits. La clave sale de la contraseña de su jugador (PBKDF2 con SHA-256, 310 000 vueltas y una sal por cuenta). Descifrada solo está en memoria mientras se juega. Las contraseñas no se guardan en ningún sitio: si se olvidan, la partida no se puede recuperar.
- **Tokens.** Cada cuenta tiene su *token de guardado*: un token de GitHub de grano fino con acceso solo a Miniverse-data y permiso *Contents: Read and write*. El token va cifrado en `accounts.json` con la contraseña de su jugador (o con su código de invitación, hasta que la pone). El de Alberto, *token de admin*, tiene además acceso a este repositorio para reescribir `accounts.json`.
- **Crear la cuenta de admin (la primera vez).** Entra como *Alberto*, escribe tu contraseña dos veces y pega tu token de admin.
- **Crear una cuenta.** Con la sesión de Alberto y `/admin` activado, escribe en el chat `/account create <usuario>`. Pega su token de guardado y pásale a esa persona el código de invitación que sale. La primera vez, ella escribe su usuario, el código y la contraseña que quiera (dos veces); entonces se crean su `<usuario>-key.json` y su `<usuario>-miniverse-data.enc` en Miniverse-data. La próxima vez que entres tú, su token pasa a `accounts.json` y ya solo necesita su contraseña, en cualquier dispositivo.
- **Al día.** Mientras juegas, tu juego pasa a `accounts.json` cada pocos minutos las cuentas que ya tienen contraseña, así que no hace falta volver a entrar cuando alguien activa la suya.
- **Otros comandos.** `/account list` muestra las cuentas. `/account reset <usuario>` le da un token y un código nuevos (si el token caduca o se pierde el código); conserva su contraseña y su partida. `/account delete <usuario>` borra la cuenta y su partida.
- **Límites.** GitHub no deja limitar un token a un solo archivo, así que con su token un jugador podría borrar o cambiar archivos de otros en Miniverse-data. No podría leerlos, porque van cifrados, y el historial de git permite recuperarlos. La partida se sube a GitHub al guardar desde la pausa, al salir al menú y, mientras se juega, como mucho cada 3 minutos.

### Jugar juntos en directo

- **Abrir el servidor.** En tu Mac, desde esta carpeta: `python3 multijugador.py`. La primera vez instala el túnel con `brew install cloudflared`. El programa abre un túnel (una dirección `https://….trycloudflare.com` que cambia cada vez, gratis y sin cuenta) y abre el juego ya conectado. Entra con tu cuenta: tu juego publica la dirección en `servidor.json`, en Miniverse-data. Para cerrarlo, Ctrl+C.
- **Entrar los demás.** Desde la web de siempre: al iniciar sesión, el menú dice si estás jugando. Mientras juegas, su botón **Jugar** les lleva a tu mundo con su propio personaje; cuando no juegas, el mundo está cerrado (solo hay uno: el tuyo).
- **Qué es de todos.** Tu mundo con todo lo construido: lo que se tala, se pica, se construye o se quita, el huerto, las puertas y los cofres cambia en directo para todos. También son de todos la hora y el tiempo, la casa, los proyectos y los encargos del tablón, el museo y los animales. Lo que se tira al suelo lo puede recoger otro (así se dan cosas: lo que uno tira, los primeros segundos es solo para los demás).
- **Qué es de cada uno.** El personaje y su ropa, lo que lleva encima, el dinero, la energía y la vida, las habilidades, los logros, la amistad con los vecinos y el mapa descubierto. Se guarda en la partida de cada uno, que conserva aparte su mundo de siempre; la próxima vez vuelve a aparecer donde se quedó en el tuyo.
- **Lo que lleva tu juego.** El mundo se guarda en tu partida, como siempre. Tu juego hace pasar la hora y crecer los cultivos, se ocupa de los animales y reparte los cambios: si dos tocan lo mismo a la vez (el mismo cofre, por ejemplo), se queda lo último que llega a tu juego. Los demás pueden dormir para recuperar energía, pero la noche solo la pasa tu juego. Si sales al menú o cierras el servidor, los demás vuelven a su menú con lo suyo guardado.
- **Qué se ve.** A los demás jugadores con su ropa y su nombre encima: cómo andan, saltan, montan a caballo o van en barca, y lo que llevan en la mano y cuándo lo usan. El chat llega a todos. Juntos solo en el mundo de fuera: en las cuevas cada uno va por su cuenta.
- **Cifrado.** Los mensajes van cifrados con la *clave del mundo*, que solo tienen las cuentas: el servidor y el túnel solo ven datos sin sentido. Cada cuenta tiene un par de claves ECDH en `<usuario>-claves.json` (la privada, cifrada con su contraseña); tu juego le da la clave del mundo a cada cuenta cifrada con el secreto que solo compartís los dos. Se la da al entrar, cada pocos minutos mientras juegas y en cuanto la pide al conectarse.
- **Para probar en un solo ordenador:** `python3 multijugador.py --sin-tunel` y abre el juego con `?servidor=ws://localhost:8790`.

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
multijugador.py        Servidor para jugar juntos en directo (repetidor WebSocket y túnel)
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
src/fishing.js         Pesca: lanzar, picadas, la pelea con el pez, tesoros, tallas y cuaderno de pesca
src/neighbors.js       Vecinos, horarios, amistad y regalos
src/board.js           Tablón de encargos y proyectos del pueblo
src/economy.js         Precios y tiendas
src/combat.js          Vida, criaturas y combate
src/explore.js         Lugares del mundo, cofres, cuevas, templos, barca y caballo
src/progress.js        Estadísticas, habilidades, museo, logros e historia
src/music.js           Música generada
src/settings.js        Ajustes
src/share.js           Partidas de las versiones de antes (para cifrarlas)
src/audio.js           Sonidos
src/accounts.js        Cuentas: entrar, invitaciones, /account y guardar la partida cifrada
src/family.js          Familia: tener hijos, nacer, crecer y la vida de los niños
src/live.js, livesync.js, net.js, worldkey.js   Jugar juntos en directo: los demás jugadores, el mundo compartido, la conexión cifrada y la clave del mundo
src/vault.js, github.js  Cifrado (AES-GCM, PBKDF2) y archivos en GitHub (accounts.json, Miniverse-data)
src/db.js, save.js, worldstore.js   IndexedDB (la partida cifrada de cada cuenta y las partidas de versiones anteriores)
src/util.js, iso.js, physics.js                   Utilidades, proyección y colisiones
src/art/               Personajes, naturaleza, iconos, estaciones, construcción, granja, exploración y estaciones del año
src/world/             Biomas, generador, trozos, pueblo, interiores, escenas y subterráneos
src/ui/                HUD, menús, mapa, mochila, fabricar, construir, cofre, tienda, diario, ajustes y paneles de la pesca
docs/roadmap.md        Plan por fases
docs/roadmap-aaa.md    Revisión del juego y roadmap hacia un acabado AAA
capturas/              Capturas de cada fase
```
