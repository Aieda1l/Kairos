import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
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
      config:config=>process.env.E2E_FIXTURES==="1"
        ?{
          vars:{
            ...config.vars,
            E2E_FIXTURES:"1",
            KAIROS_CREDENTIAL_KEY_V1:process.env.KAIROS_CREDENTIAL_KEY_V1??"",
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
