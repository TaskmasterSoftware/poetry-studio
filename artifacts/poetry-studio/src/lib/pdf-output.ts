import type { PdfOutputProfile } from './poem-files';

export async function preparePdfOutput(
  pdf: Blob,
  outputProfile: PdfOutputProfile,
): Promise<Blob> {
  if (outputProfile !== 'pdfx-1a-2003') return pdf;

  const { check, convert } = await import('kura-pdf-wasm');
  const input = new Uint8Array(await pdf.arrayBuffer());
  const converted = await convert(input, 'x1a');

  if (converted.level !== 'x1a') {
    throw new Error('The PDF/X converter did not produce the requested print profile.');
  }

  const validation = await check(converted.pdf, 'x1a');
  if (!validation.compliant || validation.findings > 0) {
    throw new Error('The PDF/X file did not pass the converter’s conformance check.');
  }

  const metadata = new TextDecoder('latin1').decode(converted.pdf.subarray(0, 65_536));
  if (!metadata.includes('PDF/X-1a:2003')) {
    throw new Error('The converter output did not identify itself as PDF/X-1a:2003.');
  }

  const bytes = new Uint8Array(converted.pdf.byteLength);
  bytes.set(converted.pdf);
  return new Blob([bytes.buffer], { type: 'application/pdf' });
}
