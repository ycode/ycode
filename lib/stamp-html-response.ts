/**
 * Stamp published HTML so View Source starts like Framer:
 *
 *   <!DOCTYPE html>
 *   <!-- Made in Ycode · ycode.com -->
 *   <!-- Published … -->
 *   <html>
 *
 * React cannot emit comment nodes before `<html>`, so we insert them on
 * the Node HTTP response. Next.js gzip-compresses HTML first; we wrap
 * `write` after that middleware so we stamp uncompressed HTML and never
 * touch compressed bytes (rewriting gzip as UTF-8 blanks the page).
 */

import { Server, ServerResponse } from 'http';
import { rememberYcodePublishedAt, stampHtmlDocument } from './ycode-html-comment';

const PUBLISHED_AT_REFRESH_MS = 30_000;
const PATCHED = Symbol.for('ycode.html-stamp');
const WRAPPED = Symbol.for('ycode.html-stamp-wrapped');

/** Load publish time in this isolate so the stamp can include the Published line. */
export async function startYcodePublishedAtRefresh(): Promise<void> {
  const refresh = async () => {
    try {
      const { getSettingByKey } = await import('./repositories/settingsRepository');
      const value = await getSettingByKey('published_at');
      rememberYcodePublishedAt(typeof value === 'string' ? value : null);
    } catch {
      rememberYcodePublishedAt(null);
    }
  };

  await refresh();
  const timer = setInterval(() => {
    void refresh();
  }, PUBLISHED_AT_REFRESH_MS);
  timer.unref?.();
}

type WriteCallback = (error?: Error | null) => void;

type StampedResponse = ServerResponse & {
  [WRAPPED]?: boolean;
  __ycodeStampState?: 'pending' | 'done' | 'skip';
  __ycodeStampBuffer?: string;
};

function isBuilderOrAssetUrl(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return (
    path.startsWith('/ycode')
    || path.startsWith('/_next')
    || path.startsWith('/api')
    || path.startsWith('/a/')
  );
}

function isGzipChunk(chunk: unknown): boolean {
  if (typeof chunk === 'string' || chunk == null) return false;
  const buf = Buffer.isBuffer(chunk)
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk)
      : null;
  return Boolean(buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b);
}

function chunkToHtmlText(chunk: unknown, encoding?: BufferEncoding): string | null {
  if (typeof chunk === 'string') return chunk;
  if (isGzipChunk(chunk)) return null;
  if (Buffer.isBuffer(chunk)) return chunk.toString(encoding || 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString(encoding || 'utf8');
  return null;
}

function shouldSkip(res: StampedResponse): boolean {
  if (res.__ycodeStampState === 'skip' || res.__ycodeStampState === 'done') {
    return true;
  }

  const req = res.req as { url?: string } | undefined;
  if (isBuilderOrAssetUrl(req?.url)) {
    res.__ycodeStampState = 'skip';
    return true;
  }

  const contentType = res.getHeader('content-type');
  if (contentType && !String(contentType).includes('text/html')) {
    res.__ycodeStampState = 'skip';
    return true;
  }

  return false;
}

function stampChunk(res: StampedResponse, chunk: unknown, encoding?: BufferEncoding): unknown {
  if (chunk === undefined || isGzipChunk(chunk) || shouldSkip(res)) {
    return chunk;
  }

  const text = chunkToHtmlText(chunk, encoding);
  if (text === null) {
    return chunk;
  }

  const combined = `${res.__ycodeStampBuffer ?? ''}${text}`;
  const hasDoctype = /<!DOCTYPE html>/i.test(combined);
  const hasHtml = /<html\b/i.test(combined);

  if (!hasDoctype && !hasHtml) {
    // Only hold a split `<!DOCTYPE` prefix — never buffer unknown / compressed bytes.
    if (combined.length < 32 && /^\s*<!/i.test(combined)) {
      res.__ycodeStampState = 'pending';
      res.__ycodeStampBuffer = combined;
      return null;
    }
    const leftover = res.__ycodeStampBuffer;
    res.__ycodeStampState = 'skip';
    res.__ycodeStampBuffer = undefined;
    return leftover ? combined : chunk;
  }

  res.__ycodeStampState = 'done';
  res.__ycodeStampBuffer = undefined;
  return stampHtmlDocument(combined);
}

function flushBuffer(res: StampedResponse): string | undefined {
  const leftover = res.__ycodeStampBuffer;
  res.__ycodeStampBuffer = undefined;
  if (res.__ycodeStampState === 'pending') {
    res.__ycodeStampState = 'skip';
  }
  return leftover;
}

type LooseWrite = (
  chunk?: unknown,
  encodingOrCb?: BufferEncoding | WriteCallback,
  maybeCb?: WriteCallback,
) => boolean;

function callWrite(
  write: LooseWrite,
  chunk: unknown,
  encodingOrCb?: BufferEncoding | WriteCallback,
  maybeCb?: WriteCallback,
): boolean {
  if (typeof encodingOrCb === 'function') {
    return write(chunk, encodingOrCb);
  }
  if (typeof encodingOrCb === 'string' && maybeCb) {
    return write(chunk, encodingOrCb, maybeCb);
  }
  if (typeof encodingOrCb === 'string') {
    return write(chunk, encodingOrCb);
  }
  return write(chunk);
}

function wrapResponse(res: StampedResponse): void {
  if (res[WRAPPED] || res.writableEnded) {
    return;
  }
  res[WRAPPED] = true;

  const innerWrite = res.write.bind(res);
  const innerEnd = res.end.bind(res);

  res.write = function (
    chunk?: unknown,
    encodingOrCb?: BufferEncoding | WriteCallback,
    maybeCb?: WriteCallback,
  ) {
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
    const stamped = stampChunk(this, chunk, encoding);

    if (stamped === null) {
      callback?.();
      return true;
    }

    return callWrite(innerWrite as LooseWrite, stamped, encodingOrCb, maybeCb);
  };

  res.end = function (
    chunk?: unknown,
    encodingOrCb?: BufferEncoding | WriteCallback,
    maybeCb?: WriteCallback,
  ) {
    const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : undefined;
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
    const chunkIsCallback = typeof chunk === 'function';
    const hasChunk = chunk !== undefined && !chunkIsCallback;

    let payload: unknown;
    if (hasChunk) {
      const stamped = stampChunk(this, chunk, encoding);
      payload = stamped === null ? flushBuffer(this) : stamped;
    } else {
      payload = flushBuffer(this);
    }

    const endCb = chunkIsCallback ? chunk as WriteCallback : callback;

    if (payload === undefined) {
      if (endCb) {
        return innerEnd(endCb);
      }
      return innerEnd();
    }
    if (encoding && endCb) {
      return innerEnd(payload, encoding, endCb);
    }
    if (endCb) {
      return innerEnd(payload, endCb);
    }
    if (encoding) {
      return innerEnd(payload, encoding);
    }
    return innerEnd(payload);
  };
}

export function patchHtmlResponseStamp(): void {
  const proto = Server.prototype as typeof Server.prototype & {
    [PATCHED]?: boolean;
  };
  if (proto[PATCHED]) {
    return;
  }
  proto[PATCHED] = true;

  const originalEmit = proto.emit;
  proto.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
    if (event === 'request') {
      const res = args[1] as StampedResponse | undefined;
      // Next.js installs gzip on `write` synchronously in the request
      // listener. Wait until that finishes so we wrap the uncompressed side.
      queueMicrotask(() => {
        if (res) wrapResponse(res);
      });
    }
    return Reflect.apply(originalEmit, this, [event, ...args]);
  };
}
