import { theme } from '@/lib/theme';

export type PdfFrameMessage = { page: number; total: number } | { error: true };

/** Messages from the viewer page. Anything else, including a URL, is ignored. */
export function parsePdfMessage(raw: unknown): PdfFrameMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.source !== 'sitepack-pdf') return null;
  if (record.error === true) return { error: true };
  if (typeof record.page !== 'number' || typeof record.total !== 'number') return null;
  if (!Number.isInteger(record.page) || !Number.isInteger(record.total)) return null;
  if (record.page < 1 || record.total < 1 || record.page > record.total) return null;
  return { page: record.page, total: record.total };
}

/**
 * Draws every page in the app. The HTML holds the PDF bytes, not a remote address,
 * so the page cannot navigate to the signed URL.
 */
export function pdfViewHtml(pdfBase64: string, librarySource: string, workerSource: string): string {
  const pdf = JSON.stringify(pdfBase64);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes" />
<style>
  html, body { margin: 0; background: ${theme.bg}; color: ${theme.text}; scrollbar-width: none; -ms-overflow-style: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; display: none; }
  #pages { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 12px 48px; }
  canvas { display: block; background: white; }
</style>
</head>
<body>
<div id="pages"></div>
<script>${workerSource}</script>
<script>${librarySource}</script>
<script>
function bytes(b64) {
  var raw = atob(b64);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function post(payload) {
  var raw = JSON.stringify(payload);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(raw);
  else if (window.parent) window.parent.postMessage(raw, '*');
}
var reported = false;
function report(page, total) {
  reported = true;
  post({ source: 'sitepack-pdf', page: page, total: total });
}
setTimeout(function () {
  if (!reported) post({ source: 'sitepack-pdf', error: true });
}, 15000);
var viewScale = 1;
var pinchStart = null;
var pages = [];
function fitWidth(pageWidth, frameWidth) {
  if (pageWidth <= 0 || frameWidth <= 0) return 1;
  return Math.max(1, frameWidth - 24) / pageWidth;
}
function place() {
  pages.forEach(function (item) {
    item.canvas.style.width = (item.baseWidth * viewScale) + 'px';
    item.canvas.style.height = (item.baseHeight * viewScale) + 'px';
  });
}
function touchDistance(event) {
  var first = event.touches[0];
  var second = event.touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}
function currentPage() {
  if (pages.length === 0) return;
  var mid = window.scrollY + window.innerHeight / 2;
  var best = 1;
  var bestDist = Infinity;
  pages.forEach(function (item, index) {
    var top = item.canvas.getBoundingClientRect().top + window.scrollY;
    var center = top + item.canvas.offsetHeight / 2;
    var dist = Math.abs(center - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = index + 1;
    }
  });
  report(best, pages.length);
}
async function drawAll() {
  var frameWidth = document.documentElement.clientWidth || window.innerWidth;
  if (frameWidth < 2) {
    requestAnimationFrame(drawAll);
    return;
  }
  var pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  for (var i = 0; i < pages.length; i++) {
    var item = pages[i];
    var unscaled = item.page.getViewport({ scale: 1 });
    var fit = fitWidth(unscaled.width, frameWidth);
    item.baseWidth = unscaled.width * fit;
    item.baseHeight = unscaled.height * fit;
    var viewport = item.page.getViewport({ scale: fit * viewScale * pixelRatio });
    item.canvas.width = Math.max(1, Math.round(viewport.width));
    item.canvas.height = Math.max(1, Math.round(viewport.height));
    place();
    await item.page.render({ canvasContext: item.canvas.getContext('2d'), viewport: viewport }).promise;
  }
  currentPage();
}
pdfjsLib.getDocument({ data: bytes(${pdf}), isEvalSupported: false }).promise.then(async function (doc) {
  var holder = document.getElementById('pages');
  for (var n = 1; n <= doc.numPages; n++) {
    var page = await doc.getPage(n);
    var canvas = document.createElement('canvas');
    holder.appendChild(canvas);
    pages.push({ page: page, canvas: canvas, baseWidth: 0, baseHeight: 0 });
  }
  document.body.addEventListener('touchstart', function (event) {
    if (event.touches.length === 2) pinchStart = { dist: touchDistance(event), scale: viewScale };
  }, { passive: true });
  document.body.addEventListener('touchmove', function (event) {
    if (event.touches.length !== 2 || !pinchStart) return;
    event.preventDefault();
    viewScale = Math.min(5, Math.max(1, pinchStart.scale * touchDistance(event) / pinchStart.dist));
    place();
  }, { passive: false });
  document.body.addEventListener('touchend', function (event) {
    if (event.touches.length < 2 && pinchStart) {
      pinchStart = null;
      drawAll();
    }
  });
  window.addEventListener('scroll', function () { currentPage(); }, { passive: true });
  window.addEventListener('resize', function () { drawAll(); });
  await drawAll();
}).catch(function () {
  post({ source: 'sitepack-pdf', error: true });
});
</script>
</body>
</html>`;
}
