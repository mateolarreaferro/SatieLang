import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './lib/AuthContext';
import { Dashboard } from './ui/pages/Dashboard';
import { Editor } from './ui/pages/Editor';
import './ui/styles/interactions.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/editor/:sketchId" element={<Editor />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
