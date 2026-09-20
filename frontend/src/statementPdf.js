/**
 * Generador y descargador de Estado de Cuenta Oficial (PDF imprimible)
 * Para WTN Solutions LLC - WTN ALGO-TRADING (Binance)
 */
export async function downloadAccountStatementPdf(authFetch, user) {
  const resp = await authFetch('/api/investor/statement');
  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.message || 'Error al obtener datos del extracto.');
  }

  const { statement } = await resp.json();
  const p = statement.portfolio;
  const trades = statement.recent_trades || [];

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Por favor permite ventanas emergentes en tu navegador para generar el documento PDF.');
    return;
  }

  const isProfit = (p.net_pnl || 0) >= 0;
  const rowsHtml = (p.transactions || []).map(t => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px 12px; font-size: 12px;">${t.created_at || '-'}</td>
      <td style="padding: 8px 12px; font-size: 12px; font-weight: bold; color: ${t.transaction_type === 'WITHDRAWAL' ? '#e11d48' : '#059669'};">
        ${t.transaction_type === 'INITIAL' ? 'Aporte Inicial' : (t.transaction_type === 'DEPOSIT' ? 'Depósito Adicional' : 'Retiro')}
      </td>
      <td style="padding: 8px 12px; font-size: 12px; font-family: monospace; font-weight: bold; text-align: right;">
        $${Number(t.amount_usdt).toFixed(2)} USDT
      </td>
      <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">${t.notes || '-'}</td>
    </tr>
  `).join('');

  const tradesHtml = trades.slice(0, 15).map(tr => `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 6px 10px; font-size: 11px;">${tr.close_timestamp || tr.open_timestamp || '-'}</td>
      <td style="padding: 6px 10px; font-size: 11px; font-weight: bold;">${tr.symbol}</td>
      <td style="padding: 6px 10px; font-size: 11px;">${tr.trade_type}</td>
      <td style="padding: 6px 10px; font-size: 11px; font-family: monospace; text-align: right; font-weight: bold; color: ${(tr.pnl_usdt || 0) >= 0 ? '#059669' : '#e11d48'};">
        ${(tr.pnl_usdt || 0) >= 0 ? '+' : ''}${Number(tr.pnl_usdt || 0).toFixed(2)} USDT
      </td>
    </tr>
  `).join('');

  const accNum = p.account_number || user?.account_number || 'WTN-2026-0000';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Estado de Cuenta - ${user?.username || 'Inversionista'} - ${accNum}</title>
      <style>
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 40px; background: #fff; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f59e0b; padding-bottom: 20px; margin-bottom: 25px; }
        .logo { font-size: 22px; font-weight: 900; color: #0f172a; }
        .logo span { color: #f59e0b; }
        .sub-brand { font-size: 12px; font-weight: 700; color: #64748b; margin-top: 4px; }
        .badge { background: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .acc-tag { display: inline-block; background: #0f172a; color: #fbbf24; font-family: monospace; font-weight: bold; font-size: 12px; padding: 3px 8px; border-radius: 4px; margin-top: 6px; }
        .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; }
        .card-title { font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; margin-bottom: 6px; }
        .card-val { font-size: 20px; font-weight: 900; font-family: monospace; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: #475569; }
        .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.5; }
        .btn-print { background: #0f172a; color: #fff; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; border: none; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 20px; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>
      </div>

      <div class="header">
        <div>
          <div class="logo">⚡ WTN <span>ALGO-TRADING</span> (Binance)</div>
          <div class="sub-brand">WTN Solutions LLC • Quantitative Asset Management & Pool</div>
          <div class="acc-tag">N° CUENTA: ${accNum}</div>
        </div>
        <div style="text-align: right;">
          <div class="badge">Extracto Oficial Institucional</div>
          <div style="font-size: 12px; color: #64748b; margin-top: 6px;">Fecha de Emisión: ${statement.generated_at}</div>
          <div style="font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 2px;">Titular: ${user?.username}</div>
          <div style="font-size: 11px; color: #64748b;">${user?.email || ''}</div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-title">Capital Depositado</div>
          <div class="card-val" style="color: #0f172a;">$${Number(p.capital_invested).toFixed(2)} <span style="font-size: 12px;">USDT</span></div>
        </div>
        <div class="card">
          <div class="card-title">Valor Actual Estimado</div>
          <div class="card-val" style="color: #0284c7;">$${Number(p.current_value).toFixed(2)} <span style="font-size: 12px;">USDT</span></div>
        </div>
        <div class="card">
          <div class="card-title">Ganancia Neta ($)</div>
          <div class="card-val" style="color: ${isProfit ? '#059669' : '#e11d48'};">
            ${isProfit ? '+' : ''}$${Number(p.net_pnl).toFixed(2)}
          </div>
        </div>
        <div class="card">
          <div class="card-title">Retorno (ROI) / Cuota</div>
          <div class="card-val" style="color: ${isProfit ? '#059669' : '#e11d48'};">
            ${isProfit ? '+' : ''}${Number(p.roi_percentage).toFixed(2)}%
            <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 4px;">Participación: ${p.share_percentage}%</div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 30px;">
        <h3 style="font-size: 14px; text-transform: uppercase; color: #0f172a; margin-bottom: 10px; border-left: 3px solid #f59e0b; padding-left: 8px;">
          Historial de Movimientos de Capital
        </h3>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th style="text-align: right;">Monto</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">Sin movimientos registrados</td></tr>'}
          </tbody>
        </table>
      </div>

      <div style="margin-bottom: 30px;">
        <h3 style="font-size: 14px; text-transform: uppercase; color: #0f172a; margin-bottom: 10px; border-left: 3px solid #0284c7; padding-left: 8px;">
          Muestra de Últimas Operaciones Ejecutadas por el Bot (Pool)
        </h3>
        <table>
          <thead>
            <tr>
              <th>Fecha Cierre</th>
              <th>Par</th>
              <th>Tipo</th>
              <th style="text-align: right;">Resultado</th>
            </tr>
          </thead>
          <tbody>
            ${tradesHtml || '<tr><td colspan="4" style="text-align: center; padding: 15px; color: #94a3b8;">Sin operaciones recientes</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="footer">
        Documento emitido electrónicamente por <strong>WTN Solutions LLC</strong> — División WTN ALGO-TRADING (Binance).<br>
        Cifrado institucional de cuenta ${accNum} verificado en servidor central.<br>
        Los rendimientos pasados no garantizan rendimientos futuros. Operaciones de futuros sujetas a volatilidad de mercado.
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();
}
