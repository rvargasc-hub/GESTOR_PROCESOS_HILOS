// ============================================================
// scheduler.cpp — Implementación de referencia en C++17
// ProcessLab · Sistemas Operativos
//
// Este archivo NO se ejecuta en el navegador. Es la versión
// equivalente al motor JavaScript del simulador.
//
// Compilar:
//   g++ -std=c++17 -O2 -o scheduler scheduler.cpp
// Ejecutar:
//   ./scheduler
// ============================================================

#include <iostream>
#include <vector>
#include <queue>
#include <algorithm>
#include <string>
#include <thread>
#include <mutex>
#include <condition_variable>

// ------------------------------------------------------------
// Estructura Proceso (equivalente al PCB del SO)
// ------------------------------------------------------------
struct Proceso {
    std::string id;
    int llegada;
    int rafaga;
    int restante;
    int primerInicio = -1;
    int fin = -1;
    std::string estado = "nuevo";

    // Métricas
    int retorno = 0;
    int espera = 0;
    int respuesta = 0;
};

// ------------------------------------------------------------
// Cálculo de métricas
// TR = Fin - Llegada
// TE = TR - Ráfaga
// TRes = PrimerInicio - Llegada
// ------------------------------------------------------------
void calcularMetricas(Proceso& p) {
    p.retorno   = p.fin - p.llegada;
    p.espera    = p.retorno - p.rafaga;
    p.respuesta = p.primerInicio - p.llegada;
}

// ------------------------------------------------------------
// FIFO / FCFS (no apropiativo)
// ------------------------------------------------------------
void fcfs(std::vector<Proceso>& procesos) {
    std::sort(procesos.begin(), procesos.end(),
        [](const Proceso& a, const Proceso& b) {
            if (a.llegada != b.llegada) return a.llegada < b.llegada;
            return a.id < b.id;
        });
    int t = 0;
    for (auto& p : procesos) {
        if (t < p.llegada) t = p.llegada; // CPU idle
        p.primerInicio = t;
        t += p.rafaga;
        p.fin = t;
        calcularMetricas(p);
    }
}

// ------------------------------------------------------------
// SJF no apropiativo
// Empates: menor ráfaga → menor llegada → menor ID
// ------------------------------------------------------------
void sjf(std::vector<Proceso>& procesos) {
    int n = procesos.size();
    int t = 0, completados = 0;
    std::vector<bool> hecho(n, false);

    while (completados < n) {
        int idx = -1;
        for (int i = 0; i < n; i++) {
            if (hecho[i] || procesos[i].llegada > t) continue;
            if (idx == -1) { idx = i; continue; }
            const auto& a = procesos[i];
            const auto& b = procesos[idx];
            if (a.rafaga < b.rafaga ||
               (a.rafaga == b.rafaga && a.llegada < b.llegada) ||
               (a.rafaga == b.rafaga && a.llegada == b.llegada && a.id < b.id))
                idx = i;
        }
        if (idx == -1) { t++; continue; }

        auto& p = procesos[idx];
        p.primerInicio = t;
        t += p.rafaga;
        p.fin = t;
        calcularMetricas(p);
        hecho[idx] = true;
        completados++;
    }
}

// ------------------------------------------------------------
// Round Robin
// Criterio: las llegadas durante el quantum se encolan ANTES
// de reinsertar el proceso interrumpido.
// ------------------------------------------------------------
void roundRobin(std::vector<Proceso>& procesos, int quantum) {
    std::sort(procesos.begin(), procesos.end(),
        [](const Proceso& a, const Proceso& b) {
            if (a.llegada != b.llegada) return a.llegada < b.llegada;
            return a.id < b.id;
        });

    std::queue<int> cola;
    int n = procesos.size();
    int t = 0, completados = 0, idx = 0;

    while (completados < n) {
        // Encolar llegadas hasta t
        while (idx < n && procesos[idx].llegada <= t) {
            cola.push(idx++);
        }
        if (cola.empty()) { t++; continue; }

        int i = cola.front(); cola.pop();
        Proceso& p = procesos[i];

        if (p.primerInicio == -1) p.primerInicio = t;
        int ejec = std::min(quantum, p.restante);
        t += ejec;
        p.restante -= ejec;

        // Llegadas durante el quantum → se encolan primero
        while (idx < n && procesos[idx].llegada <= t) {
            cola.push(idx++);
        }

        if (p.restante == 0) {
            p.fin = t;
            calcularMetricas(p);
            completados++;
        } else {
            cola.push(i); // vuelve al final
        }
    }
}

// ------------------------------------------------------------
// Impresión de métricas
// ------------------------------------------------------------
void imprimirMetricas(const std::string& nombre,
                      const std::vector<Proceso>& procesos) {
    std::cout << "\n=== " << nombre << " ===\n";
    std::cout << "ID  Llegada Rafaga  Inicio  Fin   TR   TE   TRes\n";
    double sR = 0, sE = 0, sRes = 0;
    for (const auto& p : procesos) {
        std::cout << p.id << "   " << p.llegada << "       "
                  << p.rafaga << "       " << p.primerInicio << "    "
                  << p.fin << "    " << p.retorno << "    "
                  << p.espera << "    " << p.respuesta << "\n";
        sR += p.retorno; sE += p.espera; sRes += p.respuesta;
    }
    int n = procesos.size();
    std::cout << "Promedios → TR=" << sR / n
              << "  TE=" << sE / n
              << "  TRes=" << sRes / n << "\n";
}

// ------------------------------------------------------------
// Gestión de hilos con sincronización explícita
// (Demostración didáctica; NO se usa para el planificador)
// ------------------------------------------------------------
std::mutex mtx;
std::condition_variable cv;
bool cpuLibre = true;
std::string procesoEnCPU;

void ejecutarHiloProceso(Proceso& p) {
    std::unique_lock<std::mutex> lock(mtx);
    cv.wait(lock, [] { return cpuLibre; });
    cpuLibre = false;
    procesoEnCPU = p.id;

    // Aquí iría la ejecución lógica del quantum.
    // NO usamos sleep_for como sincronización principal.
    std::cout << "[hilo] Proceso " << p.id
              << " obtiene CPU (coordinación explícita).\n";

    cpuLibre = true;
    procesoEnCPU = "";
    lock.unlock();
    cv.notify_all();
}

// ------------------------------------------------------------
// main()
// ------------------------------------------------------------
int main() {
    std::vector<Proceso> base = {
        {"P1", 0, 8, 8},
        {"P2", 1, 4, 4},
        {"P3", 2, 9, 9},
        {"P4", 3, 5, 5}
    };

    auto a = base; fcfs(a);                imprimirMetricas("FIFO", a);
    auto b = base; sjf(b);                 imprimirMetricas("SJF", b);
    auto c = base; roundRobin(c, 4);       imprimirMetricas("Round Robin q=4", c);

    // Demostración de hilos C++ reales
    std::cout << "\n=== Hilos C++ (demostración de sincronización) ===\n";
    {
        std::vector<Proceso> procesos = base;
        std::vector<std::thread> hilos;
        for (auto& p : procesos) {
            hilos.emplace_back(ejecutarHiloProceso, std::ref(p));
        }
        for (auto& h : hilos) h.join();
    }

    std::cout << "\nNota: los resultados del planificador se calculan con"
                 " reloj lógico. La ejecución real de hilos la decide el SO.\n";
    return 0;
}