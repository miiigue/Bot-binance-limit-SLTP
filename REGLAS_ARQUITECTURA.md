# Reglas de Arquitectura y Principio de Paridad Soberana

> **Documento Oficial de Reglas del Sistema (Trading Bot Binance Futures)**  
> **Fecha de Emisión:** Octubre 2026  
> **Estado:** OBLIGATORIO Y PERMANENTE (Mandato de Desarrollo)

---

## 1. Regla Suprema: Paridad Absoluta con el Bot del Administrador

1. **El Administrador es la única autoridad de configuración de estrategias:**  
   El administrador es quien diseña, prueba, calibra y parametriza las estrategias cuantitativas del sistema (indicadores RSI, marcos temporales, volumen, velas, Take Profit, Stop Loss, Trailing Stops, apalancamiento y tamaño de posición).

2. **Prohibición de invención de funciones para el usuario:**  
   Para la sesión de los usuarios está **estrictamente prohibido inventar cualquier función, concepto, filtro o restricción artificial** que no exista ya en la sesión del administrador.

3. **Inmutabilidad de las funciones existentes:**  
   **No se pueden modificar las funciones existentes** del bot del administrador para adaptarlas a caprichos o atajos. La arquitectura del administrador (`src/bot.py`, `src/binance_client.py`, `src/rsi_calculator.py`) es la fuente canónica de verdad operativa.

4. **El bot del usuario opera como el bot del administrador:**  
   La sesión del usuario debe ejecutar fielmente la estrategia seleccionada tal como la concibió el administrador, utilizando sus propias credenciales API de Binance de forma aislada, sin desviaciones lógicas ni matemáticas.

---

## 2. Definición Estricta de Margen, Multiplicador y Valor Nominal

En todo el sistema (tanto en el panel del administrador como en el del usuario), los términos financieros y operativos se rigen bajo la matemática estándar de Binance Futures:

### A. Margen por Orden (`position_size_usdt` / Margen USDT)
* Es el **colateral real en USDT** que se aporta y retiene en la cuenta de Binance para respaldar **cada orden individual**.
* **NO es un pozo global** que deba ser dividido o fraccionado entre un número arbitrario de operaciones.
* El usuario debe tener un **input explícito** para ingresar el margen que se utilizará en cada orden.

### B. Multiplicador de la Estrategia (`leverage` / Apalancamiento)
* Es el factor multiplicador definido en los parámetros de la estrategia por el administrador (ej: `5x`, `8x`, `10x`, etc.).

### C. Valor Nominal de la Posición (`Notional Value`)
* Es el tamaño total de la posición en el mercado, equivalente estrictamente al margen multiplicado por el apalancamiento:
  $$\text{Valor Nominal (Nocional)} = \text{Margen por Orden} \times \text{Multiplicador de la Estrategia}$$

### D. Cantidad de Contratos / Monedas (`Quantity`)
* Es la cantidad de unidades del activo a comprar o vender:
  $$\text{Cantidad} = \frac{\text{Valor Nominal}}{\text{Precio de Entrada}} = \frac{\text{Margen por Orden} \times \text{Multiplicador}}{\text{Precio de Entrada}}$$

---

## 3. Prohibición de Topes Artificiales de Posiciones ("Máximo de Posiciones")

1. **Eliminación de límites arbitrarios:**  
   En ninguna parte del sistema se deben imponer restricciones arbitrarias como "máximo 3 posiciones" a no ser que el administrador o el usuario lo hayan configurado y autorizado explícitamente.
2. **Criterio único de apertura de órdenes:**  
   El bot evaluará los símbolos asignados a la estrategia. Cuando un símbolo cumpla todas las condiciones técnicas y genere una señal de entrada válida, el bot abrirá la posición **siempre y cuando la cuenta de Binance del usuario cuente con saldo libre disponible suficiente para cubrir el Margen de la orden**:
   $$\text{Saldo Libre Disponible en Binance} \ge \text{Margen por Orden}$$
3. Si el saldo disponible en Binance es inferior al margen requerido, el bot registrará el aviso correspondiente y esperará a que se libere colateral cuando cierren otras posiciones, sin bloquear arbitrariamente el algoritmo.

---

## 4. Guía para Cualquier Desarrollador o Agente de IA

* **Cualquier cambio futuro que introduzca funciones no existentes en el bot del administrador será considerado una violación arquitectónica grave.**
* Toda nueva funcionalidad para usuarios debe derivar de una funcionalidad ya existente y validada en la consola del administrador.
* Todas las fórmulas de cálculo de órdenes deben mantener la equivalencia exacta:  
  `Margen = Input del Usuario`  
  `Nocional = Margen * Multiplicador`  
  `Cantidad = Nocional / Precio`
