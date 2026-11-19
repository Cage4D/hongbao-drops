import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './styles/tokens.css';
import './styles/app.css';
import './styles/pages.css';
import { NetworkProvider } from './lib/network';
import { WalletProvider } from './lib/wallet';
import { ToastProvider } from './components/ui';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';

// Everything but the landing page loads on demand: it keeps the wallet, transaction and QR code
// out of the first download.
const Send = lazy(() => import('./pages/Send').then((m) => ({ default: m.Send })));
const EnvelopePage = lazy(() => import('./pages/EnvelopePage').then((m) => ({ default: m.EnvelopePage })));
const Sponsor = lazy(() => import('./pages/Sponsor').then((m) => ({ default: m.Sponsor })));
const CampaignPublic = lazy(() => import('./pages/CampaignPublic').then((m) => ({ default: m.CampaignPublic })));
const Demo = lazy(() => import('./pages/Demo').then((m) => ({ default: m.Demo })));
const Activity = lazy(() => import('./pages/Activity').then((m) => ({ default: m.Activity })));

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/send', element: <Send /> },
      { path: '/sponsor', element: <Sponsor /> },
      { path: '/activity', element: <Activity /> },
      { path: '/c/:campaignId', element: <CampaignPublic /> },
      { path: '/e/:id', element: <EnvelopePage /> },
      // The judges' "Try it free" link: always opens the current demo envelope.
      { path: '/demo', element: <Demo /> },
      // Short links: /<6-char slug>#k=…
      { path: '/:slug', element: <EnvelopePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NetworkProvider>
      <WalletProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </WalletProvider>
    </NetworkProvider>
  </StrictMode>,
);
