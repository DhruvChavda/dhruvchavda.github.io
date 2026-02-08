import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
  site: "https://dhruvchavda.github.io",
  integrations: [tailwind()],
  image: {
    domains: ["localhost", "dhruvchavda.github.io"],
    cacheDir: "./.astro/image",
  },
  vite: {
    build: {
      minify: "terser",
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["@fontsource-variable/onest"],
          },
        },
      },
    },
    ssr: {
      external: ["svgo"],
    },
  },
});
