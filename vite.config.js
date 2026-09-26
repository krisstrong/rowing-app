import { defineConfig } from 'vite';

// GitHub Pages serves this from /rowing-app/, but the dev server should stay
// at the root so `npm run dev` keeps working at http://localhost:5173.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/rowing-app/' : '/',
}));
