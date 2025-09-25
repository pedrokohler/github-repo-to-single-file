const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT_MARGIN = 40;
const TOP_MARGIN = 48;
const BOTTOM_MARGIN = 48;
const FONT_SIZE = 10;
const LINE_HEIGHT = 12;

type PdfProgress = {
  processed: number;
  total: number;
};

type PdfRenderOptions = {
  onProgress?: (progress: PdfProgress) => void;
};

type PdfRenderResult = {
  buffer: Buffer;
  pageCount: number;
};

function escapePdfText(line: string): string {
  return line
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\t]/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function splitIntoPages(lines: string[]): string[][] {
  const usableHeight = PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN;
  const maxLinesPerPage = Math.max(1, Math.floor(usableHeight / LINE_HEIGHT));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }
  if (pages.length === 0) {
    pages.push([""]);
  }
  return pages;
}

function buildContentStream(lines: string[]): string {
  const startY = PAGE_HEIGHT - TOP_MARGIN;
  const header = `BT\n/F1 ${FONT_SIZE} Tf\n1 0 0 1 ${LEFT_MARGIN} ${startY} Tm\n${LINE_HEIGHT} TL`;
  const body = lines
    .map((line) => `(${escapePdfText(line)}) Tj\nT*`)
    .join("\n");
  return `${header}\n${body}\nET`;
}

async function createPdfBuffers(
  pages: string[][],
  onProgress?: (progress: PdfProgress) => void
): Promise<Buffer> {
  type PdfObject = string | null;
  const objects: PdfObject[] = [];

  const createObject = (content: PdfObject = null): number => {
    objects.push(content);
    return objects.length;
  };

  const setObject = (id: number, content: string): void => {
    objects[id - 1] = content;
  };

  const fontObject = createObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  );

  const contentObjects = pages.map(() => createObject());
  const pageObjects = pages.map(() => createObject());
  const pagesObject = createObject();
  const catalogObject = createObject();

  for (let idx = 0; idx < pages.length; idx += 1) {
    const lines = pages[idx];
    const stream = buildContentStream(lines);
    const buffer = Buffer.from(stream, "utf8");
    setObject(
      contentObjects[idx],
      `<< /Length ${buffer.length} >>\nstream\n${stream}\nendstream`
    );
    onProgress?.({ processed: idx + 1, total: pages.length });
    if (onProgress) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  const kids = pageObjects.map((num) => `${num} 0 R`).join(" ");
  setObject(
    pagesObject,
    `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`
  );

  pageObjects.forEach((objNum, idx) => {
    const contentNum = contentObjects[idx];
    setObject(
      objNum,
      `<< /Type /Page /Parent ${pagesObject} 0 R /Resources << /Font << /F1 ${fontObject} 0 R >> >> /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contentNum} 0 R >>`
    );
  });

  setObject(catalogObject, `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);

  const offsets: number[] = [];
  let pdf = "%PDF-1.4\n";

  objects.forEach((content, idx) => {
    if (content == null) {
      throw new Error(`Uninitialised PDF object at index ${idx}`);
    }
    offsets[idx] = Buffer.byteLength(pdf, "utf8");
    pdf += `${idx + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  objects.forEach((_, idx) => {
    pdf += `${offsets[idx].toString().padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

export function estimatePdfPageCount(text: string): number {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return splitIntoPages(lines).length;
}

export async function renderPdfFromText(
  text: string,
  options: PdfRenderOptions = {}
): Promise<PdfRenderResult> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const pages = splitIntoPages(lines);
  const buffer = await createPdfBuffers(pages, options.onProgress);
  return { buffer, pageCount: pages.length };
}
