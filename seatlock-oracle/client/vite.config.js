import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api and the websocket are proxied to the Express server,
// so the browser sees a single origin (no CORS headaches).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
