import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Search,
  Package,
  TrendingUp,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
  X,
  WifiOff,
  UploadCloud,
} from 'lucide-react'
import {
  fetchPedidos,
  confirmarEntrega,
  isConfigured,
  type Pedido,
} from '../lib/pedidos-api'
import { iniciarAutoSync, onSyncChange, sincronizarFila } from '../lib/sync-manager'
import { listarPendentes, type ConfirmacaoPendente } from '../lib/offline-store'

// ─── helpers ─────────────────────────────────────────────────────────────

function nowDate(): string {
  const d = new Date()
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getFullYear()).slice(-2),
  ].join('/')
}

function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatCurrency(value: string | number | undefined): string {
  if (value === undefined || value === '') return 'R$ 0,00'
  const num =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace(/\./g, '').replace(',', '.'))
  if (isNaN(num)) return String(value)
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function isEntregue(p: Pedido): boolean {
  const logistica = String(p.LOGISTICA ?? '').toUpperCase().trim()
  return Boolean(
    p['ENTREGUE DATA'] ||
      p['ENTREGUE HORA'] ||
      logistica === 'ENTREGUE' ||
      logistica === 'RETIRADA'
  )
}

function iniciais(nome: string): string {
  return (nome || '?')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Converte "dd/MM/aa" ou "dd/MM/aaaa" (formato da planilha) em Date */
function parseDateBR(str: string | undefined): Date | null {
  if (!str) return null
  const parts = String(str).trim().split('/')
  if (parts.length !== 3) return null
  const [dd, mm, yyRaw] = parts
  const yyyy = yyRaw.length === 2 ? 2000 + Number(yyRaw) : Number(yyRaw)
  const d = new Date(yyyy, Number(mm) - 1, Number(dd))
  return isNaN(d.getTime()) ? null : d
}

/** Converte o valor de um <input type="date"> ("aaaa-MM-dd") em Date */
function parseInputDate(str: string): Date | null {
  if (!str) return null
  const [y, m, d] = str.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return isNaN(dt.getTime()) ? null : dt
}

export default function DataTable() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<number | null>(null)

  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage] = useState(8)
  const [searchTerm, setSearchTerm] = useState('')

  const [filtroDe, setFiltroDe] = useState('')
  const [filtroAte, setFiltroAte] = useState('')

  const [dialogPedido, setDialogPedido] = useState<Pedido | null>(null)
  const [modoManual, setModoManual] = useState(false)
  const [manualData, setManualData] = useState('')
  const [manualHora, setManualHora] = useState('')

  const [online, setOnline] = useState(navigator.onLine)
  const [usandoCache, setUsandoCache] = useState(false)
  const [cacheAtualizadoEm, setCacheAtualizadoEm] = useState<string | null>(null)
  const [filaPendente, setFilaPendente] = useState<ConfirmacaoPendente[]>([])
  const [sincronizando, setSincronizando] = useState(false)

  const atualizarPendentes = useCallback(() => {
    setFilaPendente(listarPendentes())
  }, [])

  // ── carregar pedidos (com fallback pro cache local se estiver offline) ─

  const carregarPedidos = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const { rows, fromCache, cacheAtualizadoEm } = await fetchPedidos()
      setPedidos(rows)
      setUsandoCache(fromCache)
      setCacheAtualizadoEm(cacheAtualizadoEm ?? null)
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregarPedidos()
  }, [carregarPedidos])

  // ── status online/offline do navegador ──────────────────────────────

  useEffect(() => {
    const atualizar = () => setOnline(navigator.onLine)
    window.addEventListener('online', atualizar)
    window.addEventListener('offline', atualizar)
    return () => {
      window.removeEventListener('online', atualizar)
      window.removeEventListener('offline', atualizar)
    }
  }, [])

  // ── auto-sync da fila de confirmações pendentes ─────────────────────

  useEffect(() => {
    atualizarPendentes()
    const pararAutoSync = iniciarAutoSync()
    const desinscrever = onSyncChange(() => {
      atualizarPendentes()
      carregarPedidos() // busca o estado real da planilha após sincronizar
    })
    return () => {
      pararAutoSync()
      desinscrever()
    }
  }, [carregarPedidos, atualizarPendentes])

  async function sincronizarAgora() {
    setSincronizando(true)
    try {
      await sincronizarFila()
      atualizarPendentes()
      await carregarPedidos()
    } finally {
      setSincronizando(false)
    }
  }

  // ── busca ────────────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    const termo = searchTerm.toLowerCase()
    const deDate = parseInputDate(filtroDe)
    const ateDate = parseInputDate(filtroAte)

    return [...pedidos]
      // mais recente primeiro: ordena por DATA desc, e por _row desc como
      // desempate (o último pedido acrescentado à planilha vem primeiro)
      .sort((a, b) => {
        const da = parseDateBR(a.DATA)
        const db = parseDateBR(b.DATA)
        if (!da && !db) return b._row - a._row
        if (!da) return 1
        if (!db) return -1
        if (da.getTime() !== db.getTime()) return db.getTime() - da.getTime()
        return b._row - a._row
      })
      .filter(
        (p) =>
          String(p.PEDIDO ?? '').toLowerCase().includes(termo) ||
          String(p.LOJA ?? '').toLowerCase().includes(termo) ||
          String(p.VENDEDOR ?? '').toLowerCase().includes(termo)
      )
      .filter((p) => {
        if (!deDate && !ateDate) return true
        const dp = parseDateBR(p.DATA)
        if (!dp) return true
        if (deDate && dp < deDate) return false
        if (ateDate && dp > ateDate) return false
        return true
      })
  }, [pedidos, searchTerm, filtroDe, filtroAte])

  const temFiltroData = Boolean(filtroDe || filtroAte)
  const pendentePorRow = useCallback(
    (row: number) => filaPendente.some((p) => p.row === row),
    [filaPendente]
  )

  const totalPages = Math.max(1, Math.ceil(filteredData.length / rowsPerPage))
  const startIndex = (currentPage - 1) * rowsPerPage
  const endIndex = startIndex + rowsPerPage
  const currentData = filteredData.slice(startIndex, endIndex)

  // 🔥 ALTERADO: os cards agora contam com base em filteredData (respeitam a
  // busca e o filtro de datas), não mais em todos os pedidos carregados.
  const entregues = filteredData.filter(isEntregue).length
  const pendentes = filteredData.length - entregues

  // ── confirmar entrega via GET (evita CORS do POST) ─────────────────

  async function executarConfirmacao(pedido: Pedido, data?: string, hora?: string) {
    setConfirmando(pedido._row)
    setDialogPedido(null)
    try {
      const outcome = await confirmarEntrega({
        row: pedido._row,
        data,
        hora,
        pedidoLabel: String(pedido.PEDIDO ?? pedido._row),
        lojaLabel: String(pedido.LOJA ?? ''),
      })

      if (outcome.status === 'ok') {
        // confirmado na hora, direto na planilha
        setPedidos((prev) =>
          prev.map((p) =>
            p._row === pedido._row
              ? {
                  ...p,
                  'ENTREGUE DATA': outcome.result.data,
                  'ENTREGUE HORA': outcome.result.hora,
                  LOGISTICA: 'ENTREGUE',
                }
              : p
          )
        )
      } else {
        // sem conexão: aplica localmente já (otimista) e deixa a fila cuidar
        // de mandar pro Sheets quando a internet voltar
        setPedidos((prev) =>
          prev.map((p) =>
            p._row === pedido._row
              ? {
                  ...p,
                  'ENTREGUE DATA': data || nowDate(),
                  'ENTREGUE HORA': hora || nowTime(),
                  LOGISTICA: 'ENTREGUE',
                }
              : p
          )
        )
        atualizarPendentes()
      }
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setConfirmando(null)
    }
  }

  function abrirConfirmacao(pedido: Pedido) {
    setDialogPedido(pedido)
    setModoManual(false)
    setManualData(nowDate())
    setManualHora(nowTime())
  }

  function confirmarDialogo() {
    if (!dialogPedido) return
    if (modoManual) {
      executarConfirmacao(dialogPedido, manualData, manualHora)
    } else {
      executarConfirmacao(dialogPedido)
    }
  }

  if (!isConfigured()) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/50 p-6 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Backend não configurado</p>
          <p>
            Defina <code className="font-mono">VITE_APPS_SCRIPT_URL</code> e{' '}
            <code className="font-mono">VITE_APPS_SCRIPT_SECRET</code> no arquivo{' '}
            <code className="font-mono">.env</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Total</span>
          </div>
          <p className="text-xl font-bold text-slate-800 dark:text-white">{filteredData.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Pendentes</span>
          </div>
          <p className="text-xl font-bold text-slate-800 dark:text-white">{pendentes}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">Entregues</span>
          </div>
          <p className="text-xl font-bold text-slate-800 dark:text-white">{entregues}</p>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar pedido, loja ou vendedor..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1)
            }}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
          />
        </div>
        <button
          onClick={carregarPedidos}
          disabled={loading}
          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          aria-label="Atualizar"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filtro por intervalo de datas */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">De</label>
          <input
            type="date"
            value={filtroDe}
            onChange={(e) => {
              setFiltroDe(e.target.value)
              setCurrentPage(1)
            }}
            className="w-40 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Até</label>
          <input
            type="date"
            value={filtroAte}
            onChange={(e) => {
              setFiltroAte(e.target.value)
              setCurrentPage(1)
            }}
            className="w-40 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all"
          />
        </div>
        {temFiltroData && (
          <button
            onClick={() => {
              setFiltroDe('')
              setFiltroAte('')
              setCurrentPage(1)
            }}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Limpar datas
          </button>
        )}
      </div>

      {/* Offline / usando cache local */}
      {!online && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900/50 p-3 text-sm text-amber-800 dark:text-amber-300">
          <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="flex-1">
            Você está offline
            {usandoCache && cacheAtualizadoEm && (
              <>
                {' '}
                — mostrando os últimos dados salvos (
                {new Date(cacheAtualizadoEm).toLocaleString('pt-BR')}).
              </>
            )}
            . Confirmações de entrega feitas agora serão enviadas automaticamente
            para a planilha assim que a conexão voltar.
          </p>
        </div>
      )}

      {/* Fila de confirmações aguardando sincronização */}
      {filaPendente.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-900/50 p-3 text-sm text-blue-800 dark:text-blue-300">
          <UploadCloud className="w-4 h-4 flex-shrink-0" />
          <p className="flex-1">
            {filaPendente.length}{' '}
            {filaPendente.length === 1
              ? 'confirmação de entrega aguardando'
              : 'confirmações de entrega aguardando'}{' '}
            sincronização com a planilha.
          </p>
          {online && (
            <button
              onClick={sincronizarAgora}
              disabled={sincronizando}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {sincronizando ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UploadCloud className="w-3.5 h-3.5" />
              )}
              Sincronizar agora
            </button>
          )}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900/50 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="flex-1">{erro}</p>
          <button onClick={() => setErro(null)} aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Carregando */}
      {loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Carregando pedidos…</span>
        </div>
      )}

      {/* Vazio */}
      {!loading && filteredData.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm">
          {searchTerm
            ? 'Nenhum pedido encontrado.'
            : temFiltroData
              ? 'Nenhum pedido no intervalo de datas selecionado.'
              : 'Nenhum pedido cadastrado.'}
        </div>
      )}

      {!loading && filteredData.length > 0 && (
        <>
          {/* Lista de cards (mobile) */}
          <div className="lg:hidden space-y-3">
            {currentData.map((row) => {
              const entregue = isEntregue(row)
              const emProgresso = confirmando === row._row
              return (
                <div
                  key={row._row}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                        {iniciais(String(row.LOJA ?? ''))}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">
                          {row.LOJA || '—'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {String(row.PEDIDO)}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-slate-800 dark:text-white">
                      {formatCurrency(row['VALOR DO PEDIDO'])}
                    </span>
                  </div>
                  <div>
                    {entregue && pendentePorRow(row._row) ? (
                      <span className="inline-flex items-center justify-center w-full gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                        <UploadCloud className="w-4 h-4" />
                        Entregue (sincronizando…)
                      </span>
                    ) : entregue ? (
                      <span className="inline-flex items-center justify-center w-full gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        Entregue
                      </span>
                    ) : (
                      <button
                        onClick={() => abrirConfirmacao(row)}
                        disabled={emProgresso}
                        className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
                      >
                        {emProgresso ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Confirmar entrega
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Tabela desktop */}
          <div className="hidden lg:block overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-colors duration-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-300">Pedido</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-300">Loja</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-300">Vendedor</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-300">Valor</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-300">Ações</th>
                </tr>
              </thead>
              <tbody>
                {currentData.map((row) => {
                  const entregue = isEntregue(row)
                  const emProgresso = confirmando === row._row
                  return (
                    <tr
                      key={row._row}
                      className="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {String(row.PEDIDO)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                            {iniciais(String(row.LOJA ?? ''))}
                          </div>
                          <span className="text-slate-800 dark:text-slate-200">{row.LOJA || '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.VENDEDOR || '—'}</td>
                      <td className="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">
                        {formatCurrency(row['VALOR DO PEDIDO'])}
                      </td>
                      <td className="px-4 py-3">
                        {entregue && pendentePorRow(row._row) ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            <UploadCloud className="w-3.5 h-3.5" />
                            Sincronizando…
                          </span>
                        ) : entregue ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Entregue
                          </span>
                        ) : (
                          <button
                            onClick={() => abrirConfirmacao(row)}
                            disabled={emProgresso}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                          >
                            {emProgresso ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Confirmar entrega
                              </>
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {startIndex + 1}-{Math.min(endIndex, filteredData.length)} de {filteredData.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </button>
              <span className="px-3 py-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Dialog de confirmação */}
      {dialogPedido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-white">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Confirmar Entrega
              </h3>
              <button
                onClick={() => setDialogPedido(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Pedido</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-white">
                  {String(dialogPedido.PEDIDO)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Loja</span>
                <span className="text-slate-800 dark:text-slate-200">{dialogPedido.LOJA || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Valor</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(dialogPedido['VALOR DO PEDIDO'])}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setModoManual(false)}
                className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-colors ${
                  !modoManual
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <Clock className="w-4 h-4 inline mr-1" />
                Hora do clique
              </button>
              <button
                type="button"
                onClick={() => setModoManual(true)}
                className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-colors ${
                  modoManual
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                Inserir manualmente
              </button>
            </div>

            {modoManual && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Data (dd/MM/aa)
                  </label>
                  <input
                    placeholder="03/07/26"
                    value={manualData}
                    onChange={(e) => setManualData(e.target.value)}
                    maxLength={8}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Hora (HH:mm)
                  </label>
                  <input
                    placeholder="14:30"
                    value={manualHora}
                    onChange={(e) => setManualHora(e.target.value)}
                    maxLength={5}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            )}

            {!modoManual && (
              <p className="text-xs text-slate-400 text-center">
                A data e hora exata do clique serão registradas automaticamente.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDialogPedido(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarDialogo}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}