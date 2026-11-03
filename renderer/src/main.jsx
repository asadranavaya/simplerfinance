import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { IS_APP_BUILD } from './util/appFeatures'

if (IS_APP_BUILD) document.documentElement.dataset.appBuild = 'true'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
