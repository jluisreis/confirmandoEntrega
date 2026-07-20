/**
 * Backend em Google Apps Script para o Painel de Entregas - Nobre Lar
 *
 * Rota registrada no Roteador.gs como: ?acao=entregas
 *
 * Sub-operações internas via o parâmetro "action" (mantido como estava,
 * separado do "acao" do roteador para não quebrar o front existente):
 *
 *   Listar pedidos:
 *     ?acao=entregas&action=listar&secret=...&nivel=NORMAL
 *
 *   Confirmar entrega:
 *     ?acao=entregas&action=confirmar&secret=...&row=5&data=03/07/26&hora=14:30
 *     (data e hora são opcionais — se omitidos usa o momento atual)
 *
 * ⚠️  IMPORTANTE: sempre que alterar o código, crie uma NOVA implantação
 *    (não edite a existente) para que as mudanças entrem em vigor.
 *
 * Por que tudo via GET?
 * O browser bloqueia POST com JSON para domínios externos (CORS preflight).
 * O Apps Script não retorna os cabeçalhos CORS necessários para o preflight,
 * então o POST nunca chega ao doPost(). A solução é enviar tudo via GET
 * com query params — o Apps Script responde com CORS correto em doGet().
 */

const SHEET_NAME_ENTREGAS = 'Vendas/Faturamento/Entregas'; // nome da aba na planilha
const SHARED_SECRET       = 'CONFIRM_ENTREGA';              // igual ao VITE_APPS_SCRIPT_SECRET
const TIMEZONE_ENTREGAS   = 'America/Fortaleza';
const LOGISTICA_ENTREGA   = 'ENTREGA'; // único valor de LOGISTICA que deve aparecer no sistema
const COLUNA_DATA_PEDIDO  = 'DATA';    // coluna com a data do pedido
const DATA_CORTE_ENTREGAS = new Date(2026, 5, 1); // 01/06/2026 (mês é 0-indexado: 5 = junho)

// ─── helpers internos ────────────────────────────────────────────────────────

function _sheetEntregas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME_ENTREGAS) || ss.getSheets()[0];
}

function _headersEntregas(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn())
           .getValues()[0]
           .map(String);
}

function _colIndexEntregas(headers, name) {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error('Coluna não encontrada: ' + name);
  return idx + 1; // 1-based para getRange
}

function _jsonEntregas(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _formatValueEntregas(value, headerName) {
  if (value instanceof Date) {
    const fmt = headerName.indexOf('HORA') >= 0 ? 'HH:mm' : 'dd/MM/yy';
    return Utilities.formatDate(value, TIMEZONE_ENTREGAS, fmt);
  }
  return value;
}

// Converte o valor bruto da coluna DATA (Date do Sheets ou texto "dd/MM/yy"
// / "dd/MM/yyyy") em um objeto Date para permitir comparação com a data de
// corte. Retorna null se não for possível interpretar o valor.
function _paraDataEntregas(value) {
  if (value instanceof Date) return value;
  if (!value) return null;

  const str = String(value).trim();
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;

  let dia = Number(m[1]);
  let mes = Number(m[2]);
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;

  return new Date(ano, mes - 1, dia);
}

// ─── doGet_Entregas: chamado pelo Roteador.gs quando acao=entregas ──────────
// Renomeado de doGet -> doGet_Entregas para não colidir com os demais scripts
// do mesmo projeto (cada arquivo .gs compartilha o mesmo escopo global).
function doGet_Entregas(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    const secret = params.secret || '';
    const action = params.action || 'listar';

    // ── autenticação ──────────────────────────────────────────────────────
    if (secret !== SHARED_SECRET) {
      return _jsonEntregas({ ok: false, error: 'Não autorizado' });
    }

    // ── roteamento interno ───────────────────────────────────────────────
    if (action === 'listar') {
      return _listarEntregas(params);
    }

    if (action === 'confirmar') {
      return _confirmarEntrega(params);
    }

    return _jsonEntregas({ ok: false, error: 'Ação desconhecida: ' + action });

  } catch (err) {
    return _jsonEntregas({ ok: false, error: String(err) });
  }
}

// ─── listar pedidos ──────────────────────────────────────────────────────────
function _listarEntregas(params) {
  const sh      = _sheetEntregas();
  const values  = sh.getDataRange().getValues();
  const headers = values.shift().map(String);

  const nivelFiltro = params.nivel
    ? String(params.nivel).toUpperCase().trim()
    : null;

  const idxData = headers.indexOf(COLUNA_DATA_PEDIDO);

  const rows = values
    .map((r, i) => {
      const obj = { _row: i + 2 };
      headers.forEach((h, j) => {
        obj[h] = _formatValueEntregas(r[j], h);
      });
      // valor bruto da data, só para o filtro abaixo — removido antes de retornar
      obj._dataRaw = idxData >= 0 ? r[idxData] : null;
      return obj;
    })
    .filter(o => {
      if (!o['PEDIDO']) return false;

      // Só entra na listagem quem estiver EXATAMENTE como "ENTREGA" na
      // coluna LOGISTICA. Vazio ou qualquer outro valor (ex: "ENTREGUE",
      // "RETIRADA", etc.) é desconsiderado.
      const logistica = String(o['LOGISTICA'] || '').toUpperCase().trim();
      if (logistica !== LOGISTICA_ENTREGA) return false;

      if (nivelFiltro &&
          String(o['NIVEL ENTREGA']).toUpperCase().trim() !== nivelFiltro) {
        return false;
      }

      // Só pedidos feitos a partir de 01/06 (inclusive).
      const dataPedido = _paraDataEntregas(o._dataRaw);
      if (!dataPedido || dataPedido < DATA_CORTE_ENTREGAS) return false;

      return true;
    })
    .map(o => {
      delete o._dataRaw;
      return o;
    });

  return _jsonEntregas({ ok: true, rows: rows });
}

// ─── confirmar entrega ───────────────────────────────────────────────────────
function _confirmarEntrega(params) {
  const row = Number(params.row);
  if (!row || row < 2) {
    return _jsonEntregas({ ok: false, error: 'Linha inválida: ' + params.row });
  }

  const sh      = _sheetEntregas();
  const headers = _headersEntregas(sh);
  const colData      = _colIndexEntregas(headers, 'ENTREGUE DATA');
  const colHora      = _colIndexEntregas(headers, 'ENTREGUE HORA');
  const colLogistica = _colIndexEntregas(headers, 'LOGISTICA');

  const now  = new Date();
  const data = (params.data && String(params.data).trim())
    ? String(params.data).trim()
    : Utilities.formatDate(now, TIMEZONE_ENTREGAS, 'dd/MM/yy');
  const hora = (params.hora && String(params.hora).trim())
    ? String(params.hora).trim()
    : Utilities.formatDate(now, TIMEZONE_ENTREGAS, 'HH:mm');

  sh.getRange(row, colData).setValue(data);
  sh.getRange(row, colHora).setValue(hora);
  sh.getRange(row, colLogistica).setValue('ENTREGUE');

  return _jsonEntregas({ ok: true, row: row, data: data, hora: hora });
}
