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
  const onPageRef = useRef(onPage);
  const onErrorRef = useRef(onError);
  onPageRef.current = onPage;
  onErrorRef.current = onError;

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const parsed = parsePdfMessage(event.data);
      if (!parsed) return;
      if ('error' in parsed) onErrorRef.current();
      else onPageRef.current(parsed.page, parsed.total);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return createElement('iframe', {
    title: 'PDF',
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
