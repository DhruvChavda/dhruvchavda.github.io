import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";
import mdx from "@astrojs/mdx";

// https://astro.build/config
export default defineConfig({
  site: "https://dhruvchavda.in",
  integrations: [tailwind(), sitemap(), mdx()],
  markdown: {
    shikiConfig: {
      theme: "one-dark-pro",
      wrap: true,
    },
  },
  image: {
    domains: ["localhost", "dhruvchavda.in"],
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
