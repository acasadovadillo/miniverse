# Miniverse: hoja de ruta de mejoras (noviembre de 2026)

> Punto de partida: la versión 2026-11-03.17, con las fases 1 a 6 del plan «Minecraft» hechas, los comandos, el planeta, el taller, la noria y los muebles nuevos. Unas 18 700 líneas en `src/`.
>
> Dos partes. La **primera** es revisar lo que ya hay y mejorarlo (rendimiento, estética, interfaz, mecánicas y código), **sin añadir nada**. La **segunda** es añadir cosas nuevas, ordenadas de más a menos útiles, y pensadas para que luego se puedan seguir mejorando.
>
> Tamaño: **S** (1 o 2 sesiones), **M** (3 a 5), **L** (6 o más). Cada punto dice qué se ha visto, qué hacer y cuándo está hecho. Lo medido se midió en el juego en local, en el navegador del editor (que va algo más lento que Chrome a pantalla completa): sirve para comparar, no como cifra exacta.

---

## Parte 1 · Revisar y mejorar lo que ya hay

### 1. Rendimiento

**1.1 Tirones al entrar en terreno nuevo (L, lo primero).** ✅ Hecho el 3-11-2026 (worker del suelo: `ground.js` y `genworker.js`; al cargar, el primer fotograma pasó de 1,7 s a 0,5 s y, al teletransportarse, de 1,4 s a 0,26 s; lo que queda es la naturaleza de los trozos, que se hace de golpe al «snap»). Andando por terreno sin visitar, casi la mitad de los fotogramas pasan de 33 ms (42 % en la medición), y al llegar de golpe a una zona nueva (teletransporte, salir de una cueva, cargar la partida) hay paradas de hasta un segundo. Quieto, el juego va fluido (el dibujo tarda 1 ms de mediana; 38 llamadas de dibujo y 31 000 triángulos en la plaza). La causa es todo lo que se hace en el hilo principal al estrenar un trozo: el ruido del clima casilla a casilla (`gen.js` y `biomes.js`, varias capas de ruido por casilla), las mallas de la naturaleza y la hierba (`nature3d.js`, `world3d.js`) y la textura del terreno (`terrain.js`).
- Pasar la generación de trozos (biomas, objetos, textura del terreno) a un **Web Worker**: el hilo principal solo recibe los datos y hace las mallas.
- Generar por delante en la dirección en la que se anda (un anillo más) y, al cargar, hacer los trozos de alrededor antes de quitar el fundido.
- Guardar en caché los trozos generados (ya se guardan los `merged`, pero el ruido se vuelve a calcular cada vez que se tira la caché).
- *Hecho cuando:* andando a paso normal por terreno nuevo, ningún fotograma pasa de 33 ms, y al teletransportarse la pausa es de menos de 250 ms.

**1.2 Luces y sombras (M).** Hay seis luces puntuales fijas en la escena más el sol y la hemisférica, 40 programas de shader compilados, y las sombras del sol son PCF suave a 2048 con una cámara de 48 × 48 casillas: las sombras acaban de golpe a esa distancia.
- Limitar las luces puntuales activas a las cuatro más cercanas y apagar el resto (la noche se ve igual: cada luz tiene su radio).
- Sombras en cascada (dos niveles: cerca nítidas, lejos borrosas) o, más barato, una cámara de sombra que se adapte al zoom.
- Reducir programas: compartir materiales entre modelos (los `DYN` de `models.js` crean uno por color).
- *Hecho cuando:* el dibujo de un fotograma en la plaza baja de 1 ms a la mitad en el portátil y las sombras no se cortan al alejar la cámara.

**1.3 Calidad automática (S).** El modo bajo (`?q=low`) solo se activa a mano. Detectar el equipo al arrancar (fotogramas de los dos primeros segundos) y bajar solo la resolución, las sombras y la hierba; dejar al jugador fijarlo en Ajustes, donde ya está la resolución.
- *Hecho cuando:* en un móvil de gama media el juego arranca a 30 fps estables sin tocar nada.

**1.4 Memoria y limpieza (S).** `world3d.js` libera geometrías al soltar trozos, pero las texturas generadas (`textures.js`, 322 líneas de lienzos) y los materiales clonados para el desvanecido de las casas (`fadeMats`) se acumulan. Añadir un contador de memoria al panel de depuración (ver 5.2) y liberar lo que no se use en 2 minutos.

**1.5 El mundo del servidor (S).** Mide cuánto tarda cada tick del Chrome invisible (`/tps` ya lo dice) con 3 jugadores y 200 animales, y recorta lo que no haga falta sin vista (ya no dibuja; comprobar que tampoco genera texturas ni mallas).

### 2. Estética y modelados

**2.1 Agua (M).** ✅ Hecho el 2026-11-04. El agua se define seguida desde el clima (`wetness` en `biomes.js`: la misma regla que decide los biomas de agua, sin tramado), así la orilla no sale a escalones: el suelo se hunde según esa profundidad (`gen.depthAt`, con un escalón de 27 cm en la orilla y hasta más de un metro mar adentro), la textura pinta la orilla (arena, barro o lodo, mojada al borde), una línea de espuma y el agua de clara a honda (`ground.js`), y cada bloque lleva su malla de agua con la profundidad en cada vértice (`terrain.js`): color más claro donde cubre poco, espuma que late hacia la orilla, ondas y brillos a la deriva, reflejo del cielo en los ángulos rasantes y un borde que se desvanece (la línea de la orilla la da la pintura del suelo, más fina que la malla). El plano de siempre queda solo donde aún no hay bloque. Pendiente: la malla de agua va a 1 m, y de muy cerca se le notan las facetas en la orilla; afinarla a medio metro si molesta.
- *Antes:* un plano azul con las casillas a la vista: en los ríos la orilla salía en escalera y no se movía.

**2.2 Bordes entre biomas (S).** Pradera, arena, nieve y roca se cortan en dentado casilla a casilla (se ve en el desierto). Mezclar el color por vértice en una franja de 2 casillas, con el ruido que ya hay (`PATCH`).

**2.3 Personajes (M).** Los chibis funcionan bien y la ropa se ve con mimo. Lo que falta:
- Manos (los brazos acaban en cápsula) y que la herramienta se vea en la mano al golpear: el gesto existe (`swing`) pero el objeto no se dibuja.
- Parpadeo y dos o tres expresiones (contento al recibir regalo, dolor al recibir daño, dormido) usando `face.js`.
- Animaciones de sentarse, tumbarse y montar con transición, no de golpe.
- Que los vecinos giren la cabeza hacia ti al hablar ya existe; añadir que gesticulen con los brazos al hablar.
- *Hecho cuando:* al talar se ve el hacha, al pescar la caña, y la cara cambia al menos en tres situaciones.

**2.4 Árboles y plantas (S).** Las copas son icosaedros planos y van bien de lejos, pero de cerca el roble y el frutal son iguales salvo las manzanas, y las frondas de la palmera son placas rectas. Dar a cada especie dos variantes de copa, hojas de palmera curvadas y un poco de movimiento al viento en las copas (ya lo tienen las frondas con `sway`).

**2.5 Muebles antiguos (S).** Los muebles de las últimas fases (encimera, armario, cómoda, sillón) tienen más detalle que los primeros (silla, mesa, estantería, cofre, cama). Rehacer esos cinco con el mismo nivel: molduras, tiradores, patas torneadas, y una cama con el edredón arrugado.

**2.6 Noche y luz (S).** De noche se ve, pero en los sitios sin luz el suelo es un marrón plano. Luz de luna más azul con sombra suave, estrellas y la Vía Láctea en el cielo, y que las ventanas de las casas de los vecinos se enciendan y apaguen según su horario (ahora se encienden todas).

**2.7 Clima (S).** La lluvia son rayas; la nieve, puntos. Añadir charcos que reflejen en la lluvia (un plano con el material del agua donde hay camino), gotas en la cámara con tormenta, y nieve que cuaje sobre tejados y copas en invierno (ya hay `snow` en los árboles: extenderlo a los tejados).

**2.8 Coherencia de iconos (decisión).** ✅ Decidido y hecho el 2026-11-04: mixto. Lo que se coloca (muebles, estaciones, cosas del rancho) y las herramientas y armas se dibujan desde su modelo 3D (`src/three/icons.js`: de tres cuartos, 36 píxeles con contorno, una vez y en caché; 73 objetos), y lo que se tira al suelo de eso es el modelo en miniatura. Los materiales, la comida, las semillas, los peces, los bichos, la ropa, las alfombras, los cuadros, la caña y la red siguen a píxel (se leen mejor pequeños). Un objeto nuevo con modelo ya no necesita icono. Prueba: «iconos».

### 3. Interfaz

**3.1 Mapa grande (M).** Solo enseña lo explorado, en un rombo isométrico, sin nombres ni leyenda. Ponerle: norte arriba (como los mapas objeto), nombres de los sitios descubiertos (faro, templo, aldeas), la casa y los vecinos, el ratón para arrastrar y la rueda para ampliar, y una leyenda de colores.

**3.2 Barra de estado (S).** ✅ Hecho el 2026-11-04 con 4.1: al quitar la energía quedan vida, hambre y dinero en una fila, con los números al pasar el ratón; el hambre parpadea cuando queda poca.

**3.3 Pantallas (S).** Inventario, cofre, fabricar y diario comparten estilo, pero cada una tiene su cierre en un sitio y sus atajos. Unificar: Escape cierra siempre, la misma tecla que abre cierra, la X arriba a la derecha en todas, y el nombre del objeto bajo el ratón en una etiqueta flotante en todas (ahora solo en algunas).

**3.4 Texto (S).** En pantallas pequeñas la letra de píxeles de los paneles se queda en 10 px (la descripción del inventario, las recetas). Subir el mínimo a 12 px y comprobar el ajuste «texto grande» en todas las pantallas.

**3.5 Avisos (S).** Los textos flotantes del jugador (`float`) se solapan con el `toast` de arriba y con el de «Has encontrado…». Una sola cola de avisos con prioridad y que no se pisen.

**3.6 Móvil (M).** Hay botones táctiles y palanca, pero la cámara no se gira con dos dedos, colocar muebles con el dedo apunta donde no se ve, y las pantallas de fabricar y cofre no caben en apaisado en un móvil pequeño. Revisarlo pantalla a pantalla con un móvil de verdad.

### 4. Mecánicas

**4.1 Energía, vida y hambre (decisión, M).** ✅ Decidido y hecho el 2026-11-04: fundidas en el hambre. Cada uso de herramienta cansa lo que dice `TOOL_COST` (hacha, pico y azada, 1: un octavo de muslo; guadaña, mano, regadera, caña y red, 0,5; con tala o minería al 5, la mitad), comer quita hambre (y cura si duele), dormir deja 7 muslos como poco, y siempre se puede trabajar: con el hambre a cero baja la vida, según la dificultad. La partida ya no guarda `energy` (se ignora al cargar). Prueba: «hambre: trabajar la gasta, comer la quita y dormir la recupera».

**4.2 El pueblo de noche (S).** En la prueba, un esqueleto apareció en la plaza, junto a la farola, y mató al personaje. Dentro de `BOUNDS` del pueblo no deberían aparecer criaturas (es el sitio seguro desde donde se sale a explorar), o al menos no en las casillas con camino ni a menos de 8 casillas de una casa.

**4.3 Primera hora de juego (M).** La charla de Nilo lo explica todo de golpe (seis frases). Repartirlo: un encargo detrás de otro en el tablón o en el diario («siega tres matorrales», «hazte la mochila», «ven al taller»), cada uno con su recompensa, hasta tener banco, cama y huerto. Lo que ya existe (encargos, logros, diario) sirve de base.

**4.4 Economía (S).** Los precios salen de las recetas (`economy.js`), así que los objetos nuevos se venden sin mirarlos: la harina a 30 vale más que tres trigos, la cómoda sale cara por las tablas. Pasar por todos los precios una vez y poner a mano los que se desvíen; que las tiendas de los vecinos cambien el surtido por estación.

**4.5 Recolectar (S).** Los golpes que necesita cada cosa y lo que cae no se han tocado desde la fase 2: con un hacha de oro un roble cae de un golpe y da lo mismo que con la de madera. Que la herramienta mejor dé un poco más (ya lo hace fortuna) y que el peñasco necesite de verdad el pico de piedra en todos los niveles.

**4.6 Criaturas y combate (S).** El combate es pulsar hacia la criatura. Añadir retroceso al golpear y al recibir, un pequeño parpadeo del golpeado, y que el esqueleto dispare desde lejos (ahora todas muerden de cerca).

**4.7 Guardado y partida (S).** Al morir en la prueba se perdió el inventario y la barra se quedó vacía sin aviso de dónde cayó. Marcar en el minimapa y en el mapa grande el sitio de la muerte durante los 5 minutos que duran los objetos.

**4.8 Multijugador (M).** Varias versiones se han publicado «sin probar el multijugador». No es una mecánica nueva: es asegurar las que hay. Ver 5.1.

### 5. Código, pruebas y herramientas

**5.1 Pruebas automáticas (M, lo segundo).** ✅ Hecho el 3-11-2026 (`probar.py` y `src/pruebas.js`: 19 pruebas de un jugador y 7 de dos por el relay; unos cinco minutos; las de dos fallan si el ordenador va cargado: cerrar el navegador y repetir con `--dos`). El fallo de la brújula (un método `target` que tapaba el de las herramientas) estuvo publicado dos versiones sin que nadie lo viera. Hace falta un guion que arranque el juego en un Chrome invisible (como hace ya `multijugador.py` para el mundo del servidor), cargue una partida de prueba y compruebe lo básico: talar, picar, fabricar, colocar, dormir, un comando de cada clase, y dos juegos conectados a un relay de prueba (puerto 8795) que comparten un cofre. Correrlo antes de cada publicación.

**5.2 Panel de depuración (S).** ✅ Hecho el 4-11-2026 (F3, `src/ui/debug.js`). Una tecla (F3, como en Minecraft) que enseñe fotogramas por segundo, tiempo de simulación y de dibujo, llamadas de dibujo, trozos cargados, memoria y la casilla y el bioma. Sin esto cada medida de rendimiento hay que improvisarla.

**5.3 Ganchos de los sistemas (S).** Los sistemas se enchufan por nombre de método (`target`, `interact`, `entities`, `onDay`…) y cualquier método con ese nombre se convierte en gancho sin querer (así se rompieron las herramientas). Declararlos en una lista en `game.js` y avisar en consola si un sistema define un gancho que no está en ella.

**5.4 Repartir los archivos grandes (S).** `game.js` (950 líneas) junta el bucle, la interacción, la casa y los comandos de op; `scenes.js` (740) junta el mundo con el colocado libre. Separar la casa (`house.js`) y lo de colocar libre (`place.js`). Sin cambiar comportamiento.

**5.5 Versiones y cambios (S).** Un `CHANGELOG.md` con lo que entra en cada versión (lo que ahora va solo en los mensajes de commit) y que el menú enseñe «Novedades» la primera vez que se abre una versión nueva.

---

## Parte 2 · Añadir cosas nuevas

Ordenadas por lo que aportan. Cada una se deja hecha para poder mejorarla después, no cerrada.

### A. Lo que ya estaba pendiente

**A.1 Mapas colgados en la pared (S).** Un mapa (objeto) se cuelga de un muro como los cuadros y se ve dibujado; varios juntos forman uno grande. Queda del plan del planeta.

**A.2 Excavar y construir en altura (L).** Lo más grande que queda del plan «Minecraft». Por pasos: (1) el terreno con altura (colinas y montañas de verdad, el río en su cauce), que cambia la generación y el dibujo del terreno; (2) excavar con el pico un nivel hacia abajo y subir con tierra; (3) construir una segunda planta: muros sobre muros, escaleras y suelo encima; (4) que la cámara y el ocultado de tejados entiendan las plantas. Cada paso es jugable por sí solo.

### B. El planeta y los viajes

**B.1 Más biomas (M).** Selva (lluvia, árboles altos, lianas), sabana (acacias, hierba alta), volcán en las montañas rocosas, archipiélagos. Cada uno con dos o tres plantas y animales propios y algo que solo se consigue allí (cacao, caucho, obsidiana).

**B.2 Sitios con historia (M).** Las aldeas lejanas tienen vecinos de paso; darles un nombre, un oficio raro (cartógrafo, buhonero) y un trato único. Ruinas con una pequeña historia en páginas (como las del farero) que lleve de un sitio a otro.

**B.3 Un segundo planeta (L).** El objetivo que se dijo al diseñar el planeta. Un descriptor por planeta (tamaño, clima base, semilla, nombre), un archivo de mundo por planeta, y un modo de viajar: un cohete que se construye por fases (proyecto del pueblo, materiales de todos los biomas) o un portal en un templo. El segundo planeta puede ser pequeño y distinto (frío, con dos lunas) para que se note. Las cuentas y el servidor tienen que saber en qué planeta está cada uno.

**B.4 Puentes y pasarelas (S).** Piezas de construcción que se ponen sobre el agua poco profunda y los ríos: puente de tablas, pasarela de piedra. Ahora un río corta el camino salvo con barca.

### C. Pueblo y vecinos

**C.1 Fiestas por estación (M).** Cuatro días marcados en el calendario: la siembra (primavera), la verbena (verano), la cosecha (otoño) y la Nochebuena del pueblo (invierno). Ese día la plaza se decora sola, los vecinos salen, hay un concurso (el nabo más grande, el pez más largo, un baile) y un regalo.

**C.2 Tu propio puesto (M).** Un puesto en el mercado (el proyecto ya construye dos) donde dejar cosas a la venta; los vecinos y los demás jugadores las compran a lo largo del día según sus gustos.

**C.3 Correo (S).** El buzón de tu casa recibe cartas de los vecinos (regalos, encargos, chismes) y de otros jugadores; con el palomar ya se envían cosas: unirlo.

**C.4 Vecinos nuevos (M).** Dos más con oficio (una curandera para pociones y una maestra para la escuela de los niños), cada uno con casa, horario y tratos. La familia ya tiene niños: que vayan a la escuela.

### D. Casa y decoración

**D.1 Paredes y suelos pintados (S).** Pintar muros por dentro (pintura: bayas, carbón, cobre) y papel pintado tejido en el telar; suelos de baldosas de colores.

**D.2 Más muebles (S, por tandas).** Lámpara de pared, cortinas en las ventanas, espejo de pie, banco de jardín, barbacoa, columpio para los niños, acuario (con los peces del museo), reloj de pared. Cada tanda de cinco con sus recetas e iconos.

**D.3 Cuadros propios (S).** Un cuadro hecho con un trozo del mapa descubierto o con la cara de un vecino (hay retratos en 3D ya).

**D.4 Jardín (M).** Flores que se plantan en macetas y parterres (la red de insectos ya las usa), setos que se podan y un invernadero (cultivos de cualquier estación, construido con vidrio del horno).

### E. Oficios y recetas

**E.1 Alfarería (M).** Arcilla en las orillas de los ríos, un torno (estación) y un horno de alfarero: tarros (la mermelada ya «viene en tarro»), platos, macetas y tejas para un tejado nuevo.

**E.2 Cocina ampliada (S).** Diez platos más con lo que ya hay (coco, harina, mantequilla, nata, trufa): bizcocho, croquetas, tortitas, pan de coco…, y un recetario en el diario con los platos probados.

**E.3 Herrería ampliada (S).** Con el yunque: cencerros (los animales se encuentran en el mapa), farolillos de mano (luz que se lleva), ganchos para colgar herramientas en la pared.

### F. Aventura

**F.1 Jefes de cueva (M).** Cada diez niveles de cueva, una sala con un jefe (araña grande, golem de piedra) y un cofre especial. Con el combate mejorado (4.6).

**F.2 Mazmorra del templo (M).** Los templos tienen puzles; unirlos en una mazmorra de tres salas con un tesoro que sirva para algo (un plano del cohete de B.3).

**F.3 Expediciones (S).** Encargos del tablón que mandan lejos: «trae nieve de la tundra», «un coco de las antípodas». Dan experiencia, dinero y páginas de historia.

### G. Herramientas para jugar juntos

**G.1 Modo foto (S).** Una tecla que oculta la interfaz, deja mover la cámara libre y guarda la imagen. Pide el control de la interfaz de 3.3.

**G.2 Comandos que faltan (S, por tandas).** De la lista de Minecraft que encaja: `/damage`, `/clone`, `/structure save|load`, `/place`, `/spreadplayers`, `/random`, `/schedule`, `/tellraw`, `/bossbar`, `/waypoint`, `/ride`, `/hud`; en el servidor, `/ban-ip`, `/pardon-ip`, `/reload` y `/tick`. Sin `/scoreboard`, `/team` ni `/execute` de momento (son sistemas enteros).

**G.3 Equipos y marcadores (M).** Cuando haya varios jugadores a la vez: equipos con color, un marcador (puntos, cosechas, pesca) y los comandos `/scoreboard` y `/team`.

### H. Sonido, idiomas y acceso

**H.1 Sonido ambiente (S).** Pájaros de día, grillos de noche, el río al pasar, el viento en la nieve, cada uno en su bioma (el sintetizador de `audio.js` ya hace ruidos; es ponerlos). La música generada, con un tema por bioma además de por estación.

**H.2 Inglés (M).** Los textos están en el código. Sacarlos a un diccionario (`i18n`) y traducir la interfaz; los nombres de los objetos y los diálogos, después. Los comandos ya están en inglés.

**H.3 Acceso (S).** Modo daltónico para los indicadores (los corazones y el hambre se distinguen por forma, no solo por color), subtítulos de sonidos, y que todo se pueda hacer con teclado.

---

## Orden propuesto

1. Parte 1: **1.1** (tirones), **5.1** (pruebas) y **5.2** (panel), porque todo lo demás se mide y se comprueba con ellos.
2. Parte 1: **4.1** y **2.8**, que son decisiones; luego **2.1**, **2.2**, **4.2**, **3.1** y el resto de la parte 1 en tandas pequeñas publicadas cada pocas sesiones.
3. Parte 2: **A.1**, **A.2** por pasos, y después **B.3** (el segundo planeta), con lo de C, D y E intercalado en tandas cortas para que cada versión traiga algo que se vea.

Lo descartado antes sigue descartado: redstone, raíles, tolvas, otra dimensión, borde del mundo y la brújula del confín.
