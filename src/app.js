// Montagem da aplicação Express (sem listen: facilita os testes).
import express from 'express';
import { criarRepositorio } from './repositorio.js';
import { criarRotas } from './rotas.js';
import { rotaNaoEncontrada, tratadorDeErros } from './erros.js';

export function criarApp({ db, segredoJwt, limitadorLogin }) {
  if (typeof segredoJwt !== 'string' || segredoJwt.length < 32) {
    throw new Error('JWT_SEGREDO deve ter pelo menos 32 caracteres');
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/saude', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', criarRotas(criarRepositorio(db), { segredoJwt, limitadorLogin }));

  app.use(rotaNaoEncontrada);
  app.use(tratadorDeErros);
  return app;
}
