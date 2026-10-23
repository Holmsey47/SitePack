import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, fittedSize, stripJpegExif } from '@/lib/photoBytes';
import { readLocalBytes } from '@/lib/uploadBytes';

function isReactNative(): boolean {
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  return nav?.product === 'ReactNative';
}

export { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, fittedSize, stripJpegExif };

type Drawable = {
  width: number;
  height: number;
};

type Plane = {
  width: number;
  height: number;
  drawImage: (image: Drawable, x: number, y: number, width: number, height: number) => void;
  toBlob: (type: string, quality: number) => Promise<Blob>;
};

function browserDocument(): { createElement: (tag: string) => unknown } | null {
  const doc = (globalThis as { document?: { createElement: (tag: string) => unknown } }).document;
  return doc ?? null;
}

async function loadDrawable(blob: Blob): Promise<Drawable & { release: () => void }> {
  const url = URL.createObjectURL(blob);
  const ImageCtor = (globalThis as { Image?: new () => Drawable & { onload: (() => void) | null; onerror: (() => void) | null; src: string } }).Image;
  if (!ImageCtor) {
    URL.revokeObjectURL(url);
    throw new Error('photo_unreadable');
  }
  const image = new ImageCtor();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('photo_unreadable'));
    image.src = url;
  });
  const loaded = image as unknown as Drawable & { release: () => void };
  loaded.release = () => URL.revokeObjectURL(url);
  return loaded;
}

function makePlane(width: number, height: number): Plane | null {
  const doc = browserDocument();
  if (!doc) return null;
  const canvas = doc.createElement('canvas') as {
    width: number;
    height: number;
    getContext: (kind: '2d') => {
      drawImage: (image: Drawable, x: number, y: number, width: number, height: number) => void;
    } | null;
    toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => void;
  };
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  return {
    width,
    height,
    drawImage: (image, x, y, w, h) => context.drawImage(image, x, y, w, h),
    toBlob: (type, quality) =>
      new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('photo_too_large'))), type, quality);
      }),
  };
}

async function encodePlane(plane: Plane, image: Drawable, maxEdge: number, maxBytes: number): Promise<Uint8Array> {
  let quality = 0.85;
  let edgeScale = 1;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const width = Math.max(1, Math.round(plane.width * edgeScale));
    const height = Math.max(1, Math.round(plane.height * edgeScale));
    const target = width === plane.width && height === plane.height ? plane : makePlane(width, height);
    if (!target) throw new Error('photo_unreadable');
    target.drawImage(image, 0, 0, width, height);
    const blob = await target.toBlob('image/jpeg', quality);
    const bytes = stripJpegExif(new Uint8Array(await blob.arrayBuffer()));
    if (bytes.byteLength <= maxBytes && Math.max(width, height) <= maxEdge) return bytes;
    if (quality > 0.45) quality -= 0.15;
    else edgeScale *= 0.75;
  }
  throw new Error('photo_too_large');
}

async function prepareOnWeb(blob: Blob, maxEdge: number, maxBytes: number): Promise<Uint8Array> {
  const image = await loadDrawable(blob);
  try {
    const fitted = fittedSize(image.width, image.height, maxEdge);
    const plane = makePlane(fitted.width, fitted.height);
    if (!plane) throw new Error('photo_unreadable');
    return await encodePlane(plane, image, maxEdge, maxBytes);
  } finally {
    image.release();
  }
}

async function prepareOnNative(uri: string, maxEdge: number, maxBytes: number): Promise<Uint8Array> {
  const { Image } = await import('react-native');
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => reject(new Error('photo_unreadable'))
    );
  });
  const manipulator = await import('expo-image-manipulator');
  let fitted = fittedSize(size.width, size.height, maxEdge);
  let quality = 0.85;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const action =
      size.width >= size.height ? [{ resize: { width: fitted.width } }] : [{ resize: { height: fitted.height } }];
    const result = await manipulator.manipulateAsync(uri, action, {
      compress: quality,
      format: manipulator.SaveFormat.JPEG,
    });
    const bytes = stripJpegExif(await readLocalBytes(result.uri));
    if (bytes.byteLength <= maxBytes) return bytes;
    if (quality > 0.45) quality -= 0.15;
    else fitted = fittedSize(fitted.width, fitted.height, Math.max(1, Math.round(maxEdge * 0.75)));
  }
  throw new Error('photo_too_large');
}

export async function preparePhoto(input: {
  uri?: string;
  blob?: Blob;
  maxEdge?: number;
  maxBytes?: number;
}): Promise<{
  bytes: Uint8Array;
  contentType: 'image/jpeg';
}> {
  const maxEdge = input.maxEdge ?? PHOTO_MAX_EDGE;
  const maxBytes = input.maxBytes ?? PHOTO_MAX_BYTES;
  if (input.blob && browserDocument()) {
    const bytes = await prepareOnWeb(input.blob, maxEdge, maxBytes);
    return { bytes, contentType: 'image/jpeg' };
  }
  if (input.uri && isReactNative()) {
    const bytes = await prepareOnNative(input.uri, maxEdge, maxBytes);
    return { bytes, contentType: 'image/jpeg' };
  }
  if (input.blob) {
    const bytes = stripJpegExif(new Uint8Array(await input.blob.arrayBuffer()));
    if (bytes.byteLength > maxBytes) throw new Error('photo_too_large');
    return { bytes, contentType: 'image/jpeg' };
  }
  throw new Error('photo_unreadable');
}
