import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * OAuth2 PKCE token exchange CORS proxy.
 * Tarayıcı -> POST /hipcall-oauth/token (client_id + code + code_verifier, client_secret YOK)
 * Dev server -> CORS engeline takılmaması için isteği Hipcall token adresine iletir (VITE_HIPCALL_REGION: global = use.hipcall.com, tr = use.hipcall.com.tr)
 */
function hipcallOrigin(env: Record<string, string>): string {
  return env.VITE_HIPCALL_REGION === 'tr' ? 'https://use.hipcall.com.tr' : 'https://use.hipcall.com';
}

function hipcallOAuthProxy(env: Record<string, string>): Plugin {
  const tokenUrl = env.VITE_HIPCALL_TOKEN_URL || `${hipcallOrigin(env)}/oauth/token`;
  return {
    name: 'hipcall-oauth-proxy',
    configureServer(server) {
      server.middlewares.use('/hipcall-oauth/token', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('Method Not Allowed');
        }
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(raw);
            if (!params.get('client_id') && env.VITE_HIPCALL_CLIENT_ID) {
              params.set('client_id', env.VITE_HIPCALL_CLIENT_ID);
            }
            // PKCE akışında client_secret gönderilmez (yalnızca açıkça tanımlanmışsa eklenir)
            if (env.HIPCALL_CLIENT_SECRET) {
              params.set('client_secret', env.HIPCALL_CLIENT_SECRET);
            } else {
              params.delete('client_secret');
            }
            const upstream = await fetch(tokenUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
              body: params.toString(),
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
            res.end(text);
          } catch (e) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'proxy_error', error_description: String(e) }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = new URL(env.VITE_HIPCALL_API_BASE_URL || `${hipcallOrigin(env)}/api/v3`);
  return {
    plugins: [hipcallOAuthProxy(env)],
    server: {
      port: 5173,
      host: true,
      // ngrok host'una izin ver
      allowedHosts: [env.NGROK_HOST || 'envelope-footrest-flyable.ngrok-free.dev', '.ngrok-free.dev', '.ngrok.app'],
      proxy: {
        // API CORS sorunu için: /hipcall-api/* -> <Hipcall API>/api/v3/*
        '/hipcall-api': {
          target: apiTarget.origin,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/hipcall-api/, apiTarget.pathname.replace(/\/$/, '')),
        },
      },
    },
  };
});
