# Personal Portfolio

Welcome to my personal portfolio! This project is built using Astro.js, a modern static site generator optimized for performance and SEO. It showcases my experience as a DevOps/SRE Engineer with expertise in Kubernetes, Docker, AWS, and cloud infrastructure.

## ✨ Features

- **Astro.js**: Modern static site generation for blazing-fast load times
- **Responsive Design**: Perfectly optimized for all devices - desktop, tablet, and mobile
- **Modern UI**: Clean, minimalistic design with smooth animations and transitions
- **Fully SEO Optimized**: 
  - Open Graph and Twitter Card meta tags
  - JSON-LD schema markup (Person schema)
  - XML sitemap and robots.txt
  - Proper heading hierarchy and semantic HTML
  - Image alt text and descriptive metadata
- **Zero JavaScript Overhead**: Static HTML output with minimal client-side scripts
- **Tailwind CSS**: Utility-first CSS for rapid, maintainable styling
- **TypeScript**: Full type safety for better development experience
- **Reusable Components**: Modular Astro components for code reusability

## 🛠️ Technologies Used

- **Astro.js (v4.8.3)**: The main framework for static site generation
- **TypeScript (v5.4.5)**: Type-safe JavaScript
- **Tailwind CSS (v3.4.3)**: Utility-first CSS framework
- **@astrojs/tailwind**: Seamless Tailwind integration with Astro
- **@fontsource-variable/onest**: Variable font for responsive typography

## 🚀 Getting Started

### Prerequisites

- Node.js (>= 14.x)
- npm (>= 6.x), yarn (>= 1.x), or bun (>= 0.2.2)

### Installation

Clone the repository:

```bash
git clone https://github.com/DhruvChavda/dhruvchavda.github.io.git
cd dhruvchavda.github.io
```

Install dependencies:

```bash
npm install
```

> You can also use `yarn` or `bun` instead of `npm`

### Development

Start the development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:4321` to see your portfolio in action.

### Production Build

Build the project for production:

```bash
npm run build
```

The optimized static files will be generated in the `dist` directory, ready for deployment.

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

## 📁 Project Structure

```bash
/
├── public/                      # Static assets served as-is
│   ├── pictures/               # Profile and project images
│   ├── projects/               # Project screenshots
│   ├── favicon.svg             # Site favicon
│   ├── robots.txt              # Search engine crawling rules
│   └── sitemap.xml             # XML sitemap for SEO
├── src/
│   ├── components/             # Reusable Astro components
│   │   ├── About.astro         # About section
│   │   ├── Badge.astro         # Badge component
│   │   ├── Card.astro          # Card component
│   │   ├── Experience.astro    # Experience section
│   │   ├── ExperienceItem.astro # Experience item component
│   │   ├── Footer.astro        # Footer component
│   │   ├── Header.astro        # Header/Navigation
│   │   ├── Highlight.astro     # Text highlight component (DRY utility)
│   │   ├── Projects.astro      # Projects section
│   │   ├── Schema.astro        # JSON-LD schema component
│   │   ├── SectionContainer.astro # Section wrapper
│   │   ├── Skills.astro        # Skills showcase
│   │   ├── SocialPill.astro    # Social link button
│   │   ├── Socials.astro       # Social links section
│   │   └── Tag.astro           # Tag/badge component
│   ├── constants/
│   │   └── Tags.js             # Centralized skill tags (DevOps-focused)
│   ├── icons/                  # SVG icon components (30+ icons)
│   ├── layouts/
│   │   └── Layout.astro        # Main layout with SEO meta tags
│   └── pages/
│       ├── index.astro         # Home/portfolio page
│       ├── 404.astro           # Custom 404 error page
│       └── rss.xml.ts          # RSS feed endpoint
├── astro.config.mjs            # Astro configuration
├── tailwind.config.mjs         # Tailwind CSS configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Project dependencies
└── README.md                   # This file
```

## 🎨 Key Components

### Highlight Component
Reusable text highlighting component that eliminates repetitive inline styles. Supports multiple color variants (yellow, green, white) for consistent styling.

### Schema Component
Implements JSON-LD Person schema for structured data, improving search engine understanding and enabling rich snippets.

### Responsive Layout
Built-in Layout component provides consistent structure with comprehensive SEO metadata:
- Canonical URLs
- Open Graph tags (og:title, og:description, og:image, og:locale)
- Twitter Card tags
- Author and keyword metadata
- Mobile viewport configuration

## 📊 SEO Features

- ✅ **Structured Data**: JSON-LD Person schema with all key information
- ✅ **Meta Tags**: Comprehensive meta tags for search engines and social media
- ✅ **Open Graph**: Full OG support for optimized social media sharing
- ✅ **Twitter Cards**: Enhanced Twitter preview with large image card
- ✅ **Sitemap**: XML sitemap with image sitemap entries
- ✅ **Robots.txt**: Proper crawling rules for search engines
- ✅ **RSS Feed**: Content distribution via RSS
- ✅ **Mobile Friendly**: Responsive design with proper viewport settings
- ✅ **Semantic HTML**: Proper heading hierarchy and semantic elements
- ✅ **Image Optimization**: Descriptive alt text and image schemas

## 📝 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server at localhost:4321 |
| `npm run build` | Build optimized production bundle |
| `npm run preview` | Preview production build locally |
| `npm run astro` | Run Astro CLI commands directly |

## 🔧 Customization

### Updating Skills
Edit `src/constants/Tags.js` to add or modify skills. Each skill includes:
- Display name
- Associated icon component
- Organized by category (DevOps, CI/CD, Languages, etc.)

### Adding Projects
Modify `src/components/Projects.astro` to showcase new projects with:
- Title and description
- Associated technologies/tags
- Links and images
- Timeline information

### Changing Colors
Update Tailwind classes in components. The color scheme uses:
- `text-yellow-200` for highlights
- `text-green-300` for secondary highlights
- `text-white` for primary text

## 🤝 Contributing

Contributions are welcome! To contribute:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/YourFeature`
3. **Commit** your changes: `git commit -m 'Add YourFeature'`
4. **Push** to the branch: `git push origin feature/YourFeature`
5. **Open** a Pull Request with a clear description of changes

Please ensure:
- Code follows the existing style
- Documentation is updated
- The project builds successfully with `npm run build`

## 📄 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 👨‍💻 Author

**Dhruv Chavda** - DevOps/SRE Engineer
- LinkedIn: [dhruvchavda2712](https://www.linkedin.com/in/dhruvchavda2712/)
- GitHub: [DhruvChavda](https://github.com/DhruvChavda)
- Medium: [@chavdadhruv0505](https://medium.com/@chavdadhruv0505)
- Credly: [Certifications](https://www.credly.com/users/dhruvchavda)
- Email: chavdadhruv0505@gmail.com

## 📚 Resources

- [Astro Documentation](https://docs.astro.build)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Schema.org Schemas](https://schema.org/)

---

**Last Updated**: February 8, 2026

