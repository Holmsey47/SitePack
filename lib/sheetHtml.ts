/** Gap inside the frame so the sheet edge and its stroke are not flush with the clip. */
const SHEET_FRAME_PAD = 8;

/** A little under the padded frame, so a subpixel or a scrollbar cannot crop the border. */
const SHEET_FIT_SHRINK = 0.98;

/** Scale that fits a whole page in the frame. The spare axis is letterboxed. */
export function sheetFitScale(pageWidth: number, pageHeight: number, frameWidth: number, frameHeight: number): number {
  if (pageWidth <= 0 || pageHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return 1;
  const innerWidth = Math.max(1, frameWidth - SHEET_FRAME_PAD * 2);
  const innerHeight = Math.max(1, frameHeight - SHEET_FRAME_PAD * 2);
  return Math.min(innerWidth / pageWidth, innerHeight / pageHeight) * SHEET_FIT_SHRINK;
}

/** Draw the sheet in the page. No worker, and the web view is not pointed at the file. */
export function sheetViewHtml(pdfBase64: string, librarySource: string, workerSource: string): string {
  const pdf = JSON.stringify(pdfBase64);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes" />
<style>
  html, body { margin: 0; height: 100%; background: #121820; color: #F4F1EA; font: 16px sans-serif; }
  body { display: flex; align-items: center; justify-content: center; overflow: auto; touch-action: pan-x pan-y; }
  canvas { display: block; }
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
function fitScale(pageWidth, pageHeight, frameWidth, frameHeight) {
  if (pageWidth <= 0 || pageHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) return 1;
  var pad = ${SHEET_FRAME_PAD};
  var innerWidth = Math.max(1, frameWidth - pad * 2);
  var innerHeight = Math.max(1, frameHeight - pad * 2);
  return Math.min(innerWidth / pageWidth, innerHeight / pageHeight) * ${SHEET_FIT_SHRINK};
}
var fittedWidth = 0;
var fittedHeight = 0;
var viewScale = 1;
var baseWidth = 0;
var baseHeight = 0;
var pinchStart = null;
pdfjsLib.getDocument({ data: bytes(${pdf}), isEvalSupported: false }).promise.then(async function (doc) {
  const page = await doc.getPage(1);
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  function place() {
    var zoomed = viewScale > 1.01;
    document.body.style.alignItems = zoomed ? 'flex-start' : 'center';
    document.body.style.justifyContent = zoomed ? 'flex-start' : 'center';
    canvas.style.width = (baseWidth * viewScale) + 'px';
    canvas.style.height = (baseHeight * viewScale) + 'px';
  }
  function touchDistance(event) {
    var first = event.touches[0];
    var second = event.touches[1];
    var dx = first.clientX - second.clientX;
    var dy = first.clientY - second.clientY;
    return Math.hypot(dx, dy);
  }
  async function draw() {
    const frameWidth = document.documentElement.clientWidth || window.innerWidth;
    const frameHeight = document.documentElement.clientHeight || window.innerHeight;
    if (frameWidth < 2 || frameHeight < 2) {
      requestAnimationFrame(draw);
      return;
    }
    const unscaled = page.getViewport({ scale: 1 });
    const fit = fitScale(unscaled.width, unscaled.height, frameWidth, frameHeight);
    baseWidth = unscaled.width * fit;
    baseHeight = unscaled.height * fit;
    const scale = fit * viewScale;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * pixelRatio });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    place();
    fittedWidth = frameWidth;
    fittedHeight = frameHeight;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
  }
  document.body.addEventListener('touchstart', function (event) {
    if (event.touches.length === 2 && baseWidth > 0) {
      pinchStart = { dist: touchDistance(event), scale: viewScale };
    }
  }, { passive: true });
  document.body.addEventListener('touchmove', function (event) {
    if (event.touches.length !== 2 || !pinchStart) return;
    event.preventDefault();
    var next = pinchStart.scale * touchDistance(event) / pinchStart.dist;
    viewScale = Math.min(5, Math.max(1, next));
    place();
  }, { passive: false });
  document.body.addEventListener('touchend', function (event) {
    if (event.touches.length < 2 && pinchStart) {
      pinchStart = null;
      draw();
    }
  });
  await draw();
  window.addEventListener('resize', function () {
    var width = document.documentElement.clientWidth || window.innerWidth;
    var height = document.documentElement.clientHeight || window.innerHeight;
    if (Math.abs(width - fittedWidth) < 2 && Math.abs(height - fittedHeight) < 2) return;
    draw();
  });
}).catch(function () {
  const note = document.createElement('p');
  note.textContent = 'Could not open the sheet.';
  document.body.appendChild(note);
});
</script>
</body>
</html>`;
}
