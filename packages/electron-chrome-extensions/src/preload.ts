import { injectExtensionAPIs } from './renderer'

// Only load within extension page context
if (
  // process.type === 'service-worker' || // Electron 35
  location.href.startsWith('chrome-extension://')
) {
  injectExtensionAPIs()
}
