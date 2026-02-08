import type { APIRoute } from "astro";

const name = "Dhruv Chavda";
const description = "DevOps Engineer & CKA Certified Professional";
const pubDate = new Date();

const rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${name} - ${description}</title>
    <link>https://dhruvchavda.in</link>
    <description>${description}</description>
    <language>en-us</language>
    <lastBuildDate>${pubDate.toUTCString()}</lastBuildDate>
    <item>
      <title>${name} - DevOps Portfolio</title>
      <link>https://dhruvchavda.in</link>
      <pubDate>${pubDate.toUTCString()}</pubDate>
      <description>Portfolio of ${name}, a CKA certified DevOps/SRE Engineer with 3+ years of experience in Kubernetes, Docker, AWS, and cloud infrastructure.</description>
    </item>
  </channel>
</rss>`;

export const GET: APIRoute = () => {
  return new Response(rssContent, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
};
