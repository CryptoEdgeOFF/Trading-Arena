import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const api = env.VITE_API_URL || 'http://localhost:3001'
  const apiReadOnly = env.LOCAL_API_READ_ONLY === 'true'

  const readOnlyGuard = {
    name: 'local-api-read-only',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const method = req.method?.toUpperCase() || 'GET'
        const isApiRequest = req.url?.startsWith('/api/')
        if (isApiRequest && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'API principale branchée en lecture seule locale' }))
          return
        }
        next()
      })
    },
  } satisfies Plugin

  return {
    plugins: [react(), tailwindcss(), ...(apiReadOnly ? [readOnlyGuard] : [])],
    server: {
      host: true,
      proxy: {
        '/api': api,
        '/uploads': api,
        ...(!apiReadOnly ? {
          '/ws': {
            target: api,
            ws: true,
          },
          '/ws/chat': {
            target: api,
            ws: true,
          },
          '/ws/itick': {
            target: api,
            ws: true,
          },
        } : {}),
      },
    },
  }
})
