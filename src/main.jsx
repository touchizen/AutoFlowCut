import React from 'react'
import ReactDOM from 'react-dom/client'
import Shell from './Shell'
import 'flag-icons/css/flag-icons.min.css'
import './App.css'

// 윈도우 타이틀에 버전 표시 (index.html의 <title> override)
document.title = `AutoFlowCut v${__APP_VERSION__}`

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
)
