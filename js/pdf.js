/**
 * RepasseMed – leitura de relatórios em PDF (ex.: "Relatório de Atendimento"
 * do sistema da clínica).
 *
 * Como funciona: o pdf.js devolve cada pedaço de texto com a sua posição na
 * página. Agrupamos os pedaços por linha (mesma altura), achamos a linha de
 * cabeçalho (a que tem mais nomes de coluna conhecidos) e colocamos cada
 * pedaço na coluna cujo intervalo contém o centro dele. O resultado é a mesma
 * matriz (linhas × colunas) que sai de uma planilha, e o resto do sistema
 * segue igual.
 *
 * O PDF é lido só no navegador. Nada é enviado para servidor.
 */
import { FIELDS, normalize } from "./engine.js";

// pdf.js (Mozilla, licença Apache 2.0), versão fixa, carregado só quando um
// PDF é aberto. A política de segurança da página libera apenas este endereço.
const PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/";
const PDFJS_LIB = PDFJS_BASE + "pdf.min.mjs";
const PDFJS_WORKER = PDFJS_BASE + "pdf.worker.min.mjs";

/** Agrupa itens {x, y, w, s} em linhas (tolerância de altura em pontos). */
export function groupLines(items, tol = 2.5) {
  const sorted = items.filter(i => String(i.s ?? "").trim()).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function headerScore(line) {
  let score = 0;
  const cells = line.items.map(i => normalize(i.s));
  for (const f of FIELDS) if (cells.some(c => f.syn.some(s => c.includes(s)))) score++;
  return score;
}

/**
 * Converte as páginas de um PDF em matriz [cabeçalho, ...linhas].
 * @param {Array<{items: Array<{x:number,y:number,w:number,s:string}>}>} pages
 */
export function matrixFromPages(pages) {
  // 1) cabeçalho: a linha com mais nomes de coluna conhecidos (mínimo 3)
  let header = null;
  for (const p of pages) {
    for (const l of groupLines(p.items)) {
      if (l.items.length < 3) continue;
      const sc = headerScore(l);
      if (sc >= 3 && (!header || sc > header.score)) header = { score: sc, line: l };
    }
    if (header) break;
  }
  if (!header) return [];
  const cols = header.line.items.map(i => ({ x: i.x, nome: String(i.s).trim() }));
  const nomes = cols.map(c => c.nome);
  const sig = nomes.map(normalize).join("|");

  const colOf = it => {
    const cx = it.x + (Number(it.w) || 0) / 2;
    let k = 0;
    for (let i = 0; i < cols.length; i++) if (cx >= cols[i].x - 2) k = i;
    return k;
  };

  // 2) linhas de dados: todas as páginas, sem repetir o cabeçalho
  const out = [nomes];
  for (const p of pages) {
    for (const l of groupLines(p.items)) {
      const textos = l.items.map(i => normalize(i.s));
      if (textos.join("|") === sig) continue;              // cabeçalho repetido
      if (l.y <= header.line.y && p === pages[0]) continue; // título acima do cabeçalho
      const row = new Array(cols.length).fill("");
      for (const it of l.items) {
        const k = colOf(it);
        row[k] = row[k] ? `${row[k]} ${String(it.s).trim()}` : String(it.s).trim();
      }
      const preenchidas = row.filter(c => c !== "").length;
      if (preenchidas < 4) continue;                         // rodapé, título, número de página
      out.push(row);
    }
  }
  return out;
}

let pdfjsPromise = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_LIB).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return lib;
    });
  }
  return pdfjsPromise;
}

/** Lê um PDF (ArrayBuffer) e devolve a matriz pronta para tableFromMatrix. */
export async function readPdf(buf) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    pages.push({
      items: tc.items.map(i => ({ x: i.transform[4], y: vp.height - i.transform[5], w: i.width, s: i.str })),
    });
  }
  return matrixFromPages(pages);
}
