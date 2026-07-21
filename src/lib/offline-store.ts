/**
 * Camada de persistência local (localStorage) que dá suporte ao modo offline.
 *
 * Duas responsabilidades:
 *  1. CACHE  — guarda a última lista de pedidos recebida do backend, para
 *              que a tela continue mostrando dados mesmo sem internet.
 *  2. FILA   — guarda confirmações de entrega feitas offline, para enviar
 *              ao Apps Script automaticamente quando a conexão voltar.
 *
 * Tudo fica em localStorage (síncrono, simples, e mais do que suficiente
 * para o volume de pedidos desse painel). Se um dia o volume crescer muito,
 * dá pra trocar por IndexedDB sem mexer no restante do app — só reescrever
 * este arquivo.
 */

import type { Pedido } from './pedidos-api'

const CACHE_KEY = 'pedidos:cache:v1'
const QUEUE_KEY = 'pedidos:queue:v1'

// ─── cache de pedidos (para leitura offline) ───────────────────────────────

interface PedidosCache {
  rows: Pedido[]
  atualizadoEm: string // ISO
}

export function salvarCachePedidos(rows: Pedido[]): void {
  try {
    const payload: PedidosCache = { rows, atualizadoEm: new Date().toISOString() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage cheio ou indisponível — não é crítico, apenas não terá cache
  }
}

export function lerCachePedidos(): PedidosCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PedidosCache
  } catch {
    return null
  }
}

// ─── fila de confirmações pendentes ────────────────────────────────────────

export interface ConfirmacaoPendente {
  id: string // id local único (não é o _row da planilha)
  row: number
  data?: string
  hora?: string
  // snapshot só para exibir na UI (pedido, loja) sem depender do array principal
  pedidoLabel: string
  lojaLabel: string
  criadoEm: string // ISO
  tentativas: number
  ultimoErro?: string
}

function lerFila(): ConfirmacaoPendente[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as ConfirmacaoPendente[]
  } catch {
    return []
  }
}

function salvarFila(fila: ConfirmacaoPendente[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(fila))
  } catch {
    // ignora — pior caso é perder a fila, mas não quebra o app
  }
}

export function listarPendentes(): ConfirmacaoPendente[] {
  return lerFila()
}

export function estaPendente(row: number): boolean {
  return lerFila().some((item) => item.row === row)
}

export function enfileirarConfirmacao(
  input: Omit<ConfirmacaoPendente, 'id' | 'criadoEm' | 'tentativas'>
): ConfirmacaoPendente {
  const fila = lerFila()
  const item: ConfirmacaoPendente = {
    ...input,
    id: `${input.row}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    criadoEm: new Date().toISOString(),
    tentativas: 0,
  }
  fila.push(item)
  salvarFila(fila)
  return item
}

export function removerDaFila(id: string): void {
  salvarFila(lerFila().filter((item) => item.id !== id))
}

export function registrarFalha(id: string, mensagem: string): void {
  const fila = lerFila()
  const item = fila.find((i) => i.id === id)
  if (item) {
    item.tentativas += 1
    item.ultimoErro = mensagem
    salvarFila(fila)
  }
}
