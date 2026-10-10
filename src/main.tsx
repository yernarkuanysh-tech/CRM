import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {ToastProvider} from './components/feedback';
import './styles.css';

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
