import { createRoot } from 'react-dom/client'
import '@fontsource/cormorant-garamond/latin-300.css'
import '@fontsource/cormorant-garamond/latin-400-italic.css'
import '@fontsource/cormorant-garamond/latin-500-italic.css'
import '@fontsource/cormorant-garamond/latin-500.css'
import '@fontsource/noto-serif-sc/400.css'
import './styles.css'
import App from './App'
import { store } from './store'
import { loadMemories } from './memories'

createRoot(document.getElementById('root')!).render(<App />)
loadMemories()
