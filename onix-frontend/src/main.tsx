import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { scheduleBundleAudit, markMainEval } from './perf/bundleAudit'
import { captureNavigationTimingWhenReady, markAppReady } from './perf/timing'

markMainEval('start')
markAppReady('js-main')
captureNavigationTimingWhenReady()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

markMainEval('end')
scheduleBundleAudit()
