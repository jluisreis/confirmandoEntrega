# Apps Script - Painel de Entregas

Este é o backend (`Entregas.gs`) que roda dentro do Google Apps Script,
vinculado à planilha do Google Sheets. Ele fica versionado aqui só para
histórico/revisão — **colar este arquivo aqui não atualiza o Apps Script
sozinho**. Sincronização é manual ou via `clasp` (ver abaixo).

## Opção 1 — manual (mais simples, sem instalar nada)

1. Abra a planilha → Extensões → Apps Script.
2. Cole o conteúdo atualizado de `Entregas.gs` no arquivo correspondente.
3. Implantar → Gerenciar implantações → editar (ícone de lápis) →
   Nova versão → Implantar.
   ⚠️ Editar e salvar sem criar uma nova implantação NÃO atualiza a URL
   `/exec` que o front-end usa.

## Opção 2 — sincronizar de verdade com o Git (clasp)

O [`clasp`](https://github.com/google/clasp) é a CLI oficial do Google
para versionar projetos do Apps Script com Git.

```bash
npm install -g @google/clasp
clasp login
cd apps-script
clasp clone <SCRIPT_ID>   # pega o Script ID em Configurações do projeto no editor do Apps Script
```

Depois disso, o fluxo passa a ser:

```bash
clasp pull    # traz o que está publicado no Apps Script pro Git
# ...editar Entregas.gs normalmente, commitar, dar push...
clasp push    # envia o Git pro editor do Apps Script
```

`clasp push` ainda não cria uma implantação nova — depois de dar push,
é preciso rodar `clasp deploy` (ou fazer manualmente pelo editor) pra a
URL `/exec` realmente refletir a mudança.
