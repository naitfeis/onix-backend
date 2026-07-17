import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/syne/600.css'
import '@fontsource/syne/700.css'
import '@fontsource/syne/800.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
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
