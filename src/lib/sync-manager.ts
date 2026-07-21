/**
 * Sincroniza a fila de confirmações offline com o Apps Script assim que
 * há conexão. É disparado:
 *   - quando o navegador emite o evento "online"
 *   - a cada X segundos como rede de segurança (o evento "online" nem
 *     sempre dispara de forma confiável, principalmente em mobile)
 *   - manualmente (ex.: usuário clica em "Atualizar")
 *
 * Evita rodar duas sincronizações ao mesmo tempo com uma trava simples.
 */

import { confirmarEntregaRemota } from './pedidos-api'
import {
  listarPendentes,
  removerDaFila,
  registrarFalha,
  type ConfirmacaoPendente,
} from './offline-store'

export interface SyncResult {
  sincronizados: ConfirmacaoPendente[]
  falharam: ConfirmacaoPendente[]
}

let sincronizando = false

export async function sincronizarFila(): Promise<SyncResult> {
  if (sincronizando || !navigator.onLine) {
    return { sincronizados: [], falharam: [] }
  }
  sincronizando = true

  const sincronizados: ConfirmacaoPendente[] = []
  const falharam: ConfirmacaoPendente[] = []

  try {
    const pendentes = listarPendentes()
    for (const item of pendentes) {
      try {
        await confirmarEntregaRemota({
          row: item.row,
          data: item.data,
          hora: item.hora,
        })
        removerDaFila(item.id)
        sincronizados.push(item)
      } catch (err) {
        registrarFalha(item.id, (err as Error).message)
        falharam.push(item)
        // se essa deu erro de negócio (não de rede), continua tentando as
        // próximas — cada pedido é independente. Só para tudo se a conexão
        // caiu de novo no meio do processo.
        if (!navigator.onLine) break
      }
    }
  } finally {
    sincronizando = false
  }

  return { sincronizados, falharam }
}

type Listener = () => void
const listeners = new Set<Listener>()

/** Assina notificações de "a fila mudou" (algo foi sincronizado ou falhou) */
export function onSyncChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notificar() {
  listeners.forEach((fn) => fn())
}

let intervalId: ReturnType<typeof setInterval> | null = null

/** Liga o auto-sync: escuta o evento "online" + tenta periodicamente.
 *  Chame uma vez (ex.: no useEffect do componente raiz da tabela). */
export function iniciarAutoSync(intervaloMs = 20000): () => void {
  const tentar = async () => {
    const { sincronizados, falharam } = await sincronizarFila()
    if (sincronizados.length > 0 || falharam.length > 0) notificar()
  }

  window.addEventListener('online', tentar)
  intervalId = setInterval(tentar, intervaloMs)
  // tenta uma vez já na inicialização, caso já esteja online com fila pendente
  tentar()

  return () => {
    window.removeEventListener('online', tentar)
    if (intervalId) clearInterval(intervalId)
  }
}
