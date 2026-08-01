**Projeto:** grok · repo GitHub `hayralde/grok`


## Usuários

| Usuário | Senha padrão | Papel |
|---|---|---|
| admin | admin123 | Admin (todas as áreas) |
| supervisor | super123 | Supervisor (todas as áreas) |
| **supertgm** | **super123** | Supervisor **somente TGM** |
| operadores | 1234 | Só as próprias tarefas |

## Versionamento

Formato: `4.0.0.N` (N = 1…9). Depois de `4.0.0.9` sobe para `4.0.1.0`.

Versão atual deste pacote: **4.0.0.6**

Abas do painel: **Tarefas · Gantt · Curva S · Equipe**
(aba Linha do Tempo / Marcos removida).


## Projetos independentes (v4.4)

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

| Quem | O que vê / faz |
|---|---|
| **Visitante** (sem login) | Gantt, Curva S, Equipe da área selecionada. Só leitura. |
| **Supervisor** | Igual ao visitante (Gantt, Curva S, Equipe). |
| **Operador** | Só aba Tarefas, filtrada pelo seu técnico. Pode marcar done. |
| **Admin** | Todas as abas + Importar JSON + Resetar Progresso (por área). |

## Tempo real

Marcar atividade, reset e import disparam eventos Socket.io. Clientes na **mesma
área** atualizam sozinhos; eventos de outra área são ignorados no front.

## Migração de dados existentes

Na primeira subida com esta versão, o servidor:

1. Adiciona a coluna `area` nas tarefas existentes e marca tudo como `ELETRICA`.
2. Converte as chaves de meta (`projectStart` → `ELETRICA:projectStart`, etc.).
3. Cria stubs vazios de meta para Mecânica e TGM.

Não é necessário apagar o banco.
