import { estimatePdfPageCount, renderPdfFromText } from "../src/pdf.js";

describe("renderPdfFromText", () => {
  it("produces a PDF buffer and reports progress", async () => {
    const lines = Array.from({ length: 200 }, (_, idx) => `Line ${idx}`);
    const text = lines.join("\n");
    const expectedPages = estimatePdfPageCount(text);

    const steps: number[] = [];
    const totals: number[] = [];

    const { buffer, pageCount } = await renderPdfFromText(text, {
      onProgress: ({ processed, total }) => {
        steps.push(processed);
        totals.push(total);
      },
    });

    expect(pageCount).toBe(expectedPages);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(totals.every((total) => total === expectedPages)).toBe(true);
    expect(steps.length).toBe(expectedPages);
  });
});
