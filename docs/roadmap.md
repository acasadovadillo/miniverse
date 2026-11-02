# Pueblo Brotes: roadmap del sandbox infinito

> Objetivo: un mundo isométrico en pixel art **sin límites**, generado a partir de una semilla, donde se pueda:
> recolectar, fabricar, construir, decorar, cultivar, criar animales, explorar y vivir aventuras.
> Todo debe ir fluido (60 FPS) en ordenador y móvil.

## Cómo leer este roadmap

- Cada **fase** termina con algo **jugable** que se puede probar.
- Las fases 0 a 4 forman el **núcleo del sandbox**: mundo infinito, recolectar, fabricar y construir. Con eso ya es un sandbox de verdad. Lo demás son capas encima.
- Tamaño aproximado: **S** (1–2 sesiones), **M** (3–5), **L** (6 o más).

---

## Fase 0 · Cimientos técnicos (M) ✅ completada

> Decisiones tomadas: mundo **plano con capas**, **combate ligero**, **arte mixto**, **servidor local**, **cuentas online al final**.
> Resultado: código en módulos (`src/`), mundo por trozos que ya es infinito (de momento solo pradera y bosque), guardado en IndexedDB con migración, bucle de paso fijo y entidades. El lanzador `jugar.command` sirve para Mac.

Ahora el pueblo es un único dibujo fijo. Un mundo infinito necesita otra base, así que primero toca reorganizar.

- Separar el código en módulos: mundo, render, entidades, inventario, guardado, interfaz.
- **Mundo por trozos (chunks)** de 16×16 casillas. Cada trozo se genera, se dibuja una vez en caché y se descarta al alejarse.
- **Guardado en IndexedDB** en lugar de localStorage, porque localStorage se queda corto (unos 5 MB). Solo se guardan los cambios que hace el jugador, no el mundo entero.
- Bucle de juego con paso de tiempo fijo, para que la simulación sea igual en cualquier equipo.
- Sistema de entidades sencillo: jugador, vecinos, animales y objetos caídos.

**Hecho cuando:** el pueblo actual funciona igual que hoy, pero construido sobre chunks y con guardado en IndexedDB.

## Fase 1 · Mundo infinito (L) ✅ completada

> Resultado:
> - **Biomas**: pradera, bosque, bosque de pinos, pantano, desierto, playa, mar, montaña rocosa y tundra nevada.
> - **Agua**: ríos y lagos (helados en la nieve) y charcas. El agua profunda bloquea el paso; la poco profunda se cruza vadeando, más despacio.
> - **Arte nuevo** para cada bioma: pinos nevados, palmeras, cactus, matojos secos, sauces y peñascos.
> - **Orientación**: minimapa y mapa grande (M) con lo explorado, coordenadas con el pueblo en (0, 0) y aviso al cambiar de bioma.
> - Lo explorado se guarda con la partida.
> - Alrededor del pueblo el clima es siempre templado.

- **Generación procedural con semilla**: el mismo mundo para la misma semilla. Hay una sola semilla: todas las partidas comparten el mismo mundo.
- **Biomas**: pradera, bosque, bosque de pinos, lagos y ríos, playa con mar, zona rocosa, pantano, desierto y nieve.
- El **pueblo inicial** siempre en el centro (0, 0), hecho a mano.
- Carga de trozos alrededor del jugador mientras camina, sin tirones.
- **Minimapa** y coordenadas. Mapa grande con las zonas descubiertas.

**Hecho cuando:** puedes caminar en cualquier dirección sin llegar nunca al borde, a 60 FPS, y al volver todo sigue igual.

## Fase 2 · Recolectar e inventario (M) ✅ completada

> Resultado:
> - **Herramientas**: hacha (árboles y cactus), pico (rocas y peñascos, con carbón, cobre y hierro), guadaña (arbustos y matojos) y azada (labrar la hierba). Los arbustos también se arrancan a mano.
> - Lo recogido **salta al suelo** y vuela hacia ti al acercarte, con astillas, textos de "+3 Madera" y sonidos.
> - **Mochila** de 36 casillas con barra rápida de 9 (teclas 1–9 o rueda del ratón). Se puede arrastrar, apilar, ver la descripción, comer y tirar.
> - **Energía**: cada golpe gasta un poco. Se recupera comiendo (manzanas, bayas, cocos, pulpa de cactus) o durmiendo en la cama.
> - **El mundo recuerda**: lo talado, picado y segado desaparece para siempre (desde el 31-10-2026: antes volvía a crecer y dejaba tocón), la tierra labrada se queda. Solo crece lo que plantas tú. Solo se guardan los trozos que cambian.
> - La regadera y la caña de pescar pasan a la fase 6, donde tienen sentido (regar cultivos y pescar).

- **Herramientas**: hacha, pico, azada, regadera, caña de pescar y guadaña.
- Talar árboles, picar rocas y minerales, arrancar hierbas y coger flores. Lo recogido **cae al suelo** y se recoge.
- **Inventario** con barra rápida (1–9 o rueda del ratón), arrastrar, apilar y tirar objetos.
- **Mundo modificable y guardado**: si talas un árbol, sigue talado para siempre; solo crece lo que plantas tú.
- Indicadores: energía, que se gasta al trabajar y se recupera durmiendo o comiendo.

**Hecho cuando:** puedes salir con el hacha, talar un bosque, volver con 50 de madera, y el bosque recuerda lo talado.

## Fase 3 · Fabricar (M) ✅ completada

> Resultado:
> - **Pantalla de fabricar** (C, o desde la mochila) con una pestaña por sitio: a mano, banco de carpintero, horno, yunque, telar y cocina. Muestra los ingredientes que tienes y los que faltan.
> - **Estaciones que se colocan en el mundo**, con vista previa de dónde van. Se usan con E y se pueden volver a guardar en la mochila. También hay silla, mesa y alfombra (lo primero de la fase 4).
> - **Cadena completa**: madera → tablas → banco → pico de piedra → peñascos con cobre → horno → lingotes → yunque → herramientas de cobre → hierro → herramientas de hierro → oro → herramientas de oro. El carbón sale de las rocas o quemando madera.
> - **Herramientas por niveles** (madera, piedra, cobre, hierro y oro): cada nivel necesita menos golpes, trabaja más deprisa y saca minerales mejores. Los peñascos piden al menos un pico de piedra.
> - **Recetas que se desbloquean** al conseguir sus ingredientes por primera vez. Nilo te enseña el banco de carpintero y luego da consejos. Las bloqueadas salen como "???" con una pista.
> - **Cocina**: platos que dan hasta 50 de energía (manzana asada, mermelada, coco tostado, piñones, pan de bellota y estofado de cactus).
> - El telar ya hace tela y alfombras; la ropa queda para más adelante.

- **Recetas**: madera → tablas → muebles; piedra → horno; mineral → lingotes.
- **Estaciones de trabajo**: banco de carpintero, horno, yunque, telar y cocina.
- Recetas que se **desbloquean** al descubrir materiales o al hablar con vecinos.
- Mejoras de herramientas: de madera a piedra, cobre, hierro y oro. Una herramienta mejor trabaja más rápido.

**Hecho cuando:** existe una cadena completa de recolectar, procesar, fabricar y mejorar.

## Fase 4 · Construir y decorar (L) ✅ completada

> Resultado:
> - **Modo construcción** (B) con paleta, vista previa y cursor con el ratón o el dedo: clic pone (arrastrando se pinta), clic derecho quita y devuelve los materiales.
> - Piezas: suelos (madera, piedra, grava), muros (madera, piedra, con ventana, con cuadro), puertas que se orientan solas, tres tejados y vallas que se unen solas. Cada casilla tiene tres capas: suelo, objeto y tejado.
> - **Casas propias en cualquier parte**: al entrar bajo tu tejado, el tejado se oculta y los muros de delante se ven a medias (no hay pantalla de carga).
> - Muebles: cama (sirve para dormir), estantería, maceta, lámpara, antorcha, cofre (18 huecos), mesa, silla y alfombra. Se giran con R. También se pueden poner dentro de la casa del pueblo, que Nilo amplía a cambio de materiales.

- **Modo construcción** con vista previa fantasma sobre la rejilla: suelos, caminos, muros, puertas, ventanas, tejados y vallas.
- **Casas propias en cualquier parte**, con interior generado al poner la puerta.
- **Decoración**: muebles, alfombras, cuadros, plantas, lámparas (que dan luz de noche) y rotación de objetos.
- Quitar lo construido y recuperar parte del material.
- Ampliar y reformar la casa del pueblo.

> Cambio posterior (31-10-2026), **todo en cuadrícula**: cada cosa del mapa ocupa casillas enteras (árboles, rocas, arbustos, farola, buzón, cartel, tablón, vitrina, puestos y lugares del mundo); solo las personas, los animales y las partículas van libres. Las casas del pueblo y de las aldeas están hechas de piezas de construcción (muro de entramado, ventana con contraventanas, puerta, tejado a cuatro aguas con pendiente real, hogar con chimenea), y tu casa es parte del mundo: se entra andando, el tejado se oculta y se puede cambiar o amueblar pieza a pieza. La habitación aparte desapareció; lo que había dentro pasa a la casa al cargar la partida.

> Cambio posterior (01-11-2026), **los muñecos no giran con la cámara**: tu personaje, los vecinos y los animales siguen mirando hacia el mismo sitio del mundo al girar la cámara, así que se les ve de lado o de espaldas según el ángulo (cada uno guarda su dirección en el mundo, `dir`).

> Cambio posterior (01-11-2026), **giro con las flechas**: la cámara gira con la flecha izquierda y la derecha (antes Shift+Q y Shift+E); en el juego esas flechas ya no mueven al muñeco (se camina con WASD, o con las flechas arriba y abajo), y con el mapa abierto lo siguen moviendo.

> Cambio posterior (01-11-2026), **16 ángulos de cámara**: la cámara gira de 22,5° en 22,5° (`STEPS` en `src/iso.js`). Las figuras en 3D (cajas, caras y líneas) se giran a cualquier ángulo y pintan los lados que miran a la cámara; dentro de un objeto se ordenan con su caja en su propio marco y hacia dónde queda la cámara. Muros, ventanas, puertas, vallas, suelos, tejados y la tierra labrada se dibujan girados (con detalles por las dos caras, porque desde ángulos intermedios se ve la otra). El suelo de cada trozo se pinta desde el cuarto de vuelta más cercano y, entre dos, se dibuja deformado (el suelo es un plano): no se repinta. Las sombras y los detalles del suelo se guardan en el mundo y se proyectan al pintarlo. El orden de dibujo y las paredes que se ocultan dentro de casa dependen de hacia dónde se acerca uno a la cámara; con la cámara en diagonal, las paredes de canto cuentan como de atrás. En ángulos intermedios suelos, muros y tejados se ensanchan un poco para que no queden rayas entre casillas. Los árboles, las rocas, los lugares y los muñecos se ven igual (los muñecos, en su vista más cercana).

> Cambio posterior (01-11-2026), **cámara giratoria**: Shift+Q y Shift+E giran la cámara un cuarto de vuelta (cuatro vistas, con un fundido). El mundo se gira antes de proyectarlo (`VIEW.r` en `src/iso.js`): el suelo de cada trozo se pinta según la vista (y se guarda por vista, así que volver a una ya vista es al momento; la primera vez se pinta poco a poco mientras se ve la imagen anterior), los muros, puertas, vallas y tejados giran sus vecinos y esquinas, y los muebles y el hogar se dibujan desde cualquiera de sus cuatro lados (las piezas en 3D se giran, se ordenan de atrás adelante y las caras de espaldas no se pintan; por detrás quedan lisos). Dentro de casa se ocultan las paredes que quedan entre la cámara y la sala, así que girando se ven las cuatro. Las teclas, el ratón, los muñecos, los animales, el minimapa y el mapa siguen a la cámara. En cuevas y templos la vista es fija. Se guarda en la partida. Además, lo que se coloca (muebles y estaciones) va a la casilla del ratón si está a 4 casillas como mucho.

> Cambio posterior (01-11-2026), **puerta, ventanas y candelabro por dentro**: desde dentro de casa la puerta de la pared de delante se ve entera (marco, dintel, hoja abierta o cerrada y el escalón), sin el muro de encima. Las ventanas ya no alumbran por dentro. Cada casa tiene un candelabro de latón con ocho velas colgado en el centro del techo (se ve al entrar) que alumbra la sala de noche. La lámpara de pie del plano va junto a las estanterías.

> Cambio posterior (01-11-2026), **chat y modo admin**: la T (o /) abre un chat como el de Minecraft; Intro envía y Esc cierra, y los mensajes se apagan solos. Comandos: `/ayuda` y `/admin`, que activa o quita el modo admin (se guarda en la partida y sale la marca ADMIN): lo que se usa no se gasta, la mochila tiene una sección con todos los objetos para cogerlos, fabricar no pide materiales y construir es gratis, también sobre el terreno del pueblo. Tirar cosas o guardarlas en un cofre sí las quita.

> Cambio posterior (01-11-2026), **cama nueva**: armazón de madera con patas (hueco debajo), postes con remate de bola, cabecero alto y arqueado con cuarterón, piecero bajo, colchón, almohada mullida y manta acolchada azul con costuras, el bajo ondulado y el embozo de la sábana. La lámpara también se arrima a la pared, junto al cabecero.

> Cambio posterior (01-11-2026), **puertas que se abren y se cierran**: con E junto a una puerta (la tuya, las de los vecinos y las de las aldeas). Cerrada, la hoja tapa el hueco y no se puede pasar; no se cierra si estás en el hueco. Se guarda en el trozo del mapa. Delante de una puerta, en la casilla del muro, ya no cuentas como dentro de casa (solo el lado de dentro de la pared).

> Cambio posterior (01-11-2026), **interior de las casas**: por dentro las paredes son de yeso blanco liso (sin entramado ni contorno entre casillas) y las ventanas, sencillas. La cama, las estanterías y el hogar se arriman al muro que tengan detrás. El hogar es más grande (casi una casilla de ancho, con repisa y el tiro de piedra hasta el techo) y el fuego cabe en su boca. Las ventanas de las paredes de delante, que no se dibujan, ya no dejan su brillo en medio de la sala. La puerta de la pared de delante se ve desde dentro como un umbral (escalón de piedra y el arranque del marco) con un trozo de lo de fuera. Al cargar una partida, la cama y el hogar que se quedaron en medio de la sala al agrandar la casa pasan a la pared del fondo.

> Cambio posterior (31-10-2026), **casas el doble de grandes**: tu casa mide 12×10 casillas (16×12 ampliada) y las de los vecinos y las aldeas, 12×10, con ventanas cada tres casillas, un cuadro y más muebles. El jardín y las casas de los vecinos se han recolocado, y las rutas de los vecinos llegan a sus nuevas puertas. Una partida de antes agranda tu casa al cargar (la puerta se queda en su sitio; las paredes viejas de dentro devuelven su material). Las aldeas ocupan también los trozos de alrededor y solo ponen casas en tierra firme (dos o tres). La cama ocupa dos casillas (cabecero, almohada, manta con embozo y piecero) y se puede dormir desde cualquier lado.

> Cambio posterior (31-10-2026), **interiores**: dentro de una casa solo se ve la casa. Fuera de su suelo todo es negro (también de noche), y no se ven el tejado ni las paredes de delante (sur y este); en las esquinas queda solo la pared de atrás. Solo alumbran las luces de dentro. En cuevas y templos, las paredes que tapan al jugador ya no se ven translúcidas: no se dibujan.

> Cambio posterior (31-10-2026), **personajes en 8 ángulos**: de frente, de espaldas, perfil derecho e izquierdo y las cuatro diagonales. El jugador, los vecinos y el creador de personaje usan las ocho; las vistas de la izquierda son el espejo de las de la derecha.

**Hecho cuando:** puedes levantar una cabaña en mitad del bosque, amueblarla y que se guarde.

> ✅ **Al terminar la fase 4 ya tienes un sandbox jugable de verdad.** Buen momento para publicarlo en GitHub Pages y que lo prueben otras personas.

---

## Fase 5 · Tiempo y clima (M) ✅ completada

> Resultado: día de 20 minutos con reloj, noche con luces (farolas, ventanas, lámparas, antorchas, hornos) y luciérnagas (quitadas después, el 01-11-2026); cuatro estaciones de 7 días que cambian el suelo y las plantas (otoño naranja, invierno nevado); lluvia, tormenta con rayos, niebla y nieve. Dormir pasa a la mañana siguiente y guarda; quien trasnochaba hasta las 2 se desmayaba y Nilo lo llevaba a casa (quitado el 01-11-2026: se puede pasar la noche fuera).

- **Ciclo de día y noche** con iluminación: farolas, ventanas encendidas, antorchas y luciérnagas.
- Calendario con **4 estaciones**, que cambian la paleta del mundo (hojas en otoño, nieve en invierno) y lo que crece.
- **Clima**: lluvia (que riega sola), tormentas, niebla y nieve.
- Dormir para pasar al día siguiente, que es cuando se guarda.

## Fase 6 · Cultivar y criar (L) ✅ completada

> Resultado: siete cultivos por estación (nabo, fresa, zanahoria, tomate, maíz, trigo y calabaza), regadera, aspersores, abono; la lluvia riega. Árboles que se plantan con bellotas, piñas o semillas de manzano, y manzanos que dan fruta. Gallinas, vacas y ovejas con gallinero y establo, comederos y colmenas; huevos, leche, lana y miel. Platos nuevos (algunos dan velocidad o quitan el cansancio) y pesca con doce peces según el agua, la estación y la hora.

- **Huerto**: labrar, sembrar, regar y cosechar. Cultivos por estación, abono y aspersores.
- **Árboles frutales** y plantar árboles nuevos (reforestar).
- **Animales**: gallinas, vacas, ovejas y abejas. Graneros y corrales, darles de comer y cuidarlos. Producen huevos, leche, lana y miel.
- **Cocina**: recetas con lo cultivado, que dan energía y efectos.
- **Pesca** en ríos, lagos y mar, con peces por bioma, estación y hora.

## Fase 7 · Pueblo vivo y economía (L) ✅ completada

> Resultado: Rosa (tendera), Lía (pescadora), Bruno (herrero), Nilo y Dani (llega con el proyecto de casa nueva), con casas, horarios, charlas según la hora y el tiempo, regalos que les encantan o no, amistad con eventos y regalos a 3 y 6 corazones. Monedas, tiendas (comprar y vender), tablón con tres encargos al día y cuatro proyectos del pueblo: fuente, muelle, mercado y casa nueva.

- **Vecinos** con nombre, personalidad, horario diario (trabajan, pasean, duermen) y diálogos con el humor del juego.
- **Amistad**: regalos, conversaciones y eventos especiales.
- **Tablón de encargos** del pueblo, con misiones que dan recompensas.
- **Tiendas** y economía: vender lo producido y comprar semillas, recetas y muebles.
- El pueblo **crece** con tu ayuda: puente, mercado y nuevos vecinos que se mudan.

## Fase 8 · Explorar y aventuras (L) ✅ completada

> Resultado: el mundo genera entradas de cueva, ruinas, campamentos, torres, barcos hundidos, templos y aldeas con mercader. Las cuevas tienen niveles infinitos hacia abajo (vetas de cobre a diamante, fósiles, cristales, cofres y criaturas). Los templos son mazmorras de cuatro salas con puzles (palanca, llave, bloque sobre placa) y un tesoro. Combate ligero solo bajo tierra: corazones, limos, murciélagos y esqueletos, espadas y pociones. Barca para navegar y caballo para ir más deprisa. Los lugares descubiertos salen en el mapa.

- **Cuevas y minas** con niveles hacia abajo: minerales, gemas y fósiles.
- Puntos de interés generados por el mundo: **ruinas, campamentos, torres, barcos naufragados y templos**, con cofres y secretos.
- **Mazmorras procedurales** con puzles (palancas, llaves, bloques que empujar).
- **Criaturas**: amistosas, neutrales y, si se decide, enemigas (ver decisiones).
- Otras **aldeas** generadas lejos, con sus vecinos y comercio.
- Monturas o barca para viajar lejos.

## Fase 9 · Progresión y metas (M) ✅ completada

> Resultado: ocho habilidades que suben con el uso y dan ventajas; museo en la plaza con 33 piezas (minerales, fósiles y reliquias, peces e insectos, con red para cazarlos) y premios; 20 logros; diario (J) con historia, vecinos, habilidades, museo, logros y estadísticas. Historia ligera: el diario del farero en los cofres, una brújula en el tesoro de un templo y un faro muy lejos, con su final.

- **Habilidades** que suben con el uso: tala, minería, agricultura, pesca, cocina y construcción.
- **Colecciones**: museo del pueblo con minerales, fósiles, peces e insectos.
- Logros y una **historia ligera** de fondo: ¿qué hay en los confines del mundo?

## Fase 10 · Pulido y publicación (M) ✅ completada (falta solo publicar)

> Resultado: música generada que cambia con la hora, el clima, la casa, las cuevas y los templos; ajustes (volúmenes, tamaño de píxeles, texto grande, reducir destellos, ayuda); controles táctiles para todo (pausa, mochila, fabricar, construir); servidor local sin caché. El juego está listo para GitHub Pages (instrucciones en el README), pero no se ha publicado: eso queda para cuando tú lo digas.

- Música (por bioma y hora del día) y sonidos completos.
- Ajustes: volumen, controles, escala de píxeles y accesibilidad.
- Controles táctiles completos para móvil (inventario y construcción).
- Optimización final y publicación en **GitHub Pages**.

## Fase 11 · Online (opcional, L o mayor) ◐ hecho lo que no necesita servidor

> Resultado: exportar e importar la partida a un archivo (para llevarla a otro dispositivo) y visitar lo que ha hecho otra persona sin guardar nada. (Compartir la semilla con un enlace se quitó después: hay un solo mundo.) Las cuentas en la nube y el multijugador necesitan un servidor (por ejemplo, Supabase) y una cuenta tuya: quedan pendientes.

- **Cuentas online** y guardado en la nube (por ejemplo, Supabase), para jugar desde cualquier dispositivo.
- Visitar lo que ha hecho otra persona.
- **Multijugador cooperativo**. Es lo más costoso de todo: requiere servidor en tiempo real y rediseñar partes del motor.

---

## Decisiones que conviene tomar pronto

Cambian cómo se construyen las fases 0 y 1. Cuanto antes se decidan, menos se rehace.

1. **¿Altura en el mundo?**
   - *Plano con capas* (recomendado): el exterior es llano y las cuevas son capas aparte. Es más simple y más rápido.
   - *Con relieve*: colinas y acantilados de varios niveles. Es más bonito, pero se complica mucho la construcción, las colisiones y el orden de dibujo.
2. **¿Combate?** Sin combate (vida tranquila), combate ligero (solo en cuevas y mazmorras) o combate completo.
3. **¿Cómo se dibuja el arte a partir de ahora?** Hoy todo se dibuja con código. Para cientos de objetos, criaturas y biomas, ese método no escala bien.
   - *Seguir con código*: no hace falta dibujar, pero queda más limitado.
   - *Hojas de sprites* dibujadas, por ejemplo con Aseprite: más calidad y variedad, pero requiere hacer el arte.
   - *Mixto* (recomendado): el terreno y los objetos simples por código, y los personajes y objetos especiales en sprites.
4. **¿Doble clic o servidor?** Para usar módulos y un código ordenado, el juego necesitará abrirse desde un servidor local o GitHub Pages, no con doble clic. Recomendado: aceptar el servidor, porque al publicarlo en GitHub Pages da igual.
5. **¿Cuentas online desde el principio o al final?** Recomendado: al final (fase 11). Las cuentas locales sirven mientras tanto.

## Orden recomendado

```
0 Cimientos → 1 Mundo infinito → 2 Recolectar → 3 Fabricar → 4 Construir   ← sandbox jugable, publicar
→ 5 Tiempo → 6 Cultivar → 7 Pueblo vivo → 8 Explorar → 9 Progresión → 10 Pulido → (11 Online)
```

Las fases 5 a 9 se pueden reordenar según lo que más apetezca. Cada una es una capa independiente sobre el núcleo.

> Cambio posterior (01-11-2026), **el juego pasa a 3D**: el dibujo isométrico en 2D se sustituye por una escena de Three.js con cámara orbital libre (giro, inclinación y zoom suaves), sol y sombras según la hora, cielo, clima y estaciones; la lógica (casillas, trozos, construcción, sistemas, guardado) no cambia. Detalles y estado en [migracion-3d.md](migracion-3d.md).

> Cambio posterior (02-11-2026), **sin cuentas locales y creador más completo**: el juego empieza directamente en el menú (las partidas de las cuentas de antes se conservan: se usa la última). El creador tiene pestañas (cuerpo, cara y pelo), gira al personaje mientras se mantiene pulsado un botón o una flecha (o arrastrando) y acerca la cámara a la cara. Rasgos nuevos: cinco tipos de ojos con su color, cinco de cejas, de nariz y de orejas, cinco barbas, mofletes sí o no, y cinco peinados más (melena, dos coletas, trenza, cresta y tupé). El delantal tiene peto, falda, cintas y lazo, y la túnica larga llega a los tobillos sin que la atraviesen las piernas.

> Cambio posterior (02-11-2026), **cuentas creadas por el admin**: no se puede jugar sin cuenta. Alberto (admin, con `/admin`) crea cuentas con `/account create <usuario>`, que reescribe `accounts.json` con su token de admin y da un código de invitación. Con ese código, el jugador elige su contraseña la primera vez. Cada cuenta tiene su token de guardado y su partida va cifrada (`<usuario>-miniverse-data.enc`) en el repositorio privado Miniverse-data y en el navegador de cada ordenador. Ver *Cuentas* en el README.

> Cambio posterior (02-11-2026), **inventario realista y ropa**: sin mochila solo se llevan las 9 casillas de la barra (manos y bolsillos); la mochila desbloquea las otras 27. La ropa (camisa, túnicas, chaleco, delantal, pantalón, falda, botas, ropa interior, sombrero y gorro) se pone y se quita en los huecos del cuerpo y el muñeco se viste con ella. Las partidas de antes conservan su ropa y reciben una mochila para no perder nada.
