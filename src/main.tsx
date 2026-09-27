import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App';
import { SiteProvider } from './site-context';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user"><SiteProvider><App /></SiteProvider></MotionConfig></React.StrictMode>);
