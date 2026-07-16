import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { captureNavigationTimingWhenReady, markAppReady } from './perf/timing'

markAppReady('js-main')
captureNavigationTimingWhenReady()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
