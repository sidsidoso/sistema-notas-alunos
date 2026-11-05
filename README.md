# Sistema de Notas de Alunos

[![CI](https://github.com/sidsidoso/sistema-notas-alunos/actions/workflows/ci.yml/badge.svg)](https://github.com/sidsidoso/sistema-notas-alunos/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/express-5-000000?logo=express&logoColor=white)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

API REST em **Express 5** para professores gerenciarem turmas, alunos, avaliações e notas. O login usa **JWT**
(senhas com `crypto.scrypt`), os dados ficam em **SQLite** (better-sqlite3) e a **média ponderada e a situação**
(aprovado / recuperação / reprovado) são calculadas **direto no SQL**. A API exporta o **boletim da turma em Excel**
(ExcelJS), o **boletim individual em PDF** (PDFKit) e importa alunos de uma **planilha** (SheetJS) enviada como
`application/octet-stream`.

## Tecnologias

| Tecnologia | Uso |
| --- | --- |
| [Node.js](https://nodejs.org/) ≥ 20 (ESM) | runtime, `node:crypto` (scrypt), `node:test` + `fetch` nativo |
| [Express 5](https://expressjs.com/) | rotas, `express.json` / `express.raw`, erros assíncronos repassados automaticamente |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite com statements preparados e transações |
| [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) | emissão e verificação de JWT HS256 |
| [ExcelJS](https://github.com/exceljs/exceljs) 4.4.0 | boletim da turma (.xlsx) gravado em stream |
| [PDFKit](https://pdfkit.org/) | boletim individual (.pdf) gravado em stream |
| [SheetJS](https://docs.sheetjs.com/) 0.20.3 | leitura da planilha de alunos (.xlsx/.xls/.csv) |

> **Nota sobre o SheetJS:** o pacote `xlsx` do registro do npm está parado na versão **0.18.5**, desatualizada e
> com vulnerabilidades conhecidas. As versões atuais são distribuídas pelo CDN oficial do SheetJS, por isso o
> `package.json` usa `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`. O `npm ci` instala
> normalmente e o `package-lock.json` guarda o hash de integridade.

## Arquitetura

```
                ┌─────────────────────────────── app.js ───────────────────────────────┐
  HTTP  ──────▶ │ x-powered-by off · headers de segurança · express.json({ limit 100kb })│
                │                                                                        │
                │  /api/auth/*  ───────────────────────────┐                             │
                │  /api/*  ──▶ autenticar (JWT, HS256) ────┤                             │
                │                                          ▼                             │
                │                                   rotas.js ── validacao.js             │
                │                     ┌──────────────────┼───────────────────┐           │
                │                     ▼                  ▼                   ▼           │
                │              importacao.js      repositorio.js       relatorios.js      │
                │              (SheetJS)          statements prontos   ExcelJS / PDFKit   │
                │                                 + transações              │ stream     │
                │                                        │                  ▼            │
                │                                        ▼              resposta HTTP    │
                │                                     SQLite                             │
                │  rotaNaoEncontrada → tratadorDeErros (JSON) ◀── qualquer erro           │
                └────────────────────────────────────────────────────────────────────────┘
```

- `src/app.js` monta a aplicação **sem `listen`** (testável); `src/server.js` lê o ambiente e sobe o servidor.
- `src/repositorio.js` prepara **todos** os statements uma única vez e expõe funções de dados.
- `src/importacao.js`, `src/validacao.js` e `src/seguranca.js` são módulos pequenos e testados isoladamente.

## Modelo de dados

```
professores 1───N turmas 1───N alunos
                     │            │
                     1            1
                     │            │
                     N            N
                 avaliacoes 1──N notas (aluno_id, avaliacao_id)  PK composta, WITHOUT ROWID
```

| Tabela | Campos principais | Restrições |
| --- | --- | --- |
| `professores` | `nome`, `email`, `senha_hash` | `email` único (sem diferenciar maiúsculas) |
| `turmas` | `nome`, `disciplina`, `ano`, `media_aprovacao` (7), `media_recuperacao` (5) | únicas por professor; `recuperacao ≤ aprovacao` |
| `alunos` | `matricula`, `nome`, `email` | `UNIQUE (turma_id, matricula)` |
| `avaliacoes` | `titulo`, `peso`, `data` | `peso` entre 0 e 100; título único na turma |
| `notas` | `valor`, `lancada_em` | `valor` entre 0 e 10; PK `(aluno_id, avaliacao_id)` |

Todas as chaves estrangeiras usam `ON DELETE CASCADE` (com `PRAGMA foreign_keys = ON`).

### Média ponderada e situação em SQL

```sql
WITH medias AS (
  SELECT a.id AS aluno_id, a.turma_id, a.matricula, a.nome,
         COUNT(av.id) AS avaliacoes, COUNT(n.valor) AS notas_lancadas,
         ROUND(SUM(COALESCE(n.valor, 0) * av.peso) / SUM(av.peso), 2) AS media
    FROM alunos a
    LEFT JOIN avaliacoes av ON av.turma_id = a.turma_id
    LEFT JOIN notas n ON n.aluno_id = a.id AND n.avaliacao_id = av.id
   WHERE a.turma_id = ?
   GROUP BY a.id
)
SELECT m.*, CASE
         WHEN m.media IS NULL THEN 'sem_avaliacoes'
         WHEN m.media >= t.media_aprovacao THEN 'aprovado'
         WHEN m.media >= t.media_recuperacao THEN 'recuperacao'
         ELSE 'reprovado'
       END AS situacao
  FROM medias m JOIN turmas t ON t.id = m.turma_id
 ORDER BY m.nome COLLATE NOCASE;
```

Regra: **avaliação sem nota lançada conta como zero**; a comparação é feita com a média já arredondada em 2 casas.

## Endpoints

Base: `http://localhost:3000/api`. Exceto `saude` e `auth/*`, todas exigem `Authorization: Bearer <token>`.

| Método | Rota | Descrição | Corpo |
| --- | --- | --- | --- |
| `GET` | `/saude` | verificação de vida | — |
| `POST` | `/auth/registro` | cadastra professor | `{ nome, email, senha (≥ 8) }` |
| `POST` | `/auth/login` | devolve JWT (8 h) | `{ email, senha }` |
| `GET` | `/turmas` | turmas do professor (com `total_alunos`) | — |
| `POST` | `/turmas` | cria turma | `{ nome, disciplina, ano, media_aprovacao?, media_recuperacao? }` |
| `GET` | `/turmas/:id` | detalhes da turma | — |
| `GET` | `/turmas/:id/alunos` | lista alunos | — |
| `POST` | `/turmas/:id/alunos` | cadastra aluno | `{ matricula, nome, email? }` |
| `POST` | `/turmas/:id/alunos/importar` | importa planilha (upsert por matrícula) | binário `.xlsx/.xls/.csv`, `Content-Type: application/octet-stream`, até 2 MB |
| `GET` | `/turmas/:id/avaliacoes` | lista avaliações | — |
| `POST` | `/turmas/:id/avaliacoes` | cria avaliação | `{ titulo, peso, data? (AAAA-MM-DD) }` |
| `PUT` | `/avaliacoes/:id/notas` | lança/atualiza notas em lote (atômico) | `{ notas: [{ aluno_id, valor }] }` (1–500) |
| `GET` | `/turmas/:id/medias` | médias ponderadas e situação | — |
| `GET` | `/turmas/:id/boletim.xlsx` | boletim da turma em Excel | — |
| `GET` | `/alunos/:id/boletim.pdf` | boletim individual em PDF | — |

Códigos de erro: `400` validação/JSON malformado · `401` token ausente/inválido · `404` recurso inexistente ou de
outro professor · `409` duplicidade · `413` corpo acima do limite · `415` tipo de conteúdo errado · `422` aluno de
outra turma · `429` excesso de tentativas de login · `500` erro interno. Sempre no formato `{ "erro": "mensagem" }`.

## Exemplos reais

Respostas obtidas rodando a API localmente (`npm start` com o `.env` de exemplo).

```console
$ curl -s -X POST localhost:3000/api/auth/registro -H "Content-Type: application/json" \
    -d '{"nome":"Profa. Helena Martins","email":"helena@escola.edu","senha":"senha-forte-123"}'
{"id":1,"nome":"Profa. Helena Martins","email":"helena@escola.edu"}

$ curl -s -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" \
    -d '{"email":"helena@escola.edu","senha":"senha-forte-123"}'
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub21lIjoiUHJvZmEuIEhlbGVuYSBN...","tipo":"Bearer","expira_em":"8h"}

$ TOKEN=eyJhbGciOiJIUzI1NiIs...
$ curl -s -X POST localhost:3000/api/turmas -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"nome":"3º A","disciplina":"Matemática","ano":2026}'
{"id":1,"professor_id":1,"nome":"3º A","disciplina":"Matemática","ano":2026,"media_aprovacao":7,"media_recuperacao":5}
```

**Importação de alunos** (a planilha é gerada por `npm run exemplo`, com 4 alunos válidos e 3 linhas com problema):

```console
$ curl -s -X POST localhost:3000/api/turmas/1/alunos/importar -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/octet-stream" --data-binary @saidas/alunos-exemplo.xlsx
{"inseridos":4,"atualizados":0,"rejeitados":[
  {"linha":6,"motivo":"matrícula ausente ou com mais de 30 caracteres"},
  {"linha":7,"motivo":"e-mail inválido: \"eduarda(arroba)exemplo.com\""},
  {"linha":8,"motivo":"matrícula 2026001 repetida na planilha"}]}
```

**Avaliações e notas em lote:**

```console
$ curl -s -X POST localhost:3000/api/turmas/1/avaliacoes -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"titulo":"Prova 1","peso":2,"data":"2026-04-10"}'
{"id":1,"turma_id":1,"titulo":"Prova 1","peso":2,"data":"2026-04-10"}

$ curl -s -X PUT localhost:3000/api/avaliacoes/1/notas -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"notas":[{"aluno_id":1,"valor":8.5},{"aluno_id":2,"valor":6},{"aluno_id":3,"valor":3},{"aluno_id":4,"valor":9}]}'
{"avaliacao_id":1,"lancadas":4}
```

**Médias** (Prova 1 peso 2, Trabalho peso 1, Prova 2 peso 3):

```console
$ curl -s localhost:3000/api/turmas/1/medias -H "Authorization: Bearer $TOKEN"
```

```json
{
  "turma": { "id": 1, "professor_id": 1, "nome": "3º A", "disciplina": "Matemática", "ano": 2026,
             "media_aprovacao": 7, "media_recuperacao": 5 },
  "alunos": [
    { "aluno_id": 1, "matricula": "2026001", "nome": "Ana Beatriz Souza", "avaliacoes": 3, "notas_lancadas": 3, "media": 8.25, "situacao": "aprovado" },
    { "aluno_id": 2, "matricula": "2026002", "nome": "Bruno Carvalho", "avaliacoes": 3, "notas_lancadas": 3, "media": 5.42, "situacao": "recuperacao" },
    { "aluno_id": 3, "matricula": "2026003", "nome": "Carla Mendes", "avaliacoes": 3, "notas_lancadas": 3, "media": 2.83, "situacao": "reprovado" },
    { "aluno_id": 4, "matricula": "2026004", "nome": "Diego Ramos", "avaliacoes": 3, "notas_lancadas": 3, "media": 7.33, "situacao": "aprovado" }
  ]
}
```

**Erros:**

```console
$ curl -s -i -X PUT localhost:3000/api/avaliacoes/1/notas -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"notas":[{"aluno_id":1,"valor":11}]}'
HTTP/1.1 400 Bad Request
X-Content-Type-Options: nosniff
Cache-Control: no-store
X-Frame-Options: DENY
Content-Type: application/json; charset=utf-8

{"erro":"\"notas[0].valor\" deve ser um número entre 0 e 10"}

$ curl -s localhost:3000/api/turmas
{"erro":"token ausente"}
```

**Boletins:**

```console
$ curl -s -D - -o boletim-turma.xlsx localhost:3000/api/turmas/1/boletim.xlsx -H "Authorization: Bearer $TOKEN"
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename=boletim-3-A-2026.xlsx

$ curl -s -D - -o boletim-aluno.pdf localhost:3000/api/alunos/1/boletim.pdf -H "Authorization: Bearer $TOKEN"
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename=boletim-2026001.pdf
```

Conteúdo do `.xlsx` gerado (aba **Boletim**, com cabeçalho fixo, autofiltro, formato `0.00` e situação colorida):

| Matrícula | Nome | Prova 1 (peso 2) | Trabalho (peso 1) | Prova 2 (peso 3) | Média | Situação |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 2026001 | Ana Beatriz Souza | 8,50 | 10,00 | 7,50 | 8,25 | Aprovado |
| 2026002 | Bruno Carvalho | 6,00 | 7,00 | 4,50 | 5,42 | Recuperação |
| 2026003 | Carla Mendes | 3,00 | 5,00 | 2,00 | 2,83 | Reprovado |
| 2026004 | Diego Ramos | 9,00 | 8,00 | 6,00 | 7,33 | Aprovado |

A aba **Resumo** traz: 4 alunos · 2 aprovados · 1 em recuperação · 1 reprovado · média da turma 5,96.
O PDF individual (A4) mostra cabeçalho com disciplina/turma/ano, dados do aluno, tabela de avaliações (peso, data,
nota ou "não lançada"), média ponderada, situação colorida e os critérios da turma.

## Decisões de implementação

**Segurança**
- Senhas com **`crypto.scrypt`** (N=16384, r=8, p=1, salt aleatório de 16 bytes); os parâmetros ficam junto ao hash
  (`scrypt$N$r$p$salt$hash`) para permitir evoluí-los. Comparação com `timingSafeEqual`.
- Login com e-mail inexistente também executa um scrypt: o tempo de resposta não revela quais e-mails existem, e a
  mensagem de erro é sempre a mesma.
- **JWT HS256 com algoritmo fixado** na verificação (`algorithms: ['HS256']`) e `issuer` conferido — tokens
  `alg: none`, HS512 ou assinados com outro segredo são recusados. Segredo via `JWT_SEGREDO` (mínimo 32 caracteres;
  a aplicação não sobe sem ele).
- **Limitador de tentativas** de login por IP (10 falhas em 15 min → `429`).
- Isolamento por professor: toda consulta filtra por `professor_id`; recursos de outro professor respondem `404`.
- `app.disable('x-powered-by')`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cache-Control: no-store`.
- **Limites de tamanho**: JSON até 100 kB; planilha até **2 MB** (`express.raw({ limit: '2mb' })`, sem multer) e
  até 2 000 linhas (`sheetRows` do SheetJS impede ler planilhas gigantes); lote de notas com até 500 itens.
- Validação explícita de todos os campos e parâmetros de rota; SQL sempre parametrizado; `CHECK` no banco como
  segunda barreira.
- Erros **centralizados em JSON** (`tratadorDeErros`): erros do body-parser e restrições do SQLite viram
  400/409/413/422; erros inesperados viram 500 sem vazar detalhes.

**Desempenho**
- Statements preparados **uma vez** na criação do repositório.
- Lançamento de notas e importação de alunos rodam em **uma transação**: rápidos e atômicos. Se um aluno do lote
  não pertence à turma, o `INSERT ... SELECT` não afeta linhas, a transação é desfeita e a API responde `422`.
- Upsert com `ON CONFLICT DO UPDATE` (notas e alunos importados).
- Média e situação calculadas pelo SQLite numa única consulta, sem laços N+1.
- `WITHOUT ROWID` na tabela `notas` (PK composta) e índices nas chaves estrangeiras; WAL em disco.
- Excel com **`ExcelJS.stream.xlsx.WorkbookWriter`** escrevendo direto na resposta, linha a linha (`commit()`), e PDF
  com `doc.pipe(res)` — nenhum arquivo temporário nem buffer completo em memória.

**Importação**
- O corpo bruto é detectado pela assinatura: ZIP (`PK`) ou OLE → .xlsx/.xls; caso contrário, CSV em UTF-8 (com
  remoção do BOM), lido com `raw: true` para não converter matrículas.
- Cabeçalhos aceitos: `Matrícula`/`RA`/`Registro`, `Nome`/`Aluno`, `E-mail` (sem diferenciar acentos/maiúsculas).

**Dependência transitiva:** a versão exigida do ExcelJS (4.4.0) depende de `uuid@8`, apontado pelo `npm audit`
(GHSA-w5hq-g745-h8pq, severidade moderada). O problema afeta apenas `v3/v5/v6` com `buf` informado; o ExcelJS usa
somente `uuid.v4()` sem buffer, então o caminho vulnerável não é exercido.

## Como instalar, rodar e testar

Pré-requisito: Node.js 20 ou superior.

**Linux / macOS**

```bash
git clone https://github.com/sidsidoso/sistema-notas-alunos.git
cd sistema-notas-alunos
npm ci
cp .env.example .env          # edite JWT_SEGREDO
npm run exemplo               # gera saidas/alunos-exemplo.xlsx
npm start                     # ou: npm run dev (reinicia ao salvar)
npm test
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/sidsidoso/sistema-notas-alunos.git
cd sistema-notas-alunos
npm ci
Copy-Item .env.example .env   # edite JWT_SEGREDO
npm run exemplo
npm start
npm test
```

No PowerShell, use `curl.exe` (e não o alias `curl`) para os exemplos acima; para JSON com acentos, prefira
`Invoke-RestMethod` ou grave o corpo em um arquivo e envie com `--data-binary "@corpo.json"`.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORTA` | `3000` | porta HTTP |
| `BANCO` | `notas.db` | arquivo SQLite |
| `JWT_SEGREDO` | — | **obrigatório**, ≥ 32 caracteres |

O `.env` é carregado com `process.loadEnvFile` (Node ≥ 20.12); em versões anteriores, exporte as variáveis no shell.

Saída dos testes:

```console
$ npm test
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
```

Os testes sobem a API na **porta 0** com banco **`:memory:`** e usam `fetch` nativo: autenticação (scrypt, JWT,
algoritmo fixado, expiração, limitador), validação, isolamento entre professores, atomicidade do lote de notas,
cálculo de médias, importação (.xlsx, .csv, 413, 415), o `.xlsx` reaberto com ExcelJS para conferir valores e o PDF
(`%PDF-` e contagem de páginas).

## Estrutura de pastas

```
sistema-notas-alunos/
├── .github/workflows/ci.yml   # CI: Node 20 e 22
├── scripts/
│   └── gerar-exemplo.js       # planilha de alunos para importação
├── src/
│   ├── server.js              # ambiente, listen e encerramento gracioso
│   ├── app.js                 # montagem do Express
│   ├── rotas.js               # endpoints
│   ├── repositorio.js         # statements preparados, transações, SQL de médias
│   ├── db.js                  # esquema SQLite
│   ├── seguranca.js           # scrypt, JWT, limitador de login
│   ├── validacao.js           # validadores de entrada
│   ├── importacao.js          # leitura da planilha (SheetJS)
│   ├── relatorios.js          # boletim Excel (ExcelJS) e PDF (PDFKit)
│   └── erros.js               # ErroHttp e tratador central
├── tests/
│   ├── auxiliar.js            # servidor na porta 0 + banco :memory:
│   ├── auth.test.js
│   ├── importacao.test.js
│   └── notas.test.js
├── .env.example
├── LICENSE
└── package.json
```

## Referências

- [Express 5 — guia de migração e tratamento de erros](https://expressjs.com/en/guide/migrating-5.html)
- [Express — `express.raw()`](https://expressjs.com/en/5x/api.html#express.raw)
- [Node.js — `crypto.scrypt`](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [OWASP — Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP — JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [better-sqlite3 — API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [ExcelJS — streaming XLSX writer](https://github.com/exceljs/exceljs#streaming-xlsx-writer)
- [PDFKit — documentação](https://pdfkit.org/docs/getting_started.html)
- [SheetJS — instalação no Node.js (CDN)](https://docs.sheetjs.com/docs/getting-started/installation/nodejs)

## Licença

[MIT](LICENSE) © 2026 sidsidoso
