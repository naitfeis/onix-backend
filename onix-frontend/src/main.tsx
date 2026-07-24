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
import { ErrorBoundary } from './components/ErrorBoundary'
import { scheduleBundleAudit, markMainEval } from './perf/bundleAudit'
import { captureNavigationTimingWhenReady, markAppReady } from './perf/timing'
import { registerPwa } from './pwa/registerPwa'
import { dismissBootSplash } from './shell/dismissBootSplash'
import { installGlobalErrorHandlers } from './utils/globalErrorHandlers'

markMainEval('start')
markAppReady('js-main')
captureNavigationTimingWhenReady()
installGlobalErrorHandlers()
registerPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

dismissBootSplash()
markMainEval('end')
scheduleBundleAudit()
