// Senhas com crypto.scrypt, emissão/verificação de JWT (HS256) e limitador de tentativas de login.
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { ErroHttp } from './erros.js';

const scrypt = promisify(scryptCb);
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const TAM_CHAVE = 64;
const EMISSOR = 'sistema-notas-alunos';

/** Formato: scrypt$N$r$p$salt(base64)$hash(base64) — parâmetros guardados junto ao hash. */
export async function gerarHashSenha(senha) {
  const salt = randomBytes(16);
  const hash = await scrypt(senha, salt, TAM_CHAVE, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verificarSenha(senha, armazenado) {
  const [alg, N, r, p, salt, hash] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(senha, Buffer.from(salt, 'base64'), esperado.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return timingSafeEqual(calculado, esperado);
}

// Hash "falso" usado quando o e-mail não existe: o tempo de resposta fica igual ao de uma senha errada.
let hashFicticio;
export async function verificarSenhaOuFingir(senha, armazenado) {
  if (armazenado) return verificarSenha(senha, armazenado);
  hashFicticio ??= await gerarHashSenha('senha-ficticia-para-tempo-constante');
  await verificarSenha(senha, hashFicticio);
  return false;
}

export function emitirToken(professor, segredo, expiraEm = '8h') {
  return jwt.sign({ nome: professor.nome }, segredo, {
    algorithm: 'HS256', expiresIn: expiraEm, subject: String(professor.id), issuer: EMISSOR,
  });
}

/** Middleware: exige "Authorization: Bearer <jwt>" e expõe req.professor = { id, nome }. */
export function autenticar(segredo) {
  return (req, _res, next) => {
    const [tipo, token] = (req.get('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) return next(new ErroHttp(401, 'token ausente'));
    try {
      // Algoritmo fixado: impede "alg: none" e troca de algoritmo.
      const dados = jwt.verify(token, segredo, { algorithms: ['HS256'], issuer: EMISSOR });
      req.professor = { id: Number(dados.sub), nome: dados.nome };
      next();
    } catch {
      next(new ErroHttp(401, 'token inválido ou expirado'));
    }
  };
}

/** Limita falhas de login por IP numa janela de tempo (memória do processo). */
export function criarLimitadorLogin({ maxFalhas = 10, janelaMs = 15 * 60 * 1000 } = {}) {
  const falhas = new Map();
  const limpar = (agora) => {
    for (const [ip, f] of falhas) if (f.expira <= agora) falhas.delete(ip);
  };
  return {
    verificar(ip) {
      const agora = Date.now();
      if (falhas.size > 10_000) limpar(agora);
      const f = falhas.get(ip);
      if (f && f.expira > agora && f.total >= maxFalhas) {
        throw new ErroHttp(429, 'muitas tentativas de login; tente novamente mais tarde');
      }
    },
    registrarFalha(ip) {
      const agora = Date.now();
      const f = falhas.get(ip);
      if (!f || f.expira <= agora) falhas.set(ip, { total: 1, expira: agora + janelaMs });
      else f.total++;
    },
    limpar: (ip) => falhas.delete(ip),
  };
}
