# Prototipo 3D (rama `prototipo-3d`)

Prueba de cómo quedaría Pixelverse en 3D de verdad, con la cámara girando suave en lugar de los 16 ángulos del juego en 2D. Es una página aparte (`prototipo3d.html`): el juego normal (`index.html`) no cambia.

## Cómo probarlo

1. En la carpeta del juego: `git switch prototipo-3d`
2. Arranca el servidor como siempre (`jugar.command`) y abre `http://localhost:8000/prototipo3d.html` (el puerto es el que diga la ventana del servidor).
3. Para volver al juego normal: `git switch main`.

Controles: `WASD` andar (`Shift` correr), `←` `→` girar la cámara (acelera y frena suave, 360° en unos 3 s), `↑` `↓` subirla hasta casi el plano cenital o bajarla a ras de suelo (también suave), `+` y `−` (o la rueda del ratón) para acercar o alejar la cámara, `E` abrir o cerrar la puerta que tengas cerca, `N` día o noche, `F` ver el rendimiento, `H` ocultar la ayuda. Con `?q=low` en la dirección va en calidad baja (sin suavizado de bordes y sombras de menos resolución); con `?noche`, empieza de noche.

## Qué hay

- **El mismo pueblo**: sale de los datos del juego (`village.js`, `blueprints.js` y el generador del mundo), así que las casas, el camino, el estanque, la valla, el puesto, el tablón, la vitrina, el buzón, la farola, el cartel y los árboles de alrededor están donde en el juego.
- **Casas** (`src/proto3d/houses.js`): muros con huecos de verdad para puertas y ventanas; por fuera, zócalo de piedra y entramado de madera (postes, vigas y riostras), ventanas con cristal, cruceta, contraventanas y jardineras con flores; tejado a cuatro aguas con tejas, cumbrera y limas, y la chimenea saliendo por encima del hogar. Dentro: suelo de tablas, rodapié, cuadro y los muebles del plano (`furniture.js`): cama contra la pared, estanterías con libros, hogar con fuego, mesa con sus sillas mirándola, lámpara, macetas, alfombra, cofre y candelabro.
- **Dentro de una casa** se quitan el tejado y las paredes que miran a la cámara (con un fundido corto), y la cámara se acerca un poco. El tejado oculto sigue dando sombra: dentro entra el sol solo por las ventanas y alumbran el candelabro y el hogar.
- **Fuera**, si una casa se pone entre la cámara y el muñeco, la cámara sube lo justo para verlo por encima del tejado; si lo tapa un árbol, se ve su silueta. La cámara nunca se mete en el suelo.
- **Lejos**: el terreno, los bosques y las rocas siguen (más sencillos y sin sombras) hasta donde la niebla lo tapa todo, y el cielo tiene nubes, así que con la cámara baja se ve horizonte y no el borde del mundo. Con la cámara baja la imagen se abre un poco y las sombras llegan más lejos por delante.
- **Naturaleza** (`nature.js`): robles, frutales, pinos, arbustos con flores, rocas, matas de hierba y flores, todo con instancias (miles de piezas en pocas llamadas de dibujo), con un poco de viento. Los árboles se separan según el tamaño de su copa para que no se pisen.
- **Terreno** (`village3d.js`): malla de medio metro con el color de cada bioma, el camino de tierra, la orilla de arena del estanque y lomas suaves fuera del pueblo; el agua tiene ondas y brillos; nenúfares, juncos y piedras en la orilla.
- **Personajes** (`people3d.js`): chibis de pocos polígonos hechos con los mismos "look" del juego (peinado, colores, ropa, barba), que andan, respiran y miran hacia ti si te acercas. Los vecinos pasean un poco alrededor de su sitio.
- **Luz**: sol con sombras suaves que siguen al muñeco, luz del cielo y del suelo, reflejo del cielo, niebla y cielo con halo del sol; de noche, farola, ventanas y hogares encendidos.

## Rendimiento

Unas 500 llamadas de dibujo por fotograma (contando las sombras) y entre 350.000 y 600.000 triángulos según hacia dónde mires (a ras de suelo se ve más). La vegetación va en bloques de 32 m: la cámara y el sol solo pintan los bloques que ven, y los muebles de las casas lejanas no se pintan. Lo que más cuesta es la pasada de sombras. En un Intel Iris Plus (gráfica integrada) se han medido de 12 a 17 ms por fotograma en los mejores casos, pero en el navegador de pruebas las medidas variaban mucho. Si durante unos segundos va a menos de 40 fotogramas por segundo, baja sola la resolución. Con `F` se ven los fotogramas por segundo, las llamadas y los triángulos.

Three.js (r160) se carga de jsDelivr: hace falta internet la primera vez (luego lo guarda el navegador).

## Si se adopta

El prototipo solo enseña el pueblo: no tiene inventario, construcción, vecinos con diálogo, cultivos ni el resto del mundo. Pasar el juego a 3D sería cambiar el dibujo (todo `src/art/` y los `draw` de `src/world/`) por modelos 3D, manteniendo la lógica (casillas, inventario, sistemas). El mundo infinito se construiría por trozos alrededor del jugador, como ahora con los trozos de suelo.
