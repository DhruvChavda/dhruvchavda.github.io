import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
    heroImageAlt: z.string().optional().default("Blog post hero image"),
    category: z.enum([
      "DevOps",
      "Kubernetes",
      "Cloud",
      "CI-CD",
      "Platform-Engineering",
      "Tutorials",
      "Career",
      "Tools",
    ]),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    author: z.string().default("Dhruv Chavda"),
  }),
});

export const collections = { blog };
