import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const siteConfig = JSON.parse(
  readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  site: siteConfig.siteUrl,
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'auto',
  },
});
