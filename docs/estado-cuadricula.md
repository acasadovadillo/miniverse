# Todo en cuadrícula: estado

Integrado y arrancado. El juego carga sin errores en el navegador.

## Probado
- Partida nueva: la casa de piezas se levanta con puerta, tejado, chimenea y muebles.
- Entrar andando por la puerta: el tejado se oculta, aparece "Tu casa" y se activa el ambiente de casa.
- Partida antigua (habitación aparte, con `house.placed` y `house.chests`): los muebles y el cofre con contenido pasan dentro; lo que no cabe vuelve a la mochila.
- Ampliación de Nilo (`layHouse(true, false)`): la casa crece, la puerta se mantiene y las paredes antiguas se devuelven a los materiales.
- Talar un árbol: no vuelve aunque pasen horas de juego.
- Zoom del mapa con + y − (límites 1 a 8).
- Aldeas, los siete tipos de lugar, casas de vecinos y cueva: sin errores al renderizar.
- Barra de construcción con la categoría "Casa".

## Sin probar todavía
- Dormir en una cama colocada dentro de casa y el rescate al caer en combate (`goHome`).
- Plantar y regar dentro del solar de la casa.
- Poner y quitar un hogar, y que el humo y el fuego salgan donde toca en partidas largas.
- Hablar con Nilo para la ampliación desde el diálogo (se probó la función, no el diálogo).
- Partidas exportadas e importadas antes del cambio.

## Decisiones a confirmar
- Ampliar la casa devuelve el material de las paredes y tejados antiguos.
- Lo que no cabe en la casa (10×8 libres) va a la mochila.
- Al agrandar la casa de una partida antigua, las paredes viejas de dentro devuelven su material.
