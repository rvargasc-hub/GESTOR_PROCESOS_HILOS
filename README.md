# ProcessLab · Planificación de Procesos e Hilos

Simulador educativo interactivo:
Permite registrar procesos, ejecutar FIFO, SJF y Round Robin paso a paso,
calcular métricas y comparar algoritmos.

> ⚠️ **Importante:** la simulación se ejecuta en **JavaScript** dentro del
> navegador con un **reloj lógico**. El archivo `scheduler.cpp` es una
> implementación de referencia en C++17 que **no se ejecuta** en la web.
> La arquitectura está preparada para integrarse con WebAssembly o un
> backend C++ en el futuro.


## Cómo usar la aplicación

1. **Registro de procesos** → pulsa **Cargar ejemplo** para usar el caso académico
   (P1:0/8, P2:1/4, P3:2/9, P4:3/5) o agrega los tuyos (ID formato `P1`, llegada ≥ 0, ráfaga ≥ 1).
2. **Planificación CPU** → elige algoritmo (FIFO, SJF, RR). Para RR configura el quantum.
3. Usa los controles:
   - **Iniciar** → ejecución automática.
   - **Paso / Atrás** → avance manual.
   - **Pausar / Ejecutar todo / Reiniciar**.
   - **Velocidad** → ms por paso.
4. Observa en cada paso: tiempo actual, proceso en CPU, cola de listos,
   terminados y la explicación del paso.
5. **Diagrama de Gantt** → haz clic en un segmento para ver su intervalo.
6. **Métricas** → tabla por proceso y promedios.
7. **Comparación** → recalcula FIFO/SJF/RR y compara espera, retorno,
   respuesta, cambios de contexto y tiempo total. Puedes cambiar el quantum.
8. **Código C++** → muestra el código de referencia del algoritmo activo.

---

## Cómo interpretar las métricas

| Métrica | Fórmula | Significado |
|---|---|---|
| **TR** Retorno | Fin − Llegada | Tiempo total en el sistema. |
| **TE** Espera | TR − Ráfaga | Tiempo esperando en cola. |
| **TRes** Respuesta | Primer inicio − Llegada | Tiempo hasta la primera CPU. |

Todas se calculan con el **reloj lógico** de la simulación, no con el
tiempo real de ejecución de los hilos.

### Verificación con el ejemplo académico (FIFO)

| Proceso | Fin | TR | TE | TRes |
|---|---|---|---|---|
| P1 | 8 | 8 | 0 | 0 |
| P2 | 12 | 11 | 7 | 7 |
| P3 | 21 | 19 | 10 | 10 |
| P4 | 26 | 23 | 18 | 18 |

**Promedios FIFO: TR = 15.25 · TE = 8.75 · TRes = 8.75** ✅

---

##  Cómo funciona la simulación

1. Se copia la plantilla de procesos a un estado de simulación.
2. El motor (`simular()` en `app.js`) avanza con un reloj lógico `t`:
   - Encola llegadas con `llegada == t`.
   - Si no hay listos → CPU idle hasta la próxima llegada.
   - Selecciona proceso según el algoritmo.
   - Ejecuta (FIFO/SJF: toda la ráfaga; RR: `min(quantum, restante)`).
   - Encola llegadas ocurridas durante la ejecución.
   - Si terminó → calcula métricas; si no → vuelve a la cola (RR).
3. Se genera un **timeline** de frames; cada frame es un estado completo.
   Los controles simplemente navegan entre frames → permite **retroceder**.
4. El Gantt se construye con los intervalos `[start, end]` de cada ejecución.

### Round Robin — criterio de llegadas

Cuando termina un quantum en `t`, los procesos con `llegada <= t` se
encolan **antes** de reinsertar el proceso interrumpido. Este criterio está
documentado y probado automáticamente.

---

## Qué se ejecuta en JS y qué en C++

| Componente | Dónde | ¿Se ejecuta? |
|---|---|---|
| Simulador de planificación | `app.js` | ✅ Sí (navegador) |
| Diagrama de Gantt, métricas, UI | `app.js` / CSS | ✅ Sí |
| Código de referencia de algoritmos | Panel “Código C++” | ❌ Solo se muestra |
| Implementación C++ ejecutable | `scheduler.cpp` | ❌ Requiere compilar |

---

##  Compilar y ejecutar la versión C++

Requiere **g++ con C++17**:

```bash
g++ -std=c++17 -O2 -o scheduler scheduler.cpp
./scheduler