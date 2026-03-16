# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio and blog site for Dhruv Chavda (dhruvchavda.in), built with Astro 5, Tailwind CSS 3, and TypeScript. Deployed to GitHub Pages via GitHub Actions on push to `main`.

## Commands

- **Dev server**: `npm run dev` (runs at localhost:4321)
- **Build**: `npm run build` (runs `astro check` then `astro build`, output in `dist/`)
- **Preview**: `npm run preview`
- **Format**: `npx prettier --write .`

There are no tests or linting scripts configured.

## Architecture

### Content System

Blog posts use Astro's content collections with a glob loader (`src/content.config.ts`). Posts live in `src/content/blog/` as Markdown/MDX files. Each post requires frontmatter: `title`, `description` (max 160 chars), `pubDate`, `category` (one of: DevOps, Kubernetes, Cloud, CI-CD, Platform-Engineering, Tutorials, Career, Tools), and optional `tags`, `heroImage`, `draft`, etc.

### Routing

- `src/pages/index.astro` — main portfolio page
- `src/pages/blogs/index.astro` — blog listing
- `src/pages/blogs/[slug].astro` — individual blog posts (dynamic route from content collection)
- `src/pages/blogs/category/` and `src/pages/blogs/tag/` — category/tag filtered views
- `src/pages/rss.xml.ts` — RSS feed endpoint
- `src/pages/404.astro` — custom 404

### Key Directories

- `src/components/` — Astro components for both the portfolio (About, Experience, Projects, Skills, Socials) and blog (`blog/` subdirectory)
- `src/constants/Tags.js` — centralized skill/technology tag definitions with associated icon components
- `src/icons/` — SVG icon components (imported by Tags.js and used throughout)
- `src/layouts/Layout.astro` — base layout with SEO meta tags, Open Graph, Twitter Cards, JSON-LD schema
- `src/utils/readingTime.ts` — blog post reading time calculator

### Styling

Tailwind CSS with `@tailwindcss/typography` plugin for blog prose styling. Dark mode enabled via `class` strategy. Font: Onest (variable, via `@fontsource-variable/onest`).

### Build

Vite with terser minification. Shiki code highlighting with `one-dark-pro` theme. Image optimization configured for `localhost` and `dhruvchavda.in` domains.

### Deployment

GitHub Actions workflow (`.github/workflows/deploy.yml`) triggers on push to `main`. Uses `withastro/action@v2` to build and `actions/deploy-pages@v4` to deploy.
