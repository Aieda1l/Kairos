import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  cacheDir:process.env.E2E_FIXTURES==='1'?process.env.KAIROS_E2E_CACHE_DIR:undefined,
  environments:{
    client:{
      optimizeDeps:{
        exclude:[
          "vinext",
          "vinext/shims/internal/app-prefetch-fetch-queue",
          "next/link",
          "next/navigation",
          "next/router",
          "next-auth",
        ],
      },
    },
  },
  plugins: [
    vinext(),
    cloudflare({
      persistState:process.env.KAIROS_E2E_PERSIST_PATH
        ?{path:process.env.KAIROS_E2E_PERSIST_PATH}
        :true,
      config:config=>process.env.E2E_FIXTURES==="1"
        ?{
          vars:{
            ...config.vars,
            E2E_FIXTURES:"1",
            KAIROS_CREDENTIAL_KEY_V1:process.env.KAIROS_CREDENTIAL_KEY_V1??"",
            KAIROS_CREDENTIAL_KEY_V2:'',
            KAIROS_CREDENTIAL_ACTIVE_KEY_ID:'v1',
            // Synthetic local bindings; guarded operations still use real D1 admission.
            KAIROS_ABUSE_KEY_V1:Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
            KAIROS_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',
            KAIROS_TURNSTILE_SECRET_KEY:'1x0000000000000000000000000000000AA',
            GOOGLE_CALENDAR_CLIENT_ID:'kairos-e2e-calendar-client',
            AUTH_SECRET:process.env.AUTH_SECRET??"kairos-e2e-auth-secret",
            AUTH_GOOGLE_ID:process.env.AUTH_GOOGLE_ID??"kairos-e2e-google-id",
            AUTH_GOOGLE_SECRET:process.env.AUTH_GOOGLE_SECRET??"kairos-e2e-google-secret",
            AUTH_MICROSOFT_ENTRA_ID_ID:
              process.env.AUTH_MICROSOFT_ENTRA_ID_ID??"kairos-e2e-microsoft-id",
            AUTH_MICROSOFT_ENTRA_ID_SECRET:
              process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET??"kairos-e2e-microsoft-secret",
          },
        }
        :{},
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
