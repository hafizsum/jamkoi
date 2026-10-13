import { initPage } from './layout.js';
import { ROOT } from './core.js';
document.querySelector('a.btn').href = ROOT;   // 404.html is served from any path on GitHub Pages
initPage('');
