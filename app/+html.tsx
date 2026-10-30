import { theme } from '@/lib/theme';
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/** Web shell. no-referrer keeps a /join/<code> link out of the next request. */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="referrer" content="no-referrer" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style>{`html, body { background: ${theme.bg}; color: ${theme.text}; font-family: system-ui, sans-serif; }`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
