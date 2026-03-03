import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const allPosts = await getCollection("blog");
  const posts = allPosts
    .filter((post: any) => !post.data.draft)
    .sort(
      (a: any, b: any) =>
        b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
    );

  return rss({
    title: "Dhruv Chavda's Blogs",
    description:
      "DevOps, Kubernetes, and Platform Engineering insights by Dhruv Chavda.",
    site: context.site!,
    items: posts.map((post: any) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/blogs/${post.id}/`,
      categories: [post.data.category, ...post.data.tags],
    })),
  });
}
