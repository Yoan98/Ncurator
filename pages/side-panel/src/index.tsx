import { createRoot } from 'react-dom/client';
import '@extension/tailwindcss-config/input.css'
import '@src/index.css';
import App from '@src/App';
// import App from '@src/components/test';
import 'animate.css';

function init() {
    const appContainer = document.querySelector('#app-container');
    if (!appContainer) {
        throw new Error('Can not find #app-container');
    }
    const root = createRoot(appContainer);
    root.render(<App />);
}

init();
