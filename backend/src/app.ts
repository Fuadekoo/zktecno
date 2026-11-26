import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiRoutes } from './routes/index.js';

export function createApp() {
  const app = express();
  const staticDir = config.desktop.staticDir ? path.resolve(config.desktop.staticDir) : '';

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // The exported dashboard uses inline scripts, which the default Content-Security-Policy blocks
  app.use(helmet(staticDir ? { contentSecurityPolicy: false } : undefined));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(morgan(config.isProduction ? 'combined' : 'dev', { skip: (req) => Boolean(staticDir) && !req.originalUrl.startsWith('/api') }));

  app.use('/api', apiRoutes());

  // Single-process mode (desktop app): serve the exported Next.js dashboard from the same port,
  // so /api is same-origin and the session cookie just works.
  if (staticDir) {
    if (!fs.existsSync(path.join(staticDir, 'index.html'))) console.warn(`[server] STATIC_DIR ${staticDir} has no index.html: build the frontend first`);
    // Page routes first: /employees -> employees.html. (The export also has an employees/ folder with
    // the page's data files, which the static handler would otherwise redirect to.)
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const clean = req.path.replace(/\/+$/, '') || '/index';
      if (path.extname(clean)) return next();
      const file = path.join(staticDir, `${clean}.html`);
      if (!file.startsWith(staticDir + path.sep) || !fs.existsSync(file)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(file);
    });
    // Everything else (scripts, styles, page data); long cache for hashed build assets only
    app.use(
      express.static(staticDir, {
        redirect: false,
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}_next${path.sep}static${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    const notFoundPage = path.join(staticDir, '404.html');
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) return next();
      if (fs.existsSync(notFoundPage)) return res.status(404).sendFile(notFoundPage);
      next();
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
