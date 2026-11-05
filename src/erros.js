// Erros HTTP e tratamento centralizado (todas as respostas de erro em JSON).

export class ErroHttp extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

export function rotaNaoEncontrada(req, _res, next) {
  next(new ErroHttp(404, `rota não encontrada: ${req.method} ${req.path}`));
}

/** Converte erros conhecidos (body-parser, SQLite) em status adequados. */
function classificar(err) {
  if (err instanceof ErroHttp) return err;
  if (err.type === 'entity.too.large') return new ErroHttp(413, 'corpo da requisição excede o limite permitido');
  if (err.type === 'entity.parse.failed') return new ErroHttp(400, 'JSON malformado');
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') return new ErroHttp(415, 'codificação não suportada');
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return new ErroHttp(409, 'registro já existe');
  if (err.code === 'SQLITE_CONSTRAINT_CHECK') return new ErroHttp(400, 'valor fora do intervalo permitido');
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return new ErroHttp(422, 'referência inexistente');
  return null;
}

export function tratadorDeErros(err, req, res, _next) {
  const conhecido = classificar(err);
  if (!conhecido) console.error(err);
  if (res.headersSent) {
    // Falha no meio de um download em stream: só resta encerrar a conexão.
    res.destroy(err);
    return;
  }
  const status = conhecido?.status ?? 500;
  const corpo = { erro: conhecido?.message ?? 'erro interno do servidor' };
  if (conhecido?.detalhes) corpo.detalhes = conhecido.detalhes;
  if (status === 401) res.set('WWW-Authenticate', 'Bearer');
  res.status(status).json(corpo);
}
