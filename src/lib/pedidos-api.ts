/**
 * Integração com o backend em Google Apps Script (planilha do Google Sheets).
 *
 * Por que tudo via GET?
 * O navegador bloqueia POST com JSON para domínios externos (CORS preflight).
 * O Apps Script não retorna os cabeçalhos CORS necessários para o preflight,
 * então o POST nunca chegaria ao doPost(). A solução é enviar tudo via GET
 * com query params — o Apps Script responde com CORS correto em doGet().
 */

import {
  salvarCachePedidos,
  lerCachePedidos,
  enfileirarConfirmacao,
} from './offline-store'

export interface Pedido {
  _row: number;
  ID: string | number;
  "NIVEL ENTREGA": string;
  LOJA: string;
  PEDIDO: string | number;
  "VALOR DO PEDIDO": string | number;
  LOGISTICA: string;
  DATA: string;
  ENTRADA: string;
  VENDEDOR: string;
  TRANFERENCIA: string;
  FATURAMENTO: string;
  CIDADE: string;
  RESPONSAVEL: string;
  SAIDA: string;
  "ENTREGUE DATA": string;
  "ENTREGUE HORA": string;
  ENTREGA: string;
  [k: string]: unknown;
}

const SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined;
const SCRIPT_SECRET = import.meta.env.VITE_APPS_SCRIPT_SECRET as
  | string
  | undefined;

export function isConfigured() {
  return Boolean(SCRIPT_URL && SCRIPT_SECRET);
}

/** Monta a URL do Apps Script com query params — evita o problema de CORS do POST */
function buildUrl(params: Record<string, string | number>): string {
  if (!SCRIPT_URL) throw new Error("VITE_APPS_SCRIPT_URL não configurado");
  const qs = new URLSearchParams(
    Object.entries(params).reduce(
      (acc, [k, v]) => ({ ...acc, [k]: String(v) }),
      {} as Record<string, string>
    )
  ).toString();
  // usa "&" se a URL já tiver "?", senão usa "?" — evita URL quebrada
  const separator = SCRIPT_URL.includes("?") ? "&" : "?";
  return `${SCRIPT_URL}${separator}${qs}`;
}

export interface ListarOptions {
  /** Filtra por NIVEL ENTREGA (ex.: "NORMAL"). Omitido = traz todos. */
  nivel?: string;
}

export interface FetchPedidosResult {
  rows: Pedido[];
  fromCache: boolean;
  cacheAtualizadoEm?: string;
}

export async function fetchPedidos(
  options: ListarOptions = {}
): Promise<FetchPedidosResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET)
    throw new Error("Backend não configurado");

  // Sem conexão: nem tenta a rede, vai direto pro cache.
  if (!navigator.onLine) {
    const cache = lerCachePedidos();
    if (cache) {
      return { rows: cache.rows, fromCache: true, cacheAtualizadoEm: cache.atualizadoEm };
    }
    throw new Error("Sem conexão e nenhum dado salvo localmente ainda.");
  }

  const params: Record<string, string | number> = {
    action: "listar",
    secret: SCRIPT_SECRET,
  };
  if (options.nivel) params.nivel = options.nivel;

  try {
    const res = await fetch(buildUrl(params));
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Erro ao carregar pedidos");
    const rows = json.rows as Pedido[];
    salvarCachePedidos(rows); // atualiza o cache pra próxima vez que ficar offline
    return { rows, fromCache: false };
  } catch (err) {
    // Rede caiu no meio da requisição (ex.: wifi instável) — cai pro cache também.
    const cache = lerCachePedidos();
    if (cache) {
      return { rows: cache.rows, fromCache: true, cacheAtualizadoEm: cache.atualizadoEm };
    }
    throw err;
  }
}

export interface ConfirmarInput {
  row: number;
  data?: string; // dd/MM/yy — se omitido, servidor usa a data atual
  hora?: string; // HH:mm — se omitido, servidor usa a hora atual
  /** usados só para mostrar algo legível na fila de pendentes, se cair offline */
  pedidoLabel?: string;
  lojaLabel?: string;
}

export interface ConfirmarResult {
  ok: true;
  row: number;
  data: string;
  hora: string;
}

/** Resultado real (confirmado no Sheets) OU enfileirado (será enviado depois) */
export type ConfirmarOutcome =
  | { status: "ok"; result: ConfirmarResult }
  | { status: "queued" };

/** Faz a chamada de verdade ao Apps Script, sem nenhuma lógica de fila.
 *  Usado tanto pelo confirmarEntrega() quanto pelo sync-manager ao reenviar. */
export async function confirmarEntregaRemota(
  input: ConfirmarInput
): Promise<ConfirmarResult> {
  if (!SCRIPT_URL || !SCRIPT_SECRET)
    throw new Error("Backend não configurado");

  const params: Record<string, string | number> = {
    action: "confirmar",
    secret: SCRIPT_SECRET,
    row: input.row,
  };
  if (input.data) params.data = input.data;
  if (input.hora) params.hora = input.hora;

  const res = await fetch(buildUrl(params));
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Erro ao confirmar entrega");
  return json as ConfirmarResult;
}

/** Usado pela UI: tenta confirmar na hora; se estiver offline (ou a rede falhar),
 *  guarda a confirmação na fila local em vez de propagar o erro. */
export async function confirmarEntrega(
  input: ConfirmarInput
): Promise<ConfirmarOutcome> {
  if (!SCRIPT_URL || !SCRIPT_SECRET)
    throw new Error("Backend não configurado");

  if (!navigator.onLine) {
    enfileirarConfirmacao({
      row: input.row,
      data: input.data,
      hora: input.hora,
      pedidoLabel: input.pedidoLabel ?? String(input.row),
      lojaLabel: input.lojaLabel ?? "",
    });
    return { status: "queued" };
  }

  try {
    const result = await confirmarEntregaRemota(input);
    return { status: "ok", result };
  } catch (err) {
    // Se a chamada falhou por causa da rede (não por erro de negócio vindo do
    // backend), tratamos como offline e enfileiramos em vez de perder a ação.
    // "Failed to fetch" é o erro típico de TypeError quando a rede cai no meio.
    if (err instanceof TypeError || !navigator.onLine) {
      enfileirarConfirmacao({
        row: input.row,
        data: input.data,
        hora: input.hora,
        pedidoLabel: input.pedidoLabel ?? String(input.row),
        lojaLabel: input.lojaLabel ?? "",
      });
      return { status: "queued" };
    }
    throw err;
  }
}
