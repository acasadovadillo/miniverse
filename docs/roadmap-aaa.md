# Miniverse: revisión del juego y roadmap hacia un acabado AAA

Revisión hecha el 2 de noviembre de 2026, con el juego tal como está en `main` más la casa familiar y la familia.
"AAA" aquí quiere decir el acabado de un juego de estudio: que todo tenga un porqué, que se sienta vivo y pulido
y que vaya fluido. No quiere decir la escala de un equipo de cien personas. La meta realista es la de un indie
premium de su género (granja, vida en un pueblo, sandbox), hecho en el navegador.

## 1. Cómo está ahora

**Lo que funciona bien**
- Un mundo infinito por trozos, con biomas, cuevas, lugares y un pueblo hecho a mano. Todo se construye con las
  mismas piezas que usa el jugador.
- El bucle de granja y oficio: talar, picar y segar; fabricar en estaciones; huerto con riego y estaciones;
  animales; pesca; combate en cuevas; habilidades, museo, logros e historia.
- El aspecto: personajes chibi en 3D con mucha personalización, ropa que se pone y se quita, sol y clima, luces
  de noche. Todo se genera con código y el estilo es coherente.
- Cuentas cifradas, guardado en GitHub y en el navegador, y juego en directo para varios en el mismo mundo.
- La familia: casa familiar, muebles nuevos, tener hijos y que hagan vida.

**Números**
- Unas 11 500 líneas de JavaScript sin paso de compilación, unos 140 objetos, 78 recetas y 20 logros.
- 5 vecinos, de los que 4 venden algo; 3 tipos de monstruo.
- Rendimiento medido en un Intel Iris Plus (el Mac del admin) a 1792 × 1344 píxeles:
  - la simulación cuesta 0,34 ms por paso;
  - dibujar un fotograma en el pueblo cuesta 11 ms de media y 22 ms en el 5 % peor;
  - va a 60 fps casi siempre, pero con tirones al rehacer trozos o sombras.

## 2. Lo que falla o se queda corto

### El pueblo y sus edificios
- **El museo es una vitrina diminuta al lado del tablón.** No es un edificio, no tiene salas y no luce lo que se dona.
- **Los edificios no tienen una utilidad clara.** Las casas de los vecinos son de adorno: dentro no pasa nada.
- **Las tiendas son menús:**
  - el puesto de Rosa es una caseta;
  - las de Bruno, Lía y Dani se abren hablando con ellos, sin un sitio propio ni mostrador.
- **Faltan comercios básicos:**
  - una taberna, donde comer, beber, oír rumores y quedar;
  - un sastre: la ropa solo se teje en el telar y no hay tienda, tintes ni arreglos;
  - un herrero de verdad: Bruno vende cuatro cosas, pero no mejora, repara ni forja por encargo;
  - una tienda general.
- Pocos vecinos (5) y un horario sencillo: caminan de un sitio a otro, pero no hacen nada allí.

### Mecánicas
- **Economía plana.** Rosa compra de todo, los precios son fijos y no hay demanda, encargos de verdad ni dinero que dé gusto gastar.
- **Progresión corta.** Las herramientas llegan al oro enseguida, los proyectos del pueblo son 4 y la historia son páginas sueltas.
- **Combate básico.** Golpear y alejarse; tres monstruos; sin esquivar, armaduras ni jefes.
- **Pesca.** ~~Se lanza y se recoge, sin un minijuego con gracia.~~ Hecho: minijuego con red, tesoros, tallas y cuaderno de pesca. Faltan cebos, más cañas y un concurso de pesca.
- **Vecinos.** La amistad sube hablando y regalando, pero solo hay dos eventos por vecino (a los 3 y a los 6 corazones).
- **Pocas razones para salir.** Los lugares del mundo dan un cofre y poco más; no hay aldeas con encargos.
- **La familia, recién llegada.** Los niños no crecen más allá de niños, no ayudan en casa y no van a la escuela.

### Jugabilidad y experiencia
- El comienzo son paredes de texto de Nilo. Faltan objetivos claros en pantalla ("haz una mochila", "planta tus primeras semillas").
- Le falta "jugo": golpear un árbol o cosechar tiene poca respuesta (sonido, partículas, vibración de cámara, números).
- No hay mando ni atajos configurables, y en el móvil se juega a medias.
- La accesibilidad se queda en texto grande y reducir destellos. Solo está en español.

### Juego en directo
- **Depende del admin.** El mundo existe mientras su juego está abierto (y su servidor con el túnel). Si se va, los demás salen.
- **Las cuevas no se comparten** y no os veis ahí abajo.
- **Conflictos sin resolver.** Si dos tocan el mismo cofre a la vez, gana el último y puede duplicar o perder cosas.
- **Seguridad limitada.** Cada token de guardado puede escribir en todo Miniverse-data (es un límite de GitHub).

### Rendimiento y técnica
- **Tirones.**
  - Rehacer un trozo al construir o al cambiar de estación cuesta más que un fotograma.
  - Las sombras se rehacen cada dos fotogramas.
  - Cada persona es su propia malla, sin instancias, y las vistas previas abren contextos WebGL aparte.
- **El guardado crece sin parar.** Es un solo JSON con todos los trozos tocados; en GitHub se sube entero cada vez.
- **Sin red de seguridad.**
  - No hay pruebas automáticas, integración continua, linter ni aviso de errores en producción.
  - Las migraciones de partida son a mano: `v`, `wardrobe`, `built`…
- **Todo el CSS va dentro de `index.html`** y la interfaz se hace a mano con el DOM.

### Arte y sonido
- Las animaciones son procedurales y básicas: andar y un gesto por herramienta. No hay caras que hablen, sentarse ni comer.
- La luz es correcta pero plana: no hay oclusión ambiental, niebla volumétrica ni postproceso cuidado.
- La música y los efectos están sintetizados y suenan bien, pero se repiten. Faltan sonidos de ambiente por sitio y pasos según el suelo.

## 3. Roadmap

Cada fase deja el juego publicable. El tamaño es aproximado: S = una tarde, M = unos días, L = una semana o más.

### Fase 1: Un pueblo con vida (prioridad máxima)
| | Qué | Tamaño |
|---|---|---|
| 1.1 | **Taberna**: un edificio con su tabernero y su horario (de tarde a medianoche). Platos y bebidas que dan energía y efectos, un tablón de rumores con encargos, música y un sitio para quedar cuando jugáis juntos. | L |
| 1.2 | **Sastrería**: un sastre que vende ropa de temporada, tiñe prendas (incluido el hiyab), arregla y hace encargos con patrones únicos. | M |
| 1.3 | **Herrería de verdad**: el edificio de Bruno con su fragua. Mejora y repara herramientas, forja armas y armaduras por encargo y compra minerales. | M |
| 1.4 | **Museo en su propio edificio**: con salas de minerales, fósiles, peces e insectos. Lo donado se ve en su sitio y completar una sala da una recompensa. | M |
| 1.5 | **Tienda general**: semillas, comida y básicos. Rosa pasa a tener mercado y a no comprar de todo. | S |
| 1.6 | Cada casa de vecino con un interior que se usa: horarios en casa, una actividad y un regalo propio. | M |
| 1.7 | Rótulos y señales: cada edificio con su nombre, sus horas en la puerta y su icono en el mapa. | S |

### Fase 2: Juego con profundidad
| | Qué | Tamaño |
|---|---|---|
| 2.1 | Misiones encadenadas con objetivos en pantalla, empezando por un tutorial guiado que sustituye a los textos de Nilo. | M |
| 2.2 | Economía con demanda: precios que suben y bajan, encargos con fecha, la calidad de los cultivos y de lo fabricado. | M |
| 2.3 | Más vecinos (al menos 10), con eventos a 2, 4, 6, 8 y 10 corazones y rutinas en su trabajo. | L |
| 2.4 | Fiestas por estación: feria de la cosecha, carrera, concurso de pesca, noche de farolillos. | M |
| 2.5 | Combate con esquiva, armaduras, jefes al fondo de las cuevas y monstruos por bioma. | L |
| 2.6 | ~~Minijuego de pesca~~ (hecho) y cocina con recetas que se descubren. | M |
| 2.7 | Familia, segunda parte: los niños crecen, ayudan en la granja y van a la escuela, y se les puede regalar y llevar de paseo. | M |
| 2.8 | Aldeas lejanas con encargos, comercio y una historia, como motivo para explorar el mundo. | L |

### Fase 3: Juego en directo sólido
| | Qué | Tamaño |
|---|---|---|
| 3.1 | **Un mundo siempre encendido**: un servidor pequeño que guarda el mundo y lo simula sin el juego del admin abierto. Así cada uno entra cuando quiere. | L |
| 3.2 | Cuevas compartidas, con sus monstruos y lo picado. | M |
| 3.3 | Cofres y tiendas sin conflictos: cada movimiento como una operación que resuelve el servidor (sin duplicar ni perder). | M |
| 3.4 | Emotes, regalar en mano, y dormir los dos para pasar la noche. | S |

### Fase 4: Pulido AAA
| | Qué | Tamaño |
|---|---|---|
| 4.1 | Animaciones con fotogramas clave: sentarse, comer, saludar, bailar, dormir y caras que hablan y parpadean. | L |
| 4.2 | Luz y postproceso: oclusión ambiental, bloom suave, corrección de color por estación, luz que entra por las ventanas y niebla de mañana. | M |
| 4.3 | "Jugo": partículas, sonidos en capas, una pequeña sacudida al talar y picar, y números que suben. | M |
| 4.4 | Sonido de ambiente por sitio (taberna, bosque, cueva), pasos según el suelo y música con variaciones por hora y estación. | M |
| 4.5 | Interfaz rediseñada y coherente: pantallas con transiciones, mando, atajos configurables y modo táctil completo. | L |
| 4.6 | Accesibilidad (daltonismo, tamaño de interfaz, subtítulos de sonidos) y más idiomas (inglés primero). | M |

### Fase 5: Rendimiento y técnica
| | Qué | Tamaño |
|---|---|---|
| 5.1 | Objetivo: 60 fps estables en el Iris Plus a 1080p y 30 fps en un móvil medio, medido con una ruta de prueba fija. | S |
| 5.2 | Instancias para la naturaleza y las personas, menos llamadas de dibujo y trozos rehechos en un worker para quitar los tirones. | L |
| 5.3 | Sombras en cascada que solo se rehacen al moverse el sol y niveles de detalle para lo lejano. | M |
| 5.4 | Guardado por trozos: comprimido, subiendo solo lo que cambia y con migraciones de versión ordenadas. | M |
| 5.5 | Red de seguridad: pruebas automáticas (inventario, cifrado, juego en directo, guardado), integración continua con linter y aviso de errores. | M |
| 5.6 | Ordenar el código: el CSS fuera de `index.html` y la interfaz en componentes pequeños. | M |

### Fase 6: Contenido para largo
- Más biomas y lugares, una historia con final y retos para cuando ya se tiene todo: una granja de leyenda, colecciones completas, jefes difíciles.

## 4. Por dónde empezar

1. **Fase 1 entera**, en este orden: taberna, sastrería, herrería y museo. Es lo que más se nota y da sentido al pueblo.
2. **El tutorial guiado (2.1) y el "jugo" (4.3)**: cambian mucho la primera hora de juego con poco trabajo.
3. **El mundo siempre encendido (3.1)**, para que jugar juntos no dependa del ordenador del admin.
4. **La red de seguridad (5.5)** antes de crecer más: con pruebas, cada cambio grande da menos miedo.
