import '@/styles/globals.css';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <div className="app-atmosphere" aria-hidden="true" />
      <div className="app-noise" aria-hidden="true" />
      <div className="app-shell">
        <Component {...pageProps} />
      </div>
    </>
  );
}
