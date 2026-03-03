import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

import authRoutes from './routes/auth.js';
import conversationRoutes from './routes/conversations.js';
import endpointRoutes from './routes/endpoints.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(join(__dirname, '../public')));

  // API 路由
  app.use('/api/auth', authRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/endpoints', endpointRoutes);

  // 处理 SPA 前端路由
  app.get('*', (req, res) => {
    const indexPath = join(__dirname, '../public/index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send('Frontend not built. Please run "npm run build" or use "start_all.bat" to build the frontend.');
    }
  });

  return app;
}

export function startServer(port = 8866) {
  const app = createApp();

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
  });

  return app;
}
