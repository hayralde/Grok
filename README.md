**Projeto:** grok · repo GitHub `hayralde/grok`


## Usuários

| Usuário | Senha padrão | Papel |
|---|---|---|
| admin | admin123 | Admin (todas as áreas) |
| supervisor | super123 | Supervisor (todas as áreas) |
| **supertgm** | **super123** | Supervisor **somente TGM** |
| operadores | 1234 | Só as próprias tarefas |

## Versionamento

Formato: `4.0.0.N` (N = 1…9). Depois de `4.0.0.9` sobe para `4.0.1.0`, depois `4.0.1.1` … `4.0.1.9` → `4.0.2.0`.

Versão atual deste pacote: **4.0.1.4**

Abas do painel: **Tarefas · Gantt · Curva S · Equipe**
(aba Linha do Tempo / Marcos removida).


## Projetos independentes (áreas)

Elétrica, Mecânica e TGM são **três projetos isolados**:

| | Elétrica | Mecânica | TGM |
|---|---|---|---|
| Dados | Só a área | Só a área | Só a área |
| Import | Não apaga as outras | idem | idem |
| Responsável padrão | PESSOA | PESSOA | EQUIPE |
| Sobreposição | Não | Não | Sim |
| Quem marca done | Operador / admin | Operador / admin | Admin / supervisor |

Regras ficam em `server/areaConfig.js`. Alterar TGM **não** muda Elétrica/Mecânica.
A interface é a mesma; o seletor no header escolhe o projeto ativo.

# Painel de Acompanhamento — Parada Programada (multi-usuário · multi-área)

Aplicação web com backend (Node.js + Express + Socket.io + PostgreSQL) para
acompanhamento em tempo real da parada programada, com **três programações
independentes** (Elétrica, Mecânica, TGM) e acesso público de leitura.


## técnicoTipo (v4.3) — pessoa vs equipe/turno

No JSON de cada tarefa:

```json
{ "tecnico": "1º TURNO", "tecnicoTipo": "EQUIPE", ... }
```

| tecnicoTipo | Sobreposição no mesmo rótulo | Login |
|---|---|---|
| omitido / `PESSOA` | **Rejeitada** na importação | Recomendado (operador) |
| `EQUIPE` | **Permitida** (turnos em paralelo) | Não — admin/supervisor marca done |

O gráfico **Horas por Responsável** agrupa pelo rótulo `tecnico` e credita Executado quando a tarefa está `done`, **sem** exigir usuário com esse nome.

## Mudanças principais (v4.1)

1. **Sem senha para visualizar** — ao abrir o site você já vê Gantt, Curva S e
   Equipe (visão de supervisor). Login é opcional:
   - **Operador**: marca suas atividades na aba Tarefas
   - **Admin**: importa cronograma e reseta progresso
2. **Três áreas independentes** — Elétrica, Mecânica e TGM coexistem no mesmo
   banco. Importar uma **não apaga** as outras. O arquivo JSON identifica a área
   com o campo `"area"`.

## Formato do JSON de importação

```json
{
  "area": "ELETRICA",
  "projectStart": "2026-08-03T07:30:00",
  "projectFinish": "2026-08-06T11:00:00",
  "sectorOrder": ["MOAGEM", "LIQUEFAÇÃO CIP", "DESTILARIA APARELHO C10"],
  "tasks": [
    {
      "id": 1,
      "setor": "DESTILARIA APARELHO C10",
      "tag": "BC-101A",
      "descricao": "ABRIR CAIXA DE LIGAÇÃO, FAZER REAPERTO...",
      "tecnico": "LUCAS",
      "inicio": "2026-08-03T07:30:00",
      "fim": "2026-08-03T09:00:00",
      "horas": 1.5
    }
  ]
}
```

### Valores válidos de `area`

| Valor no JSON | Aba no painel |
|---|---|
| `ELETRICA` | Elétrica |
| `MECANICA` | Mecânica |
| `TGM` | TGM |

Regras:
- `area` é **obrigatório** (se faltar, o admin pode confirmar uso da área atual).
- `id` precisa ser único **dentro daquela área** (o mesmo id pode existir em outra área).
- `inicio` e `fim` em ISO 8601 (`AAAA-MM-DDTHH:MM:SS`).
- `tecnico` deve bater com um operador cadastrado para ele ver a tarefa na aba Tarefas.
- `nome` é opcional — se não vier, o site monta `"{tag} - {descricao}"`.
- Importar **substitui só as tarefas daquela área**; as outras duas ficam intactas.
- Reset de progresso também é **por área** (a área ativa no seletor).

O `server/seed_data.json` continua sendo a carga inicial de **Elétrica** quando o
banco está vazio. Mecânica e TGM começam vazias até o primeiro import.

## Aba Custos (v4.0.2.2)

Nova aba **Custos**, visível a todos os perfis logados (operador, supervisor, admin
— visitante não vê), transversal às três áreas (Elétrica/Mecânica/TGM) — não é uma
"área" com escopo de login, é um painel consolidado de contratos/serviços de
terceiros da parada.

**Dados iniciais**: carregados a partir da planilha `Planilha_de_Custos.xlsx`
enviada (6 itens). A planilha não tinha uma coluna "Disciplina", então cada item
foi classificado a partir da atividade/escopo (ex.: disjuntores MT → Elétrica;
calibração de instrumentos → Instrumentação; revisão de turbina → TGM; andaime/
gesso acartonado → Civil). Ajuste pela interface (Editar) ou reimporte um JSON
corrigido a qualquer momento.

**O que o painel mostra:**
- Total por disciplina e por fornecedor (barras com % de participação).
- Total geral da parada + ticket médio + nº de fornecedores/itens.
- **Curva ABC**: itens ordenados por valor, classificados em A (até 80% do
  valor acumulado), B (até 95%) e C (restante) — mostra onde focar a negociação
  e o acompanhamento, já que poucos itens costumam concentrar a maior parte do custo.
- **Lista de pendências**: itens com status "Pendente"/"Em andamento", prazo
  vencido, ou com responsável/contato não informado — sinaliza itens de contrato/execução em aberto.
- Tabela completa filtrável por disciplina/status, com CRUD para admin.

**Campos de cada item de custo**: fornecedor, disciplina, atividade, escopo,
valor, data início/fim, responsável, contato, status
(Pendente/Em andamento/Concluído/Cancelado) e observação.

**Permissões**: exige login (operador, supervisor ou admin) — **visitante não vê a
aba Custos**. Criar/editar/excluir/importar/alterar status/ocultar é restrito ao
**admin**. **Ocultar** é um "outro panorama": o item some dos KPIs, Total por
disciplina/fornecedor, Curva ABC e pendências **para todo mundo, inclusive admin**
— como se aquele fornecedor não existisse nos totais. A única exceção é a lista
"Todos os Custos", onde o admin continua vendo o item (esmaecido, com selo
"Oculto") para poder reativá-lo quando quiser.

**Rotas da API:**
| Rota | Método | Quem | Descrição |
|---|---|---|---|
| `/api/custos` | GET | logado (qualquer papel) | Lista completa (ocultos só para admin) |
| `/api/custos/resumo` | GET | logado (qualquer papel) | KPIs, total por disciplina/fornecedor, Curva ABC, pendências |
| `/api/custos` | POST | admin | Cria item |
| `/api/custos/:id` | PUT | admin | Edita item (parcial) |
| `/api/custos/:id/status` | PATCH | admin | Atualiza só o status |
| `/api/custos/:id/ocultar` | PATCH | admin | Oculta/reexibe item — body `{ "oculto": true }` |
| `/api/custos/:id` | DELETE | admin | Exclui item |
| `/api/custos/import` | POST | admin | Substitui toda a lista — body `{ "items": [...] }` |

**Formato de importação (JSON):**
```json
{
  "items": [
    {
      "fornecedor": "Techenerg",
      "disciplina": "TGM",
      "atividade": "Revisão / Inspeção",
      "escopo": "Descrição do escopo...",
      "valor": 86892,
      "data_inicio": "2026-08-25",
      "data_fim": "2026-09-05",
      "responsavel": "Claudio Andrade",
      "contato": "(19) 99214-1524",
      "status": "PENDENTE",
      "observacao": ""
    }
  ]
}
```
`disciplina` aceita: `ELETRICA, MECANICA, TGM, INSTRUMENTACAO, CIVIL, OUTROS`.
`status` aceita: `PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO` (padrão: `PENDENTE`).

Toda alteração (criar/editar/excluir/importar/status) dispara o evento Socket.io
`custos-atualizado`, atualizando a aba em tempo real para todos os usuários conectados.

## Backup do banco (admin)

Botão "Backup do Banco" no cabeçalho (visível só para admin logado) → baixa um
arquivo `pcm_backup_<timestamp>.json` para a máquina local, com o dump completo
de todas as tabelas do schema (`users`, `tasks`, `meta`, `custos` — descobertas
dinamicamente, então continua funcionando se novas tabelas forem criadas no
futuro). Rota: `GET /api/admin/backup` (admin only).

⚠️ O arquivo inclui a tabela `users` com `password_hash` (hash bcrypt, não a
senha em texto puro) — trate o arquivo como sensível e guarde em local seguro.

Não depende do binário `pg_dump` (que normalmente não está disponível no
ambiente do Render) — a consulta e a montagem do JSON são feitas em JavaScript
puro via `pg`.

### Backup automático diário no Google Drive

Além do download manual, o servidor pode enviar sozinho, 1x por dia, um backup
para uma pasta do Google Drive — sem depender de ninguém clicar em nada.

⚠️ **Atualização importante:** a versão anterior deste recurso usava uma
*Service Account* do Google (conta "de robô") + pasta compartilhada como
Editor. Isso **não funciona mais** — desde 2023/2024 o Google deu cota 0GB
para Service Accounts e bloqueou esse workaround para contas Gmail pessoais
(erro `Service Accounts do not have storage quota`). As alternativas oficiais
do Google pra isso (Shared Drives / domain-wide delegation) só existem em
contas **Google Workspace pagas**, não em Gmail comum.

**Como funciona agora:** o admin conecta a própria conta Google pelo painel
(um clique, tela de login do Google, autorizar) — igual a "Entrar com Google"
em qualquer outro site. O app guarda essa autorização (um *refresh token*) no
banco de dados e reusa sozinho, indefinidamente, sem precisar logar de novo.
Os backups ficam na conta pessoal do admin, dentro da cota normal dela, numa
pasta chamada **"PCM Backups"** que o próprio app cria automaticamente na
primeira vez.

**Passo a passo (feito uma única vez, fora do código):**
1. Acesse [console.cloud.google.com](https://console.cloud.google.com), crie
   um projeto (ou use um existente).
2. Em "APIs e serviços" → "Biblioteca", ative a **Google Drive API**.
3. Em "APIs e serviços" → "Tela de consentimento OAuth": configure como
   **Externo**, preencha nome do app e e-mail de suporte — não precisa
   publicar nem passar por verificação do Google para uso pessoal/interno (só
   fica com um aviso "app não verificado" na hora de conectar, que é normal;
   clique em "Continuar"/"Avançado → Acessar (não seguro)" quando aparecer).
   Em "Usuários de teste", adicione o seu próprio e-mail do Google.
4. Em "APIs e serviços" → "Credenciais" → "Criar credenciais" → **ID do
   cliente OAuth**. Tipo de aplicativo: **Aplicativo da Web**.
5. Em "URIs de redirecionamento autorizados", adicione:
   `https://SEU-APP.onrender.com/api/admin/google-auth/callback`
   (troque pelo domínio real do seu serviço no Render).
6. Clique em "Criar". Copie o **Client ID** e o **Client Secret** mostrados.

**Variáveis de ambiente a configurar no Render** (Dashboard do serviço →
Environment):
| Variável | Valor |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID do passo 6 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Client Secret do passo 6 |
| `GOOGLE_DRIVE_FOLDER_ID` | *(opcional)* ID de uma pasta específica do Drive, se não quiser usar a pasta "PCM Backups" auto-criada |
| `BACKUP_HOURS_UTC` | *(opcional)* horários do backup automático, em UTC, separados por vírgula. Padrão: `0,6,12,18` (4x/dia, a cada 6h — ≈ 20h, 02h, 08h, 14h em Mato Grosso). Ex.: `0,4,8,12,16,20` para 6x/dia |

**Depois do redeploy com essas variáveis:**
7. Entre no painel como admin. No cabeçalho vai aparecer o botão **"Conectar
   Google Drive"**.
8. Clique nele — abre a tela de login do Google. Faça login com a conta que
   vai guardar os backups e autorize o acesso.
9. Você volta para uma página de confirmação ("Google Drive conectado com
   sucesso") — pode fechar e voltar ao painel.
10. O status no cabeçalho passa a mostrar "Google Drive conectado
    (seu-email@gmail.com)", e o botão **"Testar Backup no Drive"** aparece —
    use-o para confirmar que já está funcionando antes de contar com o
    agendamento diário.

Cada arquivo automático é salvo como `pcm_backup_auto_<data>_<hora>h.json`, um
por horário configurado (o servidor guarda o último "dia+horário" já enviado
na tabela `meta` para não duplicar se reiniciar mais de uma vez dentro do
mesmo horário). Não há limpeza automática de arquivos antigos na pasta — se
quiser, é possível configurar isso depois.
Um botão **"Desconectar Drive"** (admin) revoga a conexão a qualquer momento —
o backup manual continua funcionando, só o automático diário para até
reconectar.

## Estrutura

```
grok/
  server/
    index.js         API + Socket.io (rotas públicas de leitura + área)
    db.js            Postgres, migração multi-área, seed
    auth.js          JWT (obrigatório e opcional)
    seed_data.json   Atividades iniciais de Elétrica
  public/
    index.html
    app.js
    styles.css
  render.yaml
  package.json
  .env.example
```

## Deploy no Render

### Importante — isto é um app **Node.js**, não Python

Se o build falhar com `Could not open requirements.txt`, o serviço foi criado
como Python por engano. Corrija em **Settings** do Web Service:

| Campo | Valor correto |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Root Directory** | vazio se `package.json` estiver na raiz do repo; ou `grok` se o repo tiver a pasta `grok/` |

### Opção A — Blueprint (recomendado)

1. No GitHub, o `package.json` e o `render.yaml` devem estar **na raiz do repositório**
   (ou defina `rootDir: grok` no `render.yaml` se a pasta for essa).
2. Render → **New → Blueprint** → conecte o repo → **Apply**.
3. O Render cria sozinho o Postgres + o Web Service Node.

### Opção B — Manual

1. **New → PostgreSQL** (plano free). Copie a *Internal Database URL*.
2. **New → Web Service** → conecte o GitHub.
3. Configure:
   - Runtime: **Node**
   - Build: `npm install`
   - Start: `npm start`
4. Environment:
   - `DATABASE_URL` = Internal Database URL do passo 1
   - `JWT_SECRET` = qualquer string longa
   - `RESET_PASSWORD` = `654321`
   - `ADMIN_PASSWORD` = `admin123`
   - `SUPERVISOR_PASSWORD` = `super123`
   - `OPERATOR_PASSWORD` = `1234`
   - `NODE_ENV` = `production`

> Plano free: o serviço “dorme” sem uso e demora ~30s no primeiro acesso.

## Login (opcional)

| Perfil | Usuário | Senha padrão |
|---|---|---|
| Admin | `admin` | `admin123` |
| Supervisor | `supervisor` | `super123` |
| Operador | `adriel`, `carlos`, `dionatan`, `edson`, `jadson`, `leandro`, `lucas`, `marcio`, `nibson`, `valter`, `vandeley` | `1234` |

Senha do botão **Resetar Progresso**: `654321` (além de estar logado como admin).

## Regras por perfil

⚠️ **Login obrigatório desde a v4.4.0** — não existe mais modo "visitante"
(leitura sem login). Todo mundo precisa entrar com usuário/senha; sem isso, a
tela mostra só o login (`public/require-login.js`) e a API recusa qualquer
chamada de dados (`authRequired` em `/api/dashboard`, `/api/meta`,
`/api/tasks`, `/api/team`, `/api/custos*`).

| Quem | O que vê / faz |
|---|---|
| **Supervisor** | Gantt, Curva S, Equipe, Custos (leitura). |
| **Operador** | Só aba Tarefas, filtrada pelo seu técnico. Pode marcar done. |
| **Admin** | Todas as abas + Importar JSON + Resetar Progresso (por área) + Backup do banco. |

## Tempo real

Marcar atividade, reset e import disparam eventos Socket.io. Clientes na **mesma
área** atualizam sozinhos; eventos de outra área são ignorados no front.

## Migração de dados existentes

Na primeira subida com esta versão, o servidor:

1. Adiciona a coluna `area` nas tarefas existentes e marca tudo como `ELETRICA`.
2. Converte as chaves de meta (`projectStart` → `ELETRICA:projectStart`, etc.).
3. Cria stubs vazios de meta para Mecânica e TGM.

Não é necessário apagar o banco.
