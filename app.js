/* =========================================================
   ProcessLab — Simulador de Planificación de CPU e Hilos
   Motor de simulación en JavaScript (reloj lógico).
   El código C++ mostrado es de referencia, NO se ejecuta aquí.
   ========================================================= */

const COLORES = ['#58a6ff','#3fb950','#d29922','#bc8cff','#f85149','#79c0ff','#ffa657','#7ee787'];

/* ---------- Utilidades ---------- */
const $ = (id) => document.getElementById(id);

/* ---------- Estado global ---------- */
const state = {
  procesos: [],          // plantilla de procesos
  algoritmo: 'FIFO',
  quantum: 4,
  velocidad: 600,
  // simulación
  timeline: [],          // [{t, cpu, cola, ...}]
  gantt: [],             // [{id, start, end, color}]
  pasoActual: -1,
  timer: null,
  ejecutando: false
};

/* =========================================================
   1. NAVEGACIÓN
   ========================================================= */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.section).classList.add('active');
  });
});

/* =========================================================
   2. REGISTRO DE PROCESOS
   ========================================================= */
function colorDe(id) {
  const n = parseInt(id.replace(/\D/g,'')) || 0;
  return COLORES[(n - 1 + COLORES.length) % COLORES.length];
}

function renderProcesos() {
  const tbody = $('tabla-procesos');
  tbody.innerHTML = '';
  state.procesos.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${p.llegada}</td>
      <td>${p.rafaga}</td>
      <td><span class="badge nuevo">nuevo</span></td>
      <td>
        <button class="btn" data-edit="${i}">Editar</button>
        <button class="btn danger" data-del="${i}">Eliminar</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $('dash-procesos').textContent = state.procesos.length;

  tbody.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', () => {
      state.procesos.splice(+b.dataset.del, 1);
      renderProcesos();
    });
  });
  tbody.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', () => {
      const p = state.procesos[+b.dataset.edit];
      $('proc-id').value = p.id;
      $('proc-llegada').value = p.llegada;
      $('proc-rafaga').value = p.rafaga;
      state.procesos.splice(+b.dataset.edit, 1);
      renderProcesos();
    });
  });
}

$('form-proceso').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('proc-error');
  err.textContent = '';
  const id = $('proc-id').value.trim().toUpperCase();
  const llegada = parseInt($('proc-llegada').value);
  const rafaga = parseInt($('proc-rafaga').value);

  if (!/^P\d+$/.test(id)) { err.textContent = 'ID inválido. Usa formato P1, P2…'; return; }
  if (isNaN(llegada) || llegada < 0) { err.textContent = 'Tiempo de llegada inválido.'; return; }
  if (isNaN(rafaga) || rafaga < 1) { err.textContent = 'Ráfaga debe ser ≥ 1.'; return; }
  if (state.procesos.some(p => p.id === id)) { err.textContent = 'ID duplicado.'; return; }

  state.procesos.push({ id, llegada, rafaga });
  renderProcesos();
  $('proc-id').value = '';
  $('proc-llegada').value = 0;
  $('proc-rafaga').value = 1;
});

$('btn-ejemplo').addEventListener('click', () => {
  state.procesos = [
    { id: 'P1', llegada: 0, rafaga: 8 },
    { id: 'P2', llegada: 1, rafaga: 4 },
    { id: 'P3', llegada: 2, rafaga: 9 },
    { id: 'P4', llegada: 3, rafaga: 5 }
  ];
  renderProcesos();
  reiniciarSimulacion();
});

$('btn-reset').addEventListener('click', () => {
  state.procesos = [];
  renderProcesos();
  reiniciarSimulacion();
});

/* =========================================================
   3. PLANIFICACIÓN
   ========================================================= */
$('select-algoritmo').addEventListener('change', (e) => {
  state.algoritmo = e.target.value;
  $('quantum-field').style.display = state.algoritmo === 'RR' ? 'flex' : 'none';
  $('dash-algoritmo').textContent = state.algoritmo;
  reiniciarSimulacion();
});

$('quantum').addEventListener('change', (e) => {
  state.quantum = Math.max(1, parseInt(e.target.value) || 1);
  reiniciarSimulacion();
});

$('velocidad').addEventListener('input', (e) => {
  state.velocidad = parseInt(e.target.value);
  $('velocidad-val').textContent = state.velocidad + ' ms';
});

/* ---------- Copia profunda de procesos ---------- */
function copiaProcesos() {
  return state.procesos
    .map(p => ({
      id: p.id, llegada: p.llegada, rafaga: p.rafaga,
      restante: p.rafaga, estado: 'nuevo',
      primerInicio: null, fin: null,
      espera: 0, retorno: 0, respuesta: 0
    }))
    .sort((a,b) => a.llegada - b.llegada || a.id.localeCompare(b.id));
}

/* ---------- Simulador principal ----------
   Genera un timeline: un arreglo de "frames" con el estado completo
   del sistema en cada instante lógico. Esto permite avanzar y retroceder.
------------------------------------------------------------ */
function simular(procesos, algoritmo, quantum) {
  const frames = [];
  const gantt = [];
  let t = 0;
  let cambiosContexto = 0;
  let cpuAnterior = null;
  let cola = [];
  let completados = 0;
  const total = procesos.length;

  const snapshot = (extra) => {
    frames.push({
      t,
      procesos: procesos.map(p => ({...p})),
      cola: cola.map(p => p.id),
      cpu: extra?.cpu ?? null,
      terminados: procesos.filter(p => p.estado === 'terminado').map(p => p.id),
      motivo: extra?.motivo ?? '',
      cambiosContexto
    });
  };

  // Estado inicial
  snapshot({ motivo: 'Estado inicial: ningún proceso ha llegado aún (o espera su llegada).' });

  let guard = 0;
  while (completados < total && guard++ < 10000) {
    // 1) Llegadas en el instante t
    procesos.forEach(p => {
      if (p.llegada === t && p.estado === 'nuevo') {
        p.estado = 'listo';
        cola.push(p);
      }
    });

    // 2) Si no hay procesos listos → CPU idle
    if (cola.length === 0) {
      const futuros = procesos.filter(p => p.estado === 'nuevo');
      if (futuros.length === 0) break;
      const tSalto = Math.min(...futuros.map(p => p.llegada));
      gantt.push({ id: 'IDLE', start: t, end: tSalto, color: '#444c56' });
      t = tSalto;
      snapshot({ motivo: `CPU inactiva hasta t=${t}: no hay procesos listos.` });
      continue;
    }

    // 3) Selección de proceso según algoritmo
    let elegido = null;
    let motivo = '';

    if (algoritmo === 'FIFO') {
      elegido = cola.shift();
      motivo = `FIFO selecciona ${elegido.id} porque fue el primero en llegar a la cola de listos.`;
    } else if (algoritmo === 'SJF') {
      cola.sort((a,b) => a.rafaga - b.rafaga || a.llegada - b.llegada || a.id.localeCompare(b.id));
      elegido = cola.shift();
      motivo = `SJF selecciona ${elegido.id} porque es el de menor ráfaga (${elegido.rafaga}) entre los listos.`;
    } else if (algoritmo === 'RR') {
      elegido = cola.shift();
      motivo = `Round Robin asigna CPU a ${elegido.id} con quantum=${quantum}.`;
    }

    if (!elegido) break;

    // 4) Asignar CPU
    if (elegido.primerInicio === null) elegido.primerInicio = t;
    elegido.estado = 'ejecutando';
    if (cpuAnterior !== null && cpuAnterior !== elegido.id) cambiosContexto++;
    cpuAnterior = elegido.id;

    // 5) Ejecutar
    let ejecutar;
    if (algoritmo === 'RR') {
      ejecutar = Math.min(quantum, elegido.restante);
    } else {
      ejecutar = elegido.restante;
    }
    const inicio = t;
    t += ejecutar;
    elegido.restante -= ejecutar;

    // Agregar segmento al Gantt
    gantt.push({ id: elegido.id, start: inicio, end: t, color: colorDe(elegido.id) });

    // 6) Llegadas durante la ejecución (se encolan ANTES de reinsertar en RR)
    procesos.forEach(p => {
      if (p.estado === 'nuevo' && p.llegada <= t) {
        p.estado = 'listo';
        cola.push(p);
      }
    });

    // 7) Terminó?
    if (elegido.restante === 0) {
      elegido.estado = 'terminado';
      elegido.fin = t;
      elegido.retorno = elegido.fin - elegido.llegada;
      elegido.espera = elegido.retorno - elegido.rafaga;
      elegido.respuesta = elegido.primerInicio - elegido.llegada;
      completados++;
      snapshot({ cpu: elegido.id, motivo: `⏹ ${elegido.id} terminó en t=${t}. Se calculan sus métricas.` });
      cpuAnterior = null;
    } else {
      // RR: vuelve a la cola
      elegido.estado = 'listo';
      cola.push(elegido);
      snapshot({ cpu: elegido.id, motivo: `⏸ Quantum agotado. ${elegido.id} vuelve a la cola con restante=${elegido.restante}.` });
    }
  }

  // Frame final
  if (frames.length === 0 || frames[frames.length-1].t !== t) {
    snapshot({ motivo: 'Simulación completada.' });
  }

  return { frames, gantt, fin: t };
}

/* =========================================================
   4. CONTROLES DE SIMULACIÓN
   ========================================================= */
function reiniciarSimulacion() {
  detenerTimer();
  state.timeline = [];
  state.gantt = [];
  state.pasoActual = -1;
  state.ejecutando = false;
  $('sim-tiempo').textContent = '0';
  $('sim-cpu').textContent = '—';
  $('sim-cola').textContent = '—';
  $('sim-term').textContent = '—';
  $('explicacion-paso').textContent = 'Presiona "Iniciar" o "Paso" para comenzar.';
  $('tabla-sim').innerHTML = '';
  $('gantt').innerHTML = '';
  $('gantt-scale').innerHTML = '';
  $('promedios').innerHTML = '';
  $('tabla-metricas').innerHTML = '';
  $('dash-tiempo').textContent = '0';
  $('dash-cambios').textContent = '0';
}

function prepararSimulacion() {
  if (state.procesos.length === 0) {
    alert('Agrega procesos primero (o carga el ejemplo).');
    return false;
  }
  const copia = copiaProcesos();
  const { frames, gantt } = simular(copia, state.algoritmo, state.quantum);
  state.timeline = frames;
  state.gantt = gantt;
  state.pasoActual = -1;
  renderTablaSim(0);
  renderGantt();
  return true;
}

function aplicarPaso(idx) {
  if (idx < 0 || idx >= state.timeline.length) return;
  state.pasoActual = idx;
  const f = state.timeline[idx];

  $('sim-tiempo').textContent = f.t;
  $('sim-cpu').textContent = f.cpu || '—';
  $('sim-cola').textContent = f.cola.length ? f.cola.join(', ') : '—';
  $('sim-term').textContent = f.terminados.length ? f.terminados.join(', ') : '—';
  $('explicacion-paso').textContent = f.motivo;
  $('dash-tiempo').textContent = f.t;
  $('dash-cambios').textContent = f.cambiosContexto;

  renderTablaSim(idx);
  renderMetricas(idx);
  marcarGantt(f.t);
}

function renderTablaSim(idx) {
  const f = state.timeline[idx];
  if (!f) return;
  const tbody = $('tabla-sim');
  tbody.innerHTML = '';
  f.procesos.forEach(p => {
    const tr = document.createElement('tr');
    const badge = { nuevo:'nuevo', listo:'listo', ejecutando:'ejecutando', terminado:'terminado' }[p.estado];
    tr.innerHTML = `
      <td>${p.id}</td>
      <td><span class="badge ${badge}">${p.estado}</span></td>
      <td>${p.restante}</td>
      <td>${p.primerInicio ?? '—'}</td>
      <td>${p.fin ?? '—'}</td>`;
    tbody.appendChild(tr);
  });
}

function renderMetricas(idx) {
  const f = state.timeline[idx];
  if (!f) return;
  const term = f.procesos.filter(p => p.estado === 'terminado');
  const tbody = $('tabla-metricas');
  tbody.innerHTML = '';
  term.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td><td>${p.llegada}</td><td>${p.rafaga}</td>
      <td>${p.primerInicio}</td><td>${p.fin}</td>
      <td>${p.retorno}</td><td>${p.espera}</td><td>${p.respuesta}</td>`;
    tbody.appendChild(tr);
  });

  // Promedios
  const cont = $('promedios');
  if (term.length === 0) { cont.innerHTML = '<div class="card"><em>Sin procesos terminados aún.</em></div>'; return; }
  const avg = (k) => (term.reduce((s,p) => s + p[k], 0) / term.length).toFixed(2);
  cont.innerHTML = `
    <div class="card metric-card"><span class="card-label">Espera promedio</span><span class="card-value">${avg('espera')}</span></div>
    <div class="card metric-card"><span class="card-label">Retorno promedio</span><span class="card-value">${avg('retorno')}</span></div>
    <div class="card metric-card"><span class="card-label">Respuesta promedio</span><span class="card-value">${avg('respuesta')}</span></div>
  `;
}

/* ---------- Gantt ---------- */
function renderGantt() {
  const gantt = state.gantt;
  const cont = $('gantt');
  const scale = $('gantt-scale');
  cont.innerHTML = '';
  scale.innerHTML = '';
  if (gantt.length === 0) return;

  const fin = gantt[gantt.length - 1].end;
  const total = fin || 1;

  // Escala
  const tickCount = Math.min(fin, 12);
  for (let i = 0; i <= tickCount; i++) {
    const tick = document.createElement('div');
    tick.className = 'tick';
    tick.textContent = Math.round((fin / tickCount) * i);
    scale.appendChild(tick);
  }

  gantt.forEach(seg => {
    const div = document.createElement('div');
    div.className = 'seg' + (seg.id === 'IDLE' ? ' idle' : '');
    div.style.width = ((seg.end - seg.start) / total * 100) + '%';
    div.style.background = seg.color;
    div.textContent = seg.id;
    div.title = `${seg.id} [${seg.start} → ${seg.end}]`;
    div.addEventListener('click', () => {
      document.querySelectorAll('.gantt .seg').forEach(s => s.classList.remove('selected'));
      div.classList.add('selected');
      $('gantt-info').innerHTML = `<strong>${seg.id}</strong> · inicio: ${seg.start} · fin: ${seg.end} · duración: ${seg.end - seg.start}`;
    });
    cont.appendChild(div);
  });
}

function marcarGantt(t) {
  const segs = document.querySelectorAll('.gantt .seg');
  segs.forEach(s => s.classList.remove('selected'));
  // resaltar el segmento que contiene t
  const idx = state.gantt.findIndex(s => t >= s.start && t < s.end);
  if (idx >= 0 && segs[idx]) segs[idx].classList.add('selected');
}

/* ---------- Timer ---------- */
function detenerTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  state.ejecutando = false;
}

function avanzarUnPaso() {
  const next = state.pasoActual + 1;
  if (next >= state.timeline.length) { detenerTimer(); return false; }
  aplicarPaso(next);
  return true;
}

/* ---------- Botones ---------- */
$('btn-iniciar').addEventListener('click', () => {
  if (state.timeline.length === 0) {
    if (!prepararSimulacion()) return;
  }
  detenerTimer();
  state.ejecutando = true;
  state.timer = setInterval(() => {
    if (!avanzarUnPaso()) detenerTimer();
  }, state.velocidad);
});

$('btn-pausar').addEventListener('click', detenerTimer);

$('btn-paso').addEventListener('click', () => {
  if (state.timeline.length === 0) {
    if (!prepararSimulacion()) return;
  }
  avanzarUnPaso();
});

$('btn-atras').addEventListener('click', () => {
  if (state.pasoActual > 0) aplicarPaso(state.pasoActual - 1);
});

$('btn-completa').addEventListener('click', () => {
  if (state.timeline.length === 0) {
    if (!prepararSimulacion()) return;
  }
  detenerTimer();
  aplicarPaso(state.timeline.length - 1);
});

$('btn-reiniciar-sim').addEventListener('click', () => {
  reiniciarSimulacion();
  if (state.procesos.length) prepararSimulacion();
});

/* =========================================================
   5. COMPARACIÓN DE ALGORITMOS
   ========================================================= */
$('btn-comparar').addEventListener('click', () => {
  if (state.procesos.length === 0) { alert('Agrega procesos primero.'); return; }
  const q = Math.max(1, parseInt($('comp-quantum').value) || 4);
  const algos = ['FIFO', 'SJF', 'RR'];
  const tbody = $('tabla-comparacion');
  tbody.innerHTML = '';
  const resultados = [];

  algos.forEach(algo => {
    const copia = copiaProcesos();
    const { fin } = simular(copia, algo, q);
    const avgE = (copia.reduce((s,p) => s + p.espera, 0) / copia.length).toFixed(2);
    const avgR = (copia.reduce((s,p) => s + p.retorno, 0) / copia.length).toFixed(2);
    const avgRes = (copia.reduce((s,p) => s + p.respuesta, 0) / copia.length).toFixed(2);
    // cambios de contexto aproximados: contar segmentos en gantt sin idle
    const cambios = countCambios(algo, q);
    resultados.push({ algo, avgE, avgR, avgRes, cambios, fin });
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${algo}</strong></td>
      <td>${avgE}</td><td>${avgR}</td><td>${avgRes}</td>
      <td>${cambios}</td><td>${fin}</td>`;
    tbody.appendChild(tr);
  });

  renderChart(resultados);
});

function countCambios(algo, q) {
  const copia = copiaProcesos();
  const { gantt } = simular(copia, algo, q);
  const reales = gantt.filter(s => s.id !== 'IDLE');
  let cambios = 0;
  for (let i = 1; i < reales.length; i++) {
    if (reales[i].id !== reales[i-1].id) cambios++;
  }
  return cambios;
}

function renderChart(resultados) {
  const cont = $('chart-bars');
  cont.innerHTML = '';
  const max = Math.max(...resultados.map(r => parseFloat(r.avgE)), 1);
  const metricas = [
    { key: 'avgE', label: 'Espera' },
    { key: 'avgR', label: 'Retorno' },
    { key: 'avgRes', label: 'Respuesta' }
  ];
  metricas.forEach(m => {
    const group = document.createElement('div');
    group.className = 'bar-group';
    group.innerHTML = `<label>${m.label} promedio</label>`;
    resultados.forEach((r, i) => {
      const val = parseFloat(r[m.key]);
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${r.algo}</span>
        <div class="bar" style="width:${(val/max)*80}%;background:${COLORES[i]}"></div>
        <small class="muted">${val}</small>`;
      group.appendChild(row);
    });
    cont.appendChild(group);
  });
}

/* =========================================================
   6. CÓDIGO C++ DE REFERENCIA
   ========================================================= */
const CODE_BLOCKS = {
  estructura: {
    code: `// process.hpp
struct Proceso {
    std::string id;
    int llegada;
    int rafaga;
    int restante;
    int primerInicio = -1;
    int fin = -1;
    std::string estado = "nuevo"; // nuevo|listo|ejecutando|terminado
};

// Cálculo de métricas de un proceso terminado
void calcularMetricas(Proceso& p) {
    p.retorno   = p.fin - p.llegada;
    p.espera    = p.retorno - p.rafaga;
    p.respuesta = p.primerInicio - p.llegada;
}`,
    explain: `Este bloque define la estructura <code>Proceso</code> usada en todo el código C++. Contiene los mismos atributos que el simulador JavaScript. La función <code>calcularMetricas</code> aplica las fórmulas TR, TE y TRes. En un SO real, esta estructura equivaldría al PCB (Process Control Block).`
  },
  fifo: {
    code: `// FCFS no apropiativo
void fcfs(std::vector<Proceso>& procesos) {
    std::sort(procesos.begin(), procesos.end(),
        [](const Proceso& a, const Proceso& b) {
            return a.llegada < b.llegada ||
                  (a.llegada == b.llegada && a.id < b.id);
        });
    int t = 0;
    for (auto& p : procesos) {
        if (t < p.llegada) t = p.llegada;   // CPU idle
        p.primerInicio = t;
        t += p.rafaga;
        p.fin = t;
        calcularMetricas(p);
    }
}`,
    explain: `FIFO ordena por llegada y ejecuta en ese orden. Si el siguiente proceso aún no ha llegado, la CPU queda inactiva hasta <code>p.llegada</code>. Es no apropiativo: una vez asignada la CPU, el proceso termina.`
  },
  sjf: {
    code: `// SJF no apropiativo
void sjf(std::vector<Proceso>& procesos) {
    int t = 0, completados = 0, n = procesos.size();
    std::vector<bool> hecho(n, false);
    while (completados < n) {
        int idx = -1;
        for (int i = 0; i < n; i++) {
            if (hecho[i] || procesos[i].llegada > t) continue;
            if (idx == -1 || procesos[i].rafaga < procesos[idx].rafaga)
                idx = i;
        }
        if (idx == -1) { t++; continue; } // nadie listo
        auto& p = procesos[idx];
        p.primerInicio = t;
        t += p.rafaga;
        p.fin = t;
        calcularMetricas(p);
        hecho[idx] = true;
        completados++;
    }
}`,
    explain: `SJF recorre los procesos no ejecutados y elige el de menor ráfaga entre los que ya llegaron. Si nadie ha llegado, avanza el tiempo. Minimiza la espera promedio pero puede provocar inanición.`
  },
  rr: {
    code: `// Round Robin con quantum
void roundRobin(std::vector<Proceso>& procesos, int quantum) {
    std::queue<Proceso*> cola;
    int t = 0, completados = 0, n = procesos.size();
    std::vector<Proceso*> pendientes;
    for (auto& p : procesos) pendientes.push_back(&p);

    int idx = 0;
    while (completados < n) {
        // encolar llegadas
        while (idx < n && pendientes[idx]->llegada <= t) {
            cola.push(pendientes[idx++]);
        }
        if (cola.empty()) { t++; continue; }
        Proceso* p = cola.front(); cola.pop();
        if (p->primerInicio == -1) p->primerInicio = t;
        int ejec = std::min(quantum, p->restante);
        t += ejec;
        p->restante -= ejec;
        // llegadas durante la ejecución
        while (idx < n && pendientes[idx]->llegada <= t) {
            cola.push(pendientes[idx++]);
        }
        if (p->restante == 0) {
            p->fin = t;
            calcularMetricas(*p);
            completados++;
        } else {
            cola.push(p);
        }
    }
}`,
    explain: `Round Robin usa una cola circular. Cada proceso recibe <code>quantum</code> unidades. Las llegadas durante el quantum se encolan <strong>antes</strong> de reinsertar el proceso interrumpido. Si no termina, vuelve al final.`
  },
  metricas: {
    code: `// Cálculo de métricas y promedios
void imprimirMetricas(const std::vector<Proceso>& procesos) {
    double sRet = 0, sEsp = 0, sRes = 0;
    std::cout << "ID Llegada Rafaga Inicio Fin Retorno Espera Respuesta\\n";
    for (const auto& p : procesos) {
        std::cout << p.id << " " << p.llegada << " " << p.rafaga
                  << " " << p.primerInicio << " " << p.fin
                  << " " << p.retorno << " " << p.espera
                  << " " << p.respuesta << "\\n";
        sRet += p.retorno; sEsp += p.espera; sRes += p.respuesta;
    }
    int n = procesos.size();
    std::cout << "Promedios: Retorno=" << sRet/n
              << " Espera=" << sEsp/n
              << " Respuesta=" << sRes/n << "\\n";
}`,
    explain: `Este bloque calcula y muestra las métricas de cada proceso y sus promedios. Las fórmulas son TR=Fin−Llegada, TE=TR−Ráfaga, TRes=PrimerInicio−Llegada. Coinciden exactamente con las del simulador JS.`
  },
  hilos: {
    code: `#include <thread>
#include <mutex>
#include <condition_variable>

std::mutex mtx;
std::condition_variable cv;
bool cpuLibre = true;
std::string procesoEnCPU;

// Simula un proceso que espera su turno de CPU
void ejecutarProceso(Proceso& p) {
    std::unique_lock<std::mutex> lock(mtx);
    cv.wait(lock, [&]() { return cpuLibre; });
    cpuLibre = false;
    procesoEnCPU = p.id;
    p.primerInicio = (p.primerInicio == -1) ? 0 : p.primerInicio;
    // ... ejecutar quantum ...
    cpuLibre = true;
    procesoEnCPU = "";
    lock.unlock();
    cv.notify_all();
}

// Uso
std::vector<std::thread> hilos;
for (auto& p : procesos) hilos.emplace_back(ejecutarProceso, std::ref(p));
for (auto& h : hilos) h.join();`,
    explain: `<code>std::thread</code> crea hilos reales. <code>std::mutex</code> + <code>std::lock_guard</code> / <code>unique_lock</code> protegen la sección crítica. <code>std::condition_variable</code> permite esperar a que la CPU esté libre. <code>join()</code> espera a que terminen. <strong>Importante:</strong> crear un hilo por proceso no hace que el SO respete FIFO/SJF/RR; la coordinación debe ser explícita.`
  },
  main: {
    code: `int main() {
    std::vector<Proceso> procesos = {
        {"P1", 0, 8, 8},
        {"P2", 1, 4, 4},
        {"P3", 2, 9, 9},
        {"P4", 3, 5, 5}
    };

    std::cout << "=== FIFO ===\\n";
    auto a = procesos; fcfs(a); imprimirMetricas(a);

    std::cout << "\\n=== SJF ===\\n";
    auto b = procesos; sjf(b); imprimirMetricas(b);

    std::cout << "\\n=== Round Robin (q=4) ===\\n";
    auto c = procesos; roundRobin(c, 4); imprimirMetricas(c);
    return 0;
}`,
    explain: `La función <code>main()</code> carga el ejemplo académico y ejecuta los tres algoritmos. Permite validar que los resultados coinciden con los del simulador JS (FIFO: promedios Retorno=15.25, Espera=8.75, Respuesta=8.75).`
  }
};

function resaltarCodigo(step) {
  // Mapeo de acción -> tab de código
  const f = state.timeline[step];
  if (!f) return;
  let tab = 'estructura';
  if (f.cpu) tab = 'fifo'; // simplificado; en RR/SJF sería el correspondiente
  if (state.algoritmo === 'SJF') tab = 'sjf';
  if (state.algoritmo === 'RR') tab = 'rr';
  document.querySelectorAll('#code-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.code === tab));
  mostrarCodigo(tab);
}

function mostrarCodigo(key) {
  const block = CODE_BLOCKS[key];
  if (!block) return;
  $('code-view').textContent = block.code;
  $('code-explain-text').innerHTML = block.explain;
}

document.querySelectorAll('#code-tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#code-tabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    mostrarCodigo(tab.dataset.code);
  });
});

/* =========================================================
   7. INICIALIZACIÓN
   ========================================================= */
function init() {
  $('quantum-field').style.display = 'none';
  mostrarCodigo('estructura');
  renderProcesos();

  // Interceptar aplicarPaso para resaltar código
  const originalAplicar = aplicarPaso;
  // Sobrescribimos con wrapper
  window.aplicarPaso = function(idx) {
    originalAplicar(idx);
    resaltarCodigo(idx);
  };
  // Reasignar referencias
  aplicarPaso = window.aplicarPaso;
}

init();