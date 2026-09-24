/** Draw the sheet in the page. No worker, and the web view is not pointed at the file. */
export function sheetViewHtml(pdfBase64: string, librarySource: string, workerSource: string): string {
  const pdf = JSON.stringify(pdfBase64);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4" />
<style>
  html, body { margin: 0; background: #121820; color: #F4F1EA; font: 16px sans-serif; }
  canvas { display: block; width: 100%; height: auto; margin: 0 auto 12px; }
  p { padding: 24px; }
</style>
</head>
<body>
<script>${workerSource}</script>
<script>${librarySource}</script>
<script>
function bytes(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
pdfjsLib.getDocument({ data: bytes(${pdf}) }).promise.then(async function (doc) {
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.max(1, (window.innerWidth - 8) / unscaled.width) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    document.body.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
  }
}).catch(function () {
  const note = document.createElement('p');
  note.textContent = 'Could not open the sheet.';
  document.body.appendChild(note);
});
</script>
</body>
</html>`;
}
