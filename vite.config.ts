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
            KAIROS_E2E_USER_ID:process.env.KAIROS_E2E_USER_ID??"kairos-e2e-user",
            KAIROS_CREDENTIAL_KEY_V1:process.env.KAIROS_CREDENTIAL_KEY_V1??"",
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
