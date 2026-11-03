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

1. Pulsa **Crear tu personaje** (con personaje, el menú tiene **Continuar partida** y **Nueva partida**; la nueva avisa antes de borrar a tu personaje, y el mundo se queda como está): nombre, cuerpo y ropa, cara (ojos y su color, cejas, nariz, orejas, mofletes y seis bocas) y pelo (23 peinados, barba y un accesorio con su color). Mantén pulsados los botones de giro, las flechas ← → o arrastra sobre el personaje para girarlo; en la pestaña Cara la cámara se acerca.
2. Empiezas con hacha, pico, guadaña, azada, tres manzanas y 100 monedas. **Habla con Nilo** en la plaza: te enseña a hacer un banco de carpintero.
3. Tala, pica y siega fuera del pueblo, fabrica (C) y coloca estaciones. Cada material nuevo desbloquea recetas.
4. Tu casa es parte del mundo: entras andando por la puerta y el tejado se oculta. Está hecha de las mismas piezas que puedes construir tú (B) en cualquier parte, y puedes cambiarla o amueblarla a tu gusto. Siembra, compra animales a Rosa, pesca con Lía, haz encargos del tablón y paga los proyectos del pueblo.
5. Explora: cuevas con niveles infinitos, ruinas, campamentos, torres, barcos hundidos, templos con puzles y aldeas lejanas. Los cofres guardan las páginas del diario del farero…

La partida se guarda sola cada 15 segundos, al entrar o salir de una casa y al dormir.

### Controles

| Acción | Teclado y ratón | Móvil |
| --- | --- | --- |
| Caminar / correr | WASD (arriba es hacia donde mira la cámara) / dos toques seguidos de W (se corre mientras la mantienes) | Cruceta |
| Agacharse / levantarse (agachado se anda despacio) | Un toque de Shift; otro, de pie (o dos toques de W, a correr) | — |
| Usar lo que llevas (talar, picar, regar, sembrar, pescar, atacar, comer, colocar…) | Clic izquierdo (mantén para seguir) | Botón ⚒ |
| Pescar | Con la caña, mantén el clic para coger fuerza y suelta para lanzar; cuando pique, clic. En la pelea, mantén el clic (o Espacio) para subir la red | Botón ⚒, igual |
| Saltar | Espacio (con un diálogo abierto, seguir) | Botón ⤒ |
| Interactuar (hablar, puertas y ventanas, llamar, luces, cofres, estaciones, sentarse, la cama, cosechar, animales) con lo que apuntas con el ratón, si está a 2 casillas como mucho (sin apuntar a nada, con lo más cercano) | E o Enter | Botón E (lo más cercano) |
| Recoger un mueble que se usa con E (silla, cama, lámpara, mochila del suelo…) | X | — |
| Tirar al suelo lo que llevas en la mano (uno; con Ctrl o Shift, el montón) | Q | — |
| Sentarse o tumbarse en el suelo (otra vez, o moverse, para levantarse) | G / H (o `/sentarse`, `/tumbarse`) | — |
| Elegir objeto | 1–9 o rueda | Tocar la casilla |
| Girar lo que vas a colocar | R (los cuadros y el hogar, contra un muro, en cuatro giros) | — |
| Mochila / Fabricar / Construir | I / C / B | 🎒 / 🧰 / 🔨 |
| Quién está jugando (quién lleva el mundo, quién es op y en qué modo está) | Mantener Tab | — |
| En modo construcción | Clic pone (arrastra para pintar), clic derecho o X quita | Tocar pone; pestaña «Quitar» |
| Diario (historia, vecinos, habilidades, granja, pesca, museo, logros) | J | Desde el menú ☰ |
| Mapa (con él abierto: moverlo, acercarlo y volver a tu sitio) | M o clic en el minimapa (WASD, flechas o arrastrar; Shift, más rápido; + y − o rueda; ⌖) | Tocar el minimapa (arrastrar; botones + y −; ⌖) |
| Pausa (guardar, diario, controles, ajustes) | Esc | Botón ☰ |
| Chat y comandos (`/ayuda`; todos: `/list`, `/msg`, `/seed`, `/luz`; los op: `/gamemode`, `/tp`, `/give`, `/kill`, `/spawnpoint`, `/setworldspawn`, `/say`, `/weather`, `/gamerule`, `/difficulty`, `/time`) | T, o / para empezar con el comando | — |
| Girar la cámara (suave, mientras se mantiene) | Flecha izquierda / flecha derecha | — |
| Subir o bajar la cámara (de casi cenital a ras de suelo) | Flecha arriba / flecha abajo | — |
| Acercar o alejar la cámara | + / − (o Ctrl + rueda, o pellizcar el panel táctil) | — |
| Primera o tercera persona | Z (en primera persona, flecha arriba / abajo para mirar arriba y abajo) | — |
| Ver el rendimiento | F | — |
| Colocar muebles y estaciones (libres: donde apuntes, con cualquier giro) | Apunta con el ratón (hasta 4 casillas) y clic; R gira (mantenida, sin parar; a toques, de 15° en 15°, encajando de nuevo con las casillas para cuadrarlo con la pared; con Shift, al revés); V, el tamaño de la mesa grande (el de las alfombras se elige en el telar). Al arrimarlo a un muro se pega a él sin correrse hacia las juntas de las casillas | Delante del jugador |
| Sentar o levantar a tu perro o tu gato | Clic derecho sobre él (o X a su lado) | — |

## Lo que hay en el juego

- **Mundo infinito** con 12 biomas, ríos, lagos y mar; día y noche con la hora de Madrid (si juegas de noche, en el juego es de noche) y las cuatro estaciones del calendario (la primavera empieza el 20 de marzo, el verano el 21 de junio, el otoño el 22 de septiembre y el invierno el 21 de diciembre), que cambian los colores, y clima: lluvia, tormenta, niebla y nieve. Cada día de verdad es un día del juego: los cultivos y los animales van al ritmo del calendario, y al volver se viven los días que has pasado sin jugar (hasta 7). Dormir no se salta la noche: recupera la energía.
- **Recolectar y fabricar**: herramientas de madera, piedra, cobre, hierro y oro; banco, horno, yunque, telar y cocina; recetas que se desbloquean.
- **Supervivencia**, como en Minecraft (en modo supervivencia; en creativo y de espectador no cuenta):
  - *Vida y hambre*, siempre a la vista: diez corazones y diez muslos. El hambre baja poco a poco con el tiempo y más al usar herramientas, pegar, correr y saltar, y se llena comiendo (cada comida quita lo suyo: la manzana, 2 muslos). Con el hambre casi llena te curas sola; sin nada de hambre, la vida baja (hasta dónde, según la dificultad). La energía sigue aparte: se gasta al trabajar y se recupera comiendo y durmiendo.
  - *Desgaste*: cada herramienta, arma, caña y red aguanta unos usos (la de madera, 60; la de oro, 500) y se rompe al acabarse; la barrita de su casilla dice cuánto le queda. En el yunque se reparan: cada unidad de su material (tablas, piedra o el lingote de su metal; las cañas y la red, cuerda) le devuelve un cuarto.
  - *Armaduras* de cobre, hierro y oro (casco, peto, grebas y botas) que se forjan en el yunque y se ponen en los huecos de la ropa: cada punto quita un 4 % del daño (la de hierro entera, 15 puntos, un 60 %). Con cada golpe se gastan y se reparan igual que las herramientas.
  - *Morir*: lo que llevas (las casillas y la armadura; la ropa y la mochila, vacía, no) se queda en el suelo donde caíste durante 5 minutos, también en las cuevas, y pierdes un 10 % de las monedas (con `/gamerule keepInventory true`, nada). Reapareces en tu cama: usarla la hace tu punto de reaparición. Si ya no está, en casa.
  - *Luz y criaturas de noche*: cada casilla tiene su luz, de 0 a 15 (`/luz` dice la de donde estás): la del cielo (15 de día, 4 de noche; poca con tormenta y ninguna bajo un tejado) o la de las luces encendidas cerca (la antorcha da 14, la lámpara, el candelabro, el hogar y la farola 15, el horno 11, las ventanas de una casa 9, la vela 7), que pierde 1 por casilla. Donde la luz es 7 o menos salen limos y esqueletos a 14–26 casillas de quien juega en supervivencia (nunca en un suelo construido ni bajo un tejado: las casas y lo que alumbras con antorchas están a salvo). Persiguen a quien tienen cerca, muerden y al salir el sol se deshacen; con criaturas cerca no se puede descansar en la cama. Jugando juntos las lleva el mundo del servidor (o quien lleve el mundo) y todos ven las mismas.
  - *Experiencia y niveles*: la barra verde de encima de la barra rápida, con tu nivel. Dan experiencia picar carbón y piedras preciosas, matar criaturas, sacar lo hecho del horno y del alambique, pescar, cocinar, dar de comer a los animales para que tengan crías y comerciar con los vecinos; cada nivel cuesta más que el anterior. Los niveles se gastan en la mesa de encantar y en el yunque, y al morir se pierden (salvo con `keepInventory`).
  - *Horno con tiempo y combustible*: en la pestaña del horno, pon lo que quieres fundir (cada cobre, hierro u oro da un lingote; la madera da carbón) y combustible (el carbón arde 80 segundos, la madera 15, las tablas la mitad). Cada cosa tarda 10 segundos y sigue aunque te vayas; lo hecho se recoge pulsándolo. Ya no se funde al momento.
  - *Alambique* (se forja en el yunque): un ingrediente, hasta 3 frascos (del horno: piedra y carbón) y carbón hacen 3 pociones en 20 segundos. Miel: poción de vida; bayas: regeneración; calavera: fuerza (pegas 2 más); plumas: rapidez; amatista: resistencia (un 30 % menos de daño). Se beben como la comida.
  - *Mesa de encantar* (se forja en el yunque): a una herramienta, un arma, una armadura o una caña sin encantar le da uno de tres encantamientos (1, 2 o 3 niveles y otras tantas amatistas; piden tener 3, 8 o 15 niveles): *filo* (más daño), *eficiencia* (más deprisa), *fortuna* (a veces suelta uno más), *irrompibilidad* (a veces no se gasta) y *protección* (menos daño). Lo encantado brilla en la mochila.
  - *Yunque*: arreglar cuesta un nivel cada vez, y dos cosas iguales se juntan en una que suma lo que aguantan (y un poco más) y sus encantamientos (si los dos tienen el mismo, uno más), por 2 niveles más los de sus encantamientos.
  - *Tratos con los vecinos*, según su oficio, en sus horas de tienda (*Hacer tratos*): Rosa (granjera), Bruno (herrero), Lía (pescadora) y Dani (artesano) cambian cosas por esmeraldas y esmeraldas por cosas. Cada trato se puede hacer unas veces al día; con los tratos el vecino pasa de novato a aprendiz, oficial, experto y maestro, y ofrece tratos nuevos.
  - *Dificultad* (`/difficulty pacifico|facil|normal|dificil`, de todo el mundo): en *pacífico* no hay criaturas (tampoco en las cuevas), el hambre no baja y la vida se recupera sola; en *fácil*, como mucho 3 criaturas alrededor de cada uno, muerden la mitad y el hambre no baja la vida de 5 corazones; en *normal*, 6, y hasta medio corazón; en *difícil*, 10, muerden un 50 % más y el hambre mata.
- **Todo en cuadrícula**, como en Minecraft: cada árbol, roca, arbusto, farola, cartel o puesto ocupa una casilla, y las casas del pueblo y de las aldeas están hechas de piezas de construcción. Solo las personas, los animales y las partículas se mueven libres.
- **Construir**: suelos, muros (de madera, de piedra y de entramado con zócalo; tabiques finos que se unen solos en esquinas, T y cruces, y miden el doble que una persona; el suelo de debajo llega hasta el muro y no asoma por fuera), ventanas (con o sin contraventanas y jardinera), puertas que se abren y cierran, tejados a cuatro aguas en cinco materiales (al entrar en una casa se ocultan el tejado y las paredes que dan a la cámara; el tejado sigue dando sombra y el sol entra por las ventanas), hogar con chimenea que da luz y echa humo (se fabrica en el banco, se arrima a cualquier muro liso de dentro girándolo con R, y con X se recoge para cambiarlo de sitio; el tejado saca su chimenea encima), candelabro en cada casa (o el tuyo: el candelabro de techo se fabrica en el yunque y solo se cuelga bajo techo), techo de tablas con vigas que se ve desde dentro, y vallas que se unen solas; muebles que se colocan libres, sin casillas (donde apuntes con el ratón y con el giro que quieras: R los gira poco a poco), se pegan solos a la pared o a la esquina que rozan y no se pueden poner cortando un muro u otro mueble (la vista previa sale en rojo y dice con qué choca; las sillas sí entran bajo la mesa, porque cada mueble choca a su altura), cofres, camas de dos casillas, sofás, mesas (también la mesa grande: al ponerla, V elige entre 2×1, 2×2, 3×1 y 3×2), lámparas, alfombras (cinco dibujos: la clásica, persa, de rayas, de rombos y trenzada; el tamaño se elige al tejerlas en el telar, entre 1×1, 1×2, 2×2, 2×3 y 3×4, y cuestan según lo que ocupan: la de 1×2, el doble que la de 1×1; R las gira y los muebles van encima; se recogen con X), un mueble de baño bajo, un armario para la ropa (27 huecos, solo prendas) y cuatro cuadros (el valle, el mar, flores y la noche) que se cuelgan de los muros de dentro, también encima de un mueble (con X se recoge antes el cuadro que el mueble de debajo). Las casas miden 12×10 casillas. Tu casa se amplía hablando con Nilo.
- **Granja**: siete cultivos por estación, regadera, aspersores, abono, árboles que se plantan, manzanos y colmenas.
- **Vida en casa**:
  - En el espejo del lavabo te cambias la cara y el pelo (también la boca) sin empezar de nuevo.
  - Las ventanas se cierran (postigos por dentro y, si tienen, contraventanas por fuera) y entonces no sale luz.
  - A las puertas cerradas de otros se llama: el vecino contesta y abre si está en casa (de noche te manda a dormir), y jugando juntos el otro oye el toc, toc.
  - Las lámparas, las antorchas, las velas, los hogares y el candelabro de cada casa se apagan y se encienden.
  - Te sientas en las sillas, te tumbas en la cama sin dormir y te sientas o te tumbas en el suelo; los demás jugadores te ven así.
  - Quietos, sentados o tumbados, los personajes giran la cabeza hacia quien tienen al lado (en el sofá o en la cama, os miráis).
  - A través de un muro o de una puerta cerrada no se acaricia a los animales, no se habla con nadie ni se recoge nada.
- **Objetos en el suelo**: se ven en 3D, como una pieza de píxeles que gira y flota, y se pueden tirar con Q. La mochila se deja en el suelo llena, como un cofre que se lleva: cualquiera la abre y saca lo que quiera, o la recoge y se la pone con todo dentro.
- **Ganadería**:
  - Ocho animales de granja, con razas o pelajes: gallinas (y gallo), patos, vacas, ovejas, cabras, cerdos, conejos y caballos. Viven en su casa (gallinero, establo, conejera o cuadra).
  - De día salen a pastar si la puerta está abierta. De noche, con lluvia o en invierno se quedan dentro y comen del comedero o del heno del silo, que se llena solo al segar con la guadaña.
  - Con la puerta abierta de noche, un zorro puede asustarlos (salvo que tengas perro); sin gato, los ratones roen el heno.
  - Los animales contentos (caricias cada día) dan más y, a veces, algo especial: huevo de oro, nata o lana fina. Los cerdos encuentran trufas al aire libre.
  - Dos adultos muy contentos en la misma casa tienen crías; las aves, con la incubadora. Y, como en Minecraft, con lo que más les gusta en la mano (trigo a vacas, ovejas, cabras, gallinas y patos, que también comen semillas; zanahorias a cerdos y conejos): dáselo a dos adultos de la misma especie y se buscan y tienen la cría al momento (luego descansan 5 minutos). Las crías crecen y se les pone nombre.
  - La quesera hace queso, queso de cabra y mantequilla; el telar, fieltro de angora. Cada animal tiene su ficha en la pestaña Granja del diario.
- **Caballo y mascotas**:
  - El silbato da un caballo de verdad: eliges el pelaje y el nombre, lo llamas y viene al galope, montas y bajas, y se queda donde lo dejas.
  - Cepillarlo y darle zanahorias sube el vínculo y lo hace más rápido; las herraduras de Bruno, más aún. Con las alforjas lleva 9 montones y, montado, salta las vallas. Tiene potros.
  - En la plaza aparece de vez en cuando un perro o un gato callejero para adoptar. El perro te sigue, escarba y encuentra cosas, ladra a los animales salvajes, espanta al zorro y te trae la pelota. Con clic derecho sobre él (o X a su lado) se sienta y se queda ahí, como el gato, hasta que lo levantas igual. El gato duerme en su cojín, espanta a los ratones y te deja regalos.
  - El palomar envía lo que llevas en la mano a otra persona, aunque no esté jugando, y lo recoge en cualquier palomar.
  - Por el mundo pasean ciervos, jabalíes y cisnes, que huyen si te acercas.
- **Pesca** con minijuego: mantén pulsado para coger fuerza y suelta para lanzar (más lejos, peces algo más grandes y raros). El corcho tiembla alguna vez sin que sea nada; cuando pica de verdad, pulsa a tiempo. En la pelea, el pez sube y baja por una columna de agua y hay que tenerlo dentro de la red, que sube mientras mantienes pulsado y baja al soltar; con el pez dentro se llena la barra de captura y fuera se vacía. Cada pez pelea a su manera (calmo, mixto, nervioso, del fondo o de superficie) y con su dificultad. A veces aparece un tesoro que se coge igual, con la red encima. Sin que el pez se salga nunca de la red, la captura es perfecta: más experiencia y más talla. Dieciséis peces según el agua, la estación, la hora y el tiempo (el siluro sale con lluvia), cada uno con su talla en centímetros y su récord en el cuaderno de pesca del diario. La caña de fibra de Lía hace la red más grande y que piquen antes; la habilidad de pesca también agranda la red.
- **Personajes** chibi en 3D hechos con el mismo "look" que se elige al crear el personaje (peinados, colores, ropa, forma de los ojos, cejas, nariz, orejas, barba y mofletes; ver `src/looks.js`), que andan, respiran y miran hacia donde van; en los diálogos sale la cara en 3D de quien habla (`src/three/portrait.js`). Llevan en la mano la herramienta elegida y la balancean al golpear.
- **Pueblo vivo**: Rosa, Lía, Bruno, Nilo y, si construyes su casa, Dani. Horarios, charlas, regalos, amistad con eventos, tiendas, tablón de encargos y cuatro proyectos (fuente, muelle, mercado y casa nueva).
- **Aventura**: cuevas con niveles infinitos (vetas, gemas, fósiles, criaturas), templos con puzles (palanca, llave y bloque sobre placa), combate ligero con corazones, barca y caballo, y una historia ligera hasta el faro del confín.
- **Inventario realista**: sin mochila solo llevas lo que cabe en las manos y los bolsillos (las 9 casillas de la barra). La mochila (a mano, con fibra y cuerda) se lleva a la espalda y desbloquea 27 casillas más; para quitártela tiene que estar vacía. La ropa son objetos que te pones y te quitas, cada uno en su hueco del cuerpo (cabeza, torso, encima, piernas, pies, ropa interior de arriba y de abajo, calcetines y espalda), y el personaje se ve con lo que lleva: camisa, túnica corta o larga, chaleco, delantal, pantalón, falda, botas, camiseta interior, calzoncillos o bragas, calcetines, hiyab, sombrero de paja y gorro de lana. Sin nada, es un muñeco liso. La ropa se teje en el telar (el sombrero, a mano). Cada prenda se tiñe en la mochila (elígela y toca un color: hay 20). Las telas tienen su textura (tejido, punto de lana, cuero, paja y vaquero); las túnicas y faldas, pliegues; el chaleco va ceñido, el pantalón con cinturón y hebilla, la camisa con bolsillo y las botas con cordones. Hay un hueco para el pelo con cinco accesorios que se fabrican y se tiñen: lazo, diadema, flor, horquillas y corona de flores.
- **Familia**: Nilo convierte la casa ampliada en la **casa familiar** (18 × 14 casillas), con dormitorio, cuarto de los niños, baño, cocina y salón. Los muebles nuevos se fabrican en el banco: cama doble (2 × 2), cama de niño, cuna, armario, alacena, encimera con cajones (puesta al lado de otra, de la alacena, del fregadero o de la cocina, se une a ella rellenando el hueco; dos en L hacen esquina; puesta agachado, va suelta y no se une), fregadero, bañera, retrete y lavabo. Jugando juntos, con los dos en casa, uno propone tener un bebé en la cama doble y el otro acepta: a los 7 días nace (hace falta una cuna libre) y se le pone nombre; a los 7 días más es un niño que pasea por casa y por el jardín de día y duerme en su cama de noche. Como mucho, dos; se parecen a los dos padres.
- **Progreso**: ocho habilidades que suben con el uso, museo con 37 piezas (minerales, fósiles, peces e insectos), 22 logros y estadísticas.
- **Ajustes**: volúmenes, música generada, resolución (automática o fija), texto grande y reducir destellos. Los volúmenes se guardan en la partida de cada cuenta y se usan al entrar, en cualquier ordenador; lo demás es de cada dispositivo. Los controles están en su propia sección de la pausa.

## Publicación

El juego es estático y se publica con GitHub Pages desde la rama `main` (carpeta raíz): cada `git push` a `main` actualiza <https://acasadovadillo.github.io/miniverse/> en un minuto o dos. Antes de cada publicación se cambia la versión de `index.html` (`<meta name="miniverse-version">`): al ver una versión nueva, el juego vuelve a pedir sin caché el código que tenía guardado el navegador (GitHub Pages lo deja guardar 10 minutos, y mezclar el código de antes con la página nueva dejaba el juego parado al entrar).

### Cuentas

- **Dónde están.** La lista de cuentas es `accounts.json`, en este repositorio. Las partidas, `<usuario>-miniverse-data.enc`, van en el repositorio privado [Miniverse-data](https://github.com/acasadovadillo/Miniverse-data) y, además, en el navegador de cada ordenador. Al entrar se usa la más reciente de las dos.
- **Cifrado.** Cada partida va cifrada con AES-GCM de 256 bits. La clave sale de la contraseña de su jugador (PBKDF2 con SHA-256, 310 000 vueltas y una sal por cuenta). Descifrada solo está en memoria mientras se juega. Las contraseñas no se guardan en ningún sitio: si se olvidan, la partida no se puede recuperar.
- **Tokens.** Cada cuenta tiene su *token de guardado*: un token de GitHub de grano fino con acceso solo a Miniverse-data y permiso *Contents: Read and write*. El token va cifrado en `accounts.json` con la contraseña de su jugador (o con su código de invitación, hasta que la pone). El de Alberto, *token de admin*, tiene además acceso a este repositorio para reescribir `accounts.json`.
- **Crear la cuenta de admin (la primera vez).** Entra como *Alberto*, escribe tu contraseña dos veces y pega tu token de admin.
- **Crear una cuenta.** Con la sesión de Alberto, siendo op, escribe en el chat `/account create <usuario>`. Pega su token de guardado y pásale a esa persona el código de invitación que sale. La primera vez, ella escribe su usuario, el código y la contraseña que quiera (dos veces); entonces se crean su `<usuario>-key.json` y su `<usuario>-miniverse-data.enc` en Miniverse-data. La próxima vez que entres tú, su token pasa a `accounts.json` y ya solo necesita su contraseña, en cualquier dispositivo.
- **Al día.** Mientras juegas, tu juego pasa a `accounts.json` cada pocos minutos las cuentas que ya tienen contraseña, así que no hace falta volver a entrar cuando alguien activa la suya.
- **La hora.** Es la de Madrid. `/time` dice qué hora es; `/time set HH:MM` pone esa hora del día de hoy (por ejemplo `/time set 18:30`, o `/time set noche`) y el reloj sigue andando desde ahí, adelantado o atrasado, hasta que `/time madrid` lo devuelve a la hora de Madrid. Solo el admin; jugando juntos, los demás ven la hora nueva al momento.
- **Op.** Como en Minecraft, ser *op* es poder usar los comandos de op, y solo se da o se quita en el terminal donde corre `multijugador.py` (`/op <usuario>`, `/deop <usuario>`, `/ops`). Sin servidor, el admin es op en su juego.
- **Modos de juego.** `/gamemode supervivencia|creativo|espectador [jugador]`. En *supervivencia* se gasta lo que se usa y las criaturas hacen daño. En *creativo* (lo que antes era el modo admin), objetos infinitos, construir gratis donde quieras y sin daño. De *espectador* atraviesas paredes, no tocas ni recoges nada y los demás no te ven (solo otros espectadores; tú te ves medio transparente). Cada uno conserva su modo; las partidas con el modo admin de antes empiezan en creativo.
- **Comandos de op.** El jugador es el usuario de su cuenta o el nombre de su personaje; `@a` son todos y `@s`, tú.
  - `/tp home` y `/tp <jugador>` te llevan a casa o adonde está esa persona; `/tp <jugador> <jugador>` lleva al primero adonde está el segundo; `/tp <jugador> home` y `/tp @a home`, a casa.
  - `/give [jugador] <objeto> [cantidad]` da objetos por su nombre (`/give hafsa hacha de hierro`, `/give tablas 20`).
  - `/kill [jugador]` lo mata: reaparece en su punto y, si no tiene, en casa. `/spawnpoint [jugador] [x y]` pone ese punto (sin x y, donde estás tú). `/setworldspawn [x y]` dice dónde aparecen los personajes nuevos.
  - `/say <texto>` es un aviso para todos con tu nombre. `/weather sol|nubes|lluvia|tormenta|niebla|nieve [minutos]` pone ese tiempo (sin minutos, 15) y luego vuelve el del día.
  - `/difficulty` dice la dificultad y `/difficulty pacifico|facil|normal|dificil` la cambia. `/time set HH:MM` y `/time madrid` cambian la hora del mundo, también jugando en el mundo que lleva el servidor (se lo pide tu juego).
  - `/gamerule` dice las reglas del mundo y `/gamerule <regla> true|false` las cambia: `keepInventory` (al morir no se pierde nada; ahora, las monedas), `doMobSpawning` (si salen criaturas, de noche y en las cuevas) y `doWeatherCycle` (sin él, el tiempo de ahora se queda).
- **Comandos de todos.** `/list` (quién juega), `/msg <jugador> <texto>` (también `/tell` y `/w`: solo lo ve esa persona) y `/seed` (la semilla del mundo). Mantener **Tab** enseña la lista de jugadores.
- **Inventario de creativo.** En modo creativo, el inventario muestra todos los objetos, con un buscador (sin tildes ni mayúsculas; Enter coge el primero), y un botón *Eliminar* que quita lo elegido para siempre, sin tirarlo al suelo.
- **Otros comandos.** `/account list` muestra las cuentas. `/account reset <usuario>` le da un token y un código nuevos (si el token caduca o se pierde el código); conserva su contraseña y su partida. `/account delete <usuario>` borra la cuenta y su partida.
- **Límites.** GitHub no deja limitar un token a un solo archivo, así que con su token un jugador podría borrar o cambiar archivos de otros en Miniverse-data. No podría leerlos, porque van cifrados, y el historial de git permite recuperarlos. La partida se sube a GitHub al guardar desde la pausa, al salir al menú y, mientras se juega, como mucho cada 3 minutos.

### Jugar juntos en directo

- **Comandos del servidor.** En el terminal de `multijugador.py` (`/ayuda` los lista): `/op`, `/deop` y `/ops`; `/kick <usuario> [motivo]` echa a alguien (puede volver a entrar); `/ban <usuario> [motivo]`, `/pardon <usuario>` y `/banlist` vetan y quitan el veto; `/whitelist on|off|add <usuario>|remove <usuario>|list` es la lista blanca (puesta, solo entran los de la lista); `/list` dice quién está conectado; `/say <texto>` manda un aviso a todos; `/save-all` hace que todos guarden ya; `/mundo` dice cómo está el mundo del servidor; `/vincular` le vuelve a pedir las claves; `/stop` (o Ctrl+C) guarda y cierra. Cada juego le dice al servidor al entrar de qué cuenta es (el resto lo lleva cifrado). Los op, los vetos y la lista blanca quedan en `ops.json`, `banned.json` y `whitelist.json`, junto al programa (no se suben a GitHub).
- **El mundo del servidor.** Como un servidor de Minecraft, el mundo sigue en marcha mientras `multijugador.py` está abierto, aunque no juegue nadie: el programa abre el mismo juego en un Chrome invisible (sin dibujo, con un espectador quieto en el pueblo que nadie ve) que lleva el mundo. Hace pasar la hora y crecer los cultivos, mueve los animales, reparte los cambios y lo guarda cada minuto en su copia y en GitHub cada pocos. Manda él: no deja tocar el mundo lejos de donde está quien lo toca (más de 3 trozos) ni cambiar las reglas, el punto de aparición o el tiempo a quien no es op, y se lo devuelve como estaba. Lo que pasa (quién entra y sale, el chat, lo que no deja) sale en el terminal como `[mundo] …`. Si se cierra solo, el programa lo vuelve a abrir; mientras tanto lo lleva el juego de quien esté jugando, y al volver se lo pide y sigue él, sin cortar a nadie. Necesita Google Chrome (o Chromium, Brave o Edge); sin él, o con `--sin-mundo`, el mundo lo lleva el primero que entra, como antes.
- **Sus claves.** Para abrir y guardar el mundo, el mundo del servidor necesita la clave del mundo y tu token. Se los da tu juego la primera vez: al abrir `multijugador.py` sin ellas, se abre el juego servido desde tu Mac (`http://127.0.0.1:8791`); entra con tu cuenta y listo. Nunca pasan por el túnel: el servidor solo las pide y las da dentro de tu ordenador, y el juego que lo sirve no deja ver nada más de la carpeta. Quedan en `servidor-secretos.json`, que solo puede leer tu usuario y no se sube a GitHub (si cambias de token, `/vincular`).
- **Copias del mundo.** Cada vez que el juego que lleva el mundo lo sube a GitHub, le pasa al servidor una copia, cifrada como en GitHub; el servidor guarda una cada 15 minutos en `backups/` (las 48 últimas). Para volver a una, súbela a Miniverse-data con el nombre `mundo.enc`.
- **Abrir el servidor.** En tu Mac, desde esta carpeta: `python3 multijugador.py`. La primera vez instala el túnel con `brew install cloudflared`. El programa abre un túnel (una dirección `https://….trycloudflare.com` que cambia cada vez, gratis y sin cuenta) y abre el juego ya conectado. La dirección queda en `servidor.json`, en Miniverse-data (la publica el mundo del servidor, y tu juego si entras): así la encuentran los demás aunque tú no entres. Para cerrarlo, Ctrl+C o `/stop`.
- **Entrar los demás.** Desde la web de siempre: al iniciar sesión, el menú dice si el servidor está abierto y quién está jugando. Con el servidor abierto, **Continuar partida** les lleva al mundo con su propio personaje, **aunque tú no estés jugando**; con el servidor cerrado no se puede entrar (sin servidor solo juegas tú). Tú también entras así: si ya hay alguien jugando, en el mundo que lleva su juego.
- **Qué es de todos.** Tu mundo con todo lo construido: lo que se tala, se pica, se construye o se quita, el huerto, las puertas y los cofres cambia en directo para todos. También son de todos la hora, el calendario y el tiempo, la casa, los proyectos y los encargos del tablón, el museo y los animales. Lo que se tira al suelo lo puede recoger otro (así se dan cosas: lo que uno tira, los primeros segundos es solo para los demás).
- **Qué es de cada uno.** El personaje y su ropa, lo que lleva encima, el dinero, la energía y la vida, las habilidades, los logros, la amistad con los vecinos y el mapa descubierto. Se guarda en la partida de cada uno; la próxima vez vuelve a aparecer donde se quedó en el mundo.
- **Quién lleva el mundo.** El mundo del servidor; sin él, el juego del primero que entra (el *anfitrión*, sea quien sea) hace pasar la hora y crecer los cultivos, se ocupa de los animales y reparte los cambios: si dos tocan lo mismo a la vez (el mismo cofre, por ejemplo), se queda lo último que llega a su juego. Lo guarda para todos en `mundo.enc`, en Miniverse-data, cifrado con la clave del mundo (al entrar, cada pocos minutos y al salir); el tuyo, además, en tu partida, y al entrar se usa el más reciente de los dos. Si el anfitrión sale al menú o se va, lo sigue llevando sin cortes el que antes llegó al servidor de los que quedan. Si se cierra el servidor, los demás guardan lo suyo (y el anfitrión, el mundo) y vuelven al menú. Todos dormís para recuperar energía; la hora es la de Madrid para todos.
- **La primera vez.** El mundo compartido se guarda aparte desde esta versión: hasta que no entres tú una vez con ella, los demás no pueden entrar sin ti. Cuando haya una cuenta nueva, entra tú una vez para que tu juego le dé la clave del mundo.
- **Qué se ve.** A los demás jugadores con su ropa y su nombre encima: cómo andan, saltan, montan a caballo o van en barca, y lo que llevan en la mano y cuándo lo usan. El chat llega a todos. Juntos solo en el mundo de fuera: en las cuevas cada uno va por su cuenta.
- **Cifrado.** Los mensajes van cifrados con la *clave del mundo*, que solo tienen las cuentas: el servidor y el túnel solo ven datos sin sentido. Cada cuenta tiene un par de claves ECDH en `<usuario>-claves.json` (la privada, cifrada con su contraseña); tu juego le da la clave del mundo a cada cuenta cifrada con el secreto que solo compartís los dos. Se la da al entrar, cada pocos minutos mientras juegas y en cuanto la pide al conectarse.
- **Para probar en un solo ordenador:** `python3 multijugador.py --sin-tunel` y abre el juego con `?servidor=ws://localhost:8790`. Más opciones: `--sin-mundo`, `--sin-navegador`, `--puerto <n>` y `--datos <carpeta>` (dónde guarda los op, las copias y las claves).

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
multijugador.py        Servidor para jugar juntos en directo (repetidor WebSocket, túnel y el mundo del servidor)
src/main.js            Punto de entrada
src/server.js          El mundo del servidor (el juego sin dibujo que lleva el mundo compartido)
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
src/mobs.js            La luz de cada casilla y las criaturas de fuera, de noche
src/xp.js              Experiencia y niveles
src/machines.js        Horno y alambique: lo que llevan dentro y lo que hacen con el tiempo
src/enchant.js         Encantamientos (mesa de encantar y juntar en el yunque)
src/trades.js          Tratos con los vecinos según su oficio
src/ranch.js           Ganadería: animales, crías, puertas, silo, incubadora, caballo, mascotas y palomar
src/fishing.js         Pesca: lanzar, picadas, la pelea con el pez, tesoros, tallas y cuaderno de pesca
src/rest.js            Posturas: sentarse en sillas y en el suelo, tumbarse en la cama y en el suelo
src/wildlife.js        Animales salvajes (ciervos, jabalíes y cisnes)
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
