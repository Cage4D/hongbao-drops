import { StrictMode } from 'react';
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
import { Send } from './pages/Send';
import { EnvelopePage } from './pages/EnvelopePage';
import { Sponsor } from './pages/Sponsor';
import { CampaignPublic } from './pages/CampaignPublic';
import { NotFound } from './pages/NotFound';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/send', element: <Send /> },
      { path: '/sponsor', element: <Sponsor /> },
      { path: '/c/:campaignId', element: <CampaignPublic /> },
      { path: '/e/:id', element: <EnvelopePage /> },
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
