import { db } from "./db.ts";
import { NEWSLETTERS, estaConfigurada, newsletterPorId } from "../../config/newsletters.ts";
import { PAGAS } from "../../config/pagas.ts";
import { corresponder, extrairEndereco, extrairNome, naoEEdicao } from "./correspondencia.ts";
import { reavaliarAfetados, reclassificar } from "./recolha.ts";
import {
  configuradaNoFicheiro,
  fundirTodas,
  marcasDe,
  marcasNoCorpo,
  partesDaMarca,
  regrasMudaram,
  type RegraGuardada,
} from "./regras-fusao.ts";
import { paraIso, ultimosDias } from "./tempo.ts";
import type { Newsletter } from "./tipos.ts";

/**
 * "Por classificar": o que o painel deixa a equipa fazer sem abrir código.
 *
 *   - atribuir um email por atribuir a uma newsletter → grava uma regra
 *     (endereço + marca no corpo) em `regras_newsletter`;
 *   - marcar um email como "não é newsletter" → grava uma exclusão (pelo
 *     assunto, ou só aquela mensagem), que o tira da lista;
 *   - desfazer qualquer das duas.
 *
 * Tudo valida do lado do servidor, deixa uma linha em `alteracoes` e, quando
 * mexe nas regras, reclassifica os emails guardados e reavalia os registos,
 * para o painel mudar logo. Nunca escreve no config/*.ts.
 */

export interface Resultado {
  ok: boolean;
  mensagem: string;
}

const falha = (mensagem: string): Resultado => ({ ok: false, mensagem });

/** Dias para trás em que, depois de uma mudança de regras, se reavaliam todos os registos da newsletter. */
const DIAS_REAVALIAR = 45;

function rotulo(n: Newsletter): string {
  return `${n.marca} · ${n.nome}`;
}

function quandoCurto(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
  return `${dia} ${hora}`;
}

/** Assunto como se compara nas exclusões: sem espaços a mais, sem maiúsculas. */
export function normalizarAssunto(assunto: string): string {
  return assunto.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function registar(acao: string, detalhe: string, quem: string | null): void {
  db()
    .prepare(`INSERT INTO alteracoes (em, quem, acao, detalhe) VALUES (?, ?, ?, ?)`)
    .run(new Date().toISOString(), quem, acao, detalhe);
}

export function lerRegras(): RegraGuardada[] {
  return db()
    .prepare(
      `SELECT id, newsletter_id AS newsletterId, remetente, marca_corpo AS marcaCorpo
         FROM regras_newsletter ORDER BY id`,
    )
    .all() as RegraGuardada[];
}

interface EmailGuardado {
  id: number;
  internet_message_id: string;
  remetente: string;
  assunto: string;
  recebido_em: string;
  corpo_html: string;
  newsletter_id: string | null;
}

function lerEmail(id: number): EmailGuardado | undefined {
  return db()
    .prepare(
      `SELECT id, internet_message_id, remetente, assunto, recebido_em, corpo_html, newsletter_id
         FROM emails WHERE id = ?`,
    )
    .get(id) as EmailGuardado | undefined;
}

const ENDERECO = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** A newsletter aceita emails deste endereço exato (ou do seu domínio, numa entrada "@…")? */
function aceitaEndereco(n: Newsletter, endereco: string): boolean {
  const entradas = [...n.remetentes, ...(n.alternativas ?? []).map((a) => a.remetente)];
  return entradas.some((e) => {
    const alvo = e.trim().toLowerCase();
    return alvo !== "" && (alvo.startsWith("@") ? endereco.endsWith(alvo) : endereco === alvo);
  });
}

/**
 * Depois de mudar as regras: reclassificar os emails guardados e reavaliar
 * os registos que mudaram, mais todos os da newsletter nos últimos dias (a
 * prova de ausência depende de ela estar configurada).
 */
function reavaliarDepoisDeMudar(newsletterId: string): void {
  const afetados = reclassificar();
  const desde = ultimosDias(DIAS_REAVALIAR)[0];
  const linhas = db()
    .prepare(`SELECT data_prevista FROM registos WHERE newsletter_id = ? AND data_prevista >= ?`)
    .all(newsletterId, desde) as { data_prevista: string }[];
  for (const l of linhas) afetados.add(`${newsletterId}|${l.data_prevista}`);
  reavaliarAfetados(afetados);
}

function contarDe(newsletterId: string): number {
  return (
    db().prepare(`SELECT COUNT(*) AS n FROM emails WHERE newsletter_id = ?`).get(newsletterId) as {
      n: number;
    }
  ).n;
}

/**
 * Atribui um email por atribuir a uma newsletter: grava a regra "endereço do
 * email + marca no corpo escolhida". Recusa se a regra fizesse algum email
 * guardado servir a duas newsletters.
 */
export function atribuir(
  emailId: number,
  newsletterId: string,
  marca: string,
  quem: string | null = null,
): Resultado {
  const n = newsletterPorId(newsletterId);
  if (!n) return falha("Newsletter desconhecida.");

  const email = lerEmail(emailId);
  if (!email) return falha("Email não encontrado.");
  if (email.newsletter_id) {
    const atual = newsletterPorId(email.newsletter_id);
    return falha(`Este email já conta para ${atual ? rotulo(atual) : email.newsletter_id}.`);
  }
  if (naoEEdicao(email.assunto)) {
    return falha("O assunto deste email é de boas-vindas ou promoção: nunca conta como edição.");
  }

  const marcaPedida = marca.trim().toUpperCase();
  const marcas = marcasNoCorpo(email.corpo_html);
  if (!marcas.includes(marcaPedida)) {
    return falha(
      marcas.length === 0
        ? "Este email não tem bloco de publicidade de newsletter: não há como o reconhecer com segurança."
        : "A marca escolhida não está neste email.",
    );
  }

  const endereco = extrairEndereco(email.remetente);
  if (!ENDERECO.test(endereco)) return falha("O endereço do remetente não é válido.");

  // A configuração atual já o reconhece (mudou depois da última leitura):
  // não é precisa regra nenhuma, só reclassificar.
  const atual = corresponder(email.remetente, email.assunto, email.corpo_html);
  if (atual) {
    reavaliarDepoisDeMudar(atual.id);
    return atual.id === n.id
      ? { ok: true, mensagem: `Já era reconhecido como ${rotulo(n)}. Atualizado, sem regra nova.` }
      : falha(`Este email já é reconhecido como ${rotulo(atual)}. Atualizado; nada foi guardado.`);
  }

  // A marca já identifica outra newsletter: atribuí-la aqui seria um engano.
  const dona = NEWSLETTERS.find(
    (o) => o.id !== n.id && marcasDe(o).some((m) => m.toUpperCase() === marcaPedida),
  );
  if (dona) return falha(`Esta marca já identifica ${rotulo(dona)}. Escolha essa newsletter.`);

  const regras = lerRegras();
  if (
    regras.some(
      (r) =>
        r.newsletterId === n.id &&
        r.remetente.toLowerCase() === endereco &&
        r.marcaCorpo.toUpperCase() === marcaPedida,
    )
  ) {
    return falha("Esta regra já existe.");
  }

  // Simulação: a configuração como ficaria, contra todos os emails guardados
  // deste endereço (só esses podem mudar — a regra exige o endereço exato).
  const nova: RegraGuardada = {
    id: Number.MAX_SAFE_INTEGER,
    newsletterId: n.id,
    remetente: endereco,
    marcaCorpo: marcaPedida,
  };
  const proposta = fundirTodas([...regras, nova]);
  const alvo = proposta.find((p) => p.id === n.id)!;
  if (!corresponder(email.remetente, email.assunto, email.corpo_html, [alvo])) {
    return falha("A regra não reconhece este email. Nada foi guardado.");
  }

  const doEndereco = proposta.filter((p) => aceitaEndereco(p, endereco));
  const emails = (
    db()
      .prepare(
        `SELECT id, remetente, assunto, recebido_em, corpo_html FROM emails
          WHERE instr(lower(remetente), ?) > 0`,
      )
      .all(endereco) as Pick<EmailGuardado, "id" | "remetente" | "assunto" | "recebido_em" | "corpo_html">[]
  ).filter((e) => extrairEndereco(e.remetente) === endereco);

  for (const e of emails) {
    const servem = doEndereco.filter((p) => corresponder(e.remetente, e.assunto, e.corpo_html, [p]));
    if (servem.length >= 2 && servem.some((p) => p.id === n.id)) {
      const outra = servem.find((p) => p.id !== n.id)!;
      return falha(
        `Não guardado: o email «${e.assunto}» de ${quandoCurto(e.recebido_em)} passaria a contar ` +
          `para ${rotulo(n)} e também para ${rotulo(outra)}. Um email não pode contar para duas newsletters.`,
      );
    }
  }

  const antes = contarDe(n.id);
  const bd = db();
  try {
    bd.transaction(() => {
      bd.prepare(
        `INSERT INTO regras_newsletter (newsletter_id, remetente, marca_corpo, criado_em)
         VALUES (?, ?, ?, ?)`,
      ).run(n.id, endereco, marcaPedida, new Date().toISOString());
      registar(
        "Regra acrescentada",
        `${rotulo(n)}: ${endereco} + ${marcaPedida} (a partir do email «${email.assunto}» de ${quandoCurto(email.recebido_em)})`,
        quem,
      );
      regrasMudaram();
      reavaliarDepoisDeMudar(n.id);
    })();
  } finally {
    // Se a transação falhou, a configuração em memória volta a ler a base.
    regrasMudaram();
  }

  const ganhos = contarDe(n.id) - antes;
  return {
    ok: true,
    mensagem:
      `Guardado. ${rotulo(n)} passa a reconhecer os emails de ${endereco} com esta marca` +
      (ganhos > 0 ? ` — ${ganhos === 1 ? "1 email passou" : `${ganhos} emails passaram`} a contar.` : "."),
  };
}

/** Apaga uma regra do painel. O que vem do ficheiro fica como estava. */
export function removerRegra(id: number, quem: string | null = null): Resultado {
  const regra = lerRegras().find((r) => r.id === id);
  if (!regra) return falha("Regra não encontrada.");
  const n = newsletterPorId(regra.newsletterId);
  const bd = db();
  const antes = contarDe(regra.newsletterId);
  try {
    bd.transaction(() => {
      bd.prepare(`DELETE FROM regras_newsletter WHERE id = ?`).run(id);
      registar(
        "Regra removida",
        `${n ? rotulo(n) : regra.newsletterId}: ${regra.remetente} + ${regra.marcaCorpo}`,
        quem,
      );
      regrasMudaram();
      reavaliarDepoisDeMudar(regra.newsletterId);
    })();
  } finally {
    regrasMudaram();
  }
  const perdidos = antes - contarDe(regra.newsletterId);
  return {
    ok: true,
    mensagem:
      "Regra removida." +
      (perdidos > 0
        ? ` ${perdidos === 1 ? "1 email deixou" : `${perdidos} emails deixaram`} de contar para ${n ? rotulo(n) : regra.newsletterId}.`
        : ""),
  };
}

export type TipoExclusao = "assunto" | "mensagem";

/** Marca um email como "não é newsletter": sai da lista "por classificar". Não mexe em estados. */
export function excluir(emailId: number, tipo: TipoExclusao, quem: string | null = null): Resultado {
  if (tipo !== "assunto" && tipo !== "mensagem") return falha("Tipo de exclusão inválido.");
  const email = lerEmail(emailId);
  if (!email) return falha("Email não encontrado.");
  if (email.newsletter_id) return falha("Este email já conta para uma newsletter.");

  const valor = tipo === "assunto" ? normalizarAssunto(email.assunto) : email.internet_message_id;
  if (!valor) return falha("Este email não tem assunto: use «Ignorar só este».");
  const remetente = extrairNome(email.remetente) || extrairEndereco(email.remetente);
  const descricao = `«${email.assunto}» (${remetente}, ${quandoCurto(email.recebido_em)})`;

  const res = db()
    .prepare(
      `INSERT OR IGNORE INTO exclusoes (tipo, valor, rotulo, criado_em) VALUES (?, ?, ?, ?)`,
    )
    .run(tipo, valor, tipo === "assunto" ? email.assunto.trim() : descricao, new Date().toISOString());
  if (res.changes === 0) return falha("Já estava marcado como não sendo newsletter.");

  registar(
    tipo === "assunto" ? "Assunto ignorado" : "Email ignorado",
    tipo === "assunto" ? `Assunto ${descricao}` : descricao,
    quem,
  );
  return {
    ok: true,
    mensagem:
      tipo === "assunto"
        ? "Feito. Os emails com este assunto deixam de aparecer aqui."
        : "Feito. Este email deixa de aparecer aqui.",
  };
}

export function removerExclusao(id: number, quem: string | null = null): Resultado {
  const linha = db().prepare(`SELECT tipo, rotulo FROM exclusoes WHERE id = ?`).get(id) as
    | { tipo: TipoExclusao; rotulo: string }
    | undefined;
  if (!linha) return falha("Não encontrado.");
  db().prepare(`DELETE FROM exclusoes WHERE id = ?`).run(id);
  registar(
    linha.tipo === "assunto" ? "Assunto volta a contar" : "Email volta a contar",
    linha.tipo === "assunto" ? `Assunto «${linha.rotulo}»` : linha.rotulo,
    quem,
  );
  return { ok: true, mensagem: "Feito. Volta a aparecer na lista se estiver por atribuir." };
}

// ── Leituras para a página ─────────────────────────────────────────────────

export interface EmailPorClassificar {
  id: number;
  remetente: string;
  nome: string;
  endereco: string;
  assunto: string;
  recebidoEm: string;
  marcas: string[];
  /** A newsletter que a marca sugere, para vir pré-escolhida. Só sugestão. */
  sugestao: string | null;
}

function exclusoesAtivas(): { assuntos: Set<string>; mensagens: Set<string> } {
  const linhas = db().prepare(`SELECT tipo, valor FROM exclusoes`).all() as {
    tipo: TipoExclusao;
    valor: string;
  }[];
  return {
    assuntos: new Set(linhas.filter((l) => l.tipo === "assunto").map((l) => l.valor)),
    mensagens: new Set(linhas.filter((l) => l.tipo === "mensagem").map((l) => l.valor)),
  };
}

/** Letras e algarismos, sem acentos, em maiúsculas: "Finanças" → "FINANCAS". */
function simples(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Que newsletter a marca sugere: a que já a tem (no ficheiro, mas sem
 * endereço), ou a única cujo nome coincide com o da marca (e da mesma marca).
 */
function sugerir(marcas: string[]): string | null {
  for (const m of marcas) {
    const dona = NEWSLETTERS.find((n) => marcasDe(n).some((x) => x.toUpperCase() === m));
    if (dona) return dona.id;
  }
  for (const m of marcas) {
    const partes = partesDaMarca(m);
    if (!partes) continue;
    const nome = simples(partes.nome);
    const mesmoNome = NEWSLETTERS.filter((n) => simples(n.nome) === nome);
    const mesmaMarca = mesmoNome.filter((n) => simples(partes.marca).includes(simples(n.marca)));
    if (mesmaMarca.length === 1) return mesmaMarca[0].id;
    if (mesmoNome.length === 1) return mesmoNome[0].id;
  }
  return null;
}

/**
 * Emails dos últimos dias que não ficaram atribuídos a nenhuma newsletter,
 * sem as boas-vindas e promoções conhecidas e sem os marcados no painel como
 * "não é newsletter". Do mais recente para o mais antigo.
 */
export function porClassificar(dias = 30): EmailPorClassificar[] {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const linhas = db()
    .prepare(
      `SELECT id, internet_message_id, remetente, assunto, recebido_em, corpo_html FROM emails
        WHERE newsletter_id IS NULL AND recebido_em >= ?
        ORDER BY recebido_em DESC`,
    )
    .all(paraIso(desde)) as EmailGuardado[];
  const { assuntos, mensagens } = exclusoesAtivas();

  return linhas
    .filter(
      (l) =>
        !naoEEdicao(l.assunto) &&
        !mensagens.has(l.internet_message_id) &&
        !assuntos.has(normalizarAssunto(l.assunto)) &&
        // Já reconhecido pela configuração atual: a próxima leitura atribui-o.
        !corresponder(l.remetente, l.assunto, l.corpo_html),
    )
    .map((l) => {
      const marcas = marcasNoCorpo(l.corpo_html);
      return {
        id: l.id,
        remetente: l.remetente,
        nome: extrairNome(l.remetente),
        endereco: extrairEndereco(l.remetente),
        assunto: l.assunto,
        recebidoEm: l.recebido_em,
        marcas,
        sugestao: sugerir(marcas),
      };
    });
}

/** Quantos há por classificar — para o aviso no topo do painel. */
export function contarPorClassificar(dias = 7): number {
  return porClassificar(dias).length;
}

export interface EstadoNewsletter {
  id: string;
  marca: string;
  nome: string;
  paga: boolean;
  configurada: boolean;
  /** De onde vem o reconhecimento. */
  origem: "ficheiro" | "painel" | "ambos" | null;
  /** ISO do último email atribuído a esta newsletter, ou null se nunca chegou nenhum. */
  ultima: string | null;
}

/** Cada newsletter ativa: se é reconhecida, de onde, e quando chegou a última edição. */
export function estadoNewsletters(): EstadoNewsletter[] {
  const regras = lerRegras();
  const ultimas = new Map(
    (
      db()
        .prepare(
          `SELECT newsletter_id AS id, MAX(recebido_em) AS ultima FROM emails
            WHERE newsletter_id IS NOT NULL GROUP BY newsletter_id`,
        )
        .all() as { id: string; ultima: string }[]
    ).map((l) => [l.id, l.ultima]),
  );

  return NEWSLETTERS.filter((n) => n.ativa).map((n) => {
    const ficheiro = configuradaNoFicheiro(n);
    const painel = regras.some((r) => r.newsletterId === n.id);
    return {
      id: n.id,
      marca: n.marca,
      nome: n.nome,
      paga: PAGAS.has(n.id),
      configurada: estaConfigurada(n),
      origem: ficheiro && painel ? "ambos" : ficheiro ? "ficheiro" : painel ? "painel" : null,
      ultima: ultimas.get(n.id) ?? null,
    };
  });
}

export interface Exclusao {
  id: number;
  tipo: TipoExclusao;
  rotulo: string;
  criadoEm: string;
}

export function lerExclusoes(): Exclusao[] {
  return db()
    .prepare(`SELECT id, tipo, rotulo, criado_em AS criadoEm FROM exclusoes ORDER BY id DESC`)
    .all() as Exclusao[];
}

export interface Alteracao {
  id: number;
  em: string;
  quem: string | null;
  acao: string;
  detalhe: string;
}

export function ultimasAlteracoes(limite = 15): Alteracao[] {
  return db()
    .prepare(`SELECT id, em, quem, acao, detalhe FROM alteracoes ORDER BY id DESC LIMIT ?`)
    .all(limite) as Alteracao[];
}
