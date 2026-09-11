import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import './styles/themes.css';
import './styles/motion.css';
import { applyTheme, getStoredTheme } from './theme.js';
import App from './App.jsx';

applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
