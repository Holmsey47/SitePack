import { parsePdfMessage } from '@/lib/pdfViewHtml';
import { theme } from '@/lib/theme';
import { createElement, useEffect, useRef } from 'react';

export function PdfFrame({
  html,
  onPage,
  onError,
}: {
  html: string;
  onPage: (page: number, total: number) => void;
  onError: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onPageRef = useRef(onPage);
  const onErrorRef = useRef(onError);
  onPageRef.current = onPage;
  onErrorRef.current = onError;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      const parsed = parsePdfMessage(event.data);
      if (!parsed) return;
      if ('error' in parsed) onErrorRef.current();
      else onPageRef.current(parsed.page, parsed.total);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return createElement('iframe', {
    ref: frameRef,
    title: 'PDF',
    sandbox: 'allow-scripts',
    srcDoc: html,
    style: {
      flex: 1,
      width: '100%',
      height: '100%',
      border: 0,
      background: theme.bg,
    },
  });
}
