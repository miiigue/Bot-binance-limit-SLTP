# Reglas del Sistema (RULES.md)

Ver documento canónico completo: [REGLAS_ARQUITECTURA.md](file:///c:/Users/Nenas%20bellas/Desktop/Bot-binance-limit-SLTP/REGLAS_ARQUITECTURA.md).

## Resumen Ejecutivo de Reglas Inquebrantables:
1. **Paridad Total con el Bot del Administrador:**  
   El bot de usuario debe funcionar como el bot del administrador. Prohibido inventar funciones que no existan en la consola del administrador. Prohibido modificar las funciones existentes del administrador.
2. **Definición de Margen y Multiplicador:**  
   - El margen ingresado en el input es el margen real utilizado por cada orden (`order_margin`).
   - El multiplicador es el apalancamiento (`leverage`) de la estrategia configurada por el administrador.
   - El valor nominal (nocional) es: `Margen * Multiplicador`.
   - Cantidad: `(Margen * Multiplicador) / Precio`.
3. **Cero Topes Artificiales de Posiciones:**  
   Prohibido limitar artificialmente las posiciones (p. ej. "máximo 3 posiciones"). El bot abre posición ante cualquier señal válida siempre que `Saldo Disponible en Binance >= Margen`.
