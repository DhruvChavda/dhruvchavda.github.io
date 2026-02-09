import type { APIRoute } from "astro";

const name = "Dhruv Chavda";
const description = "DevOps/SRE & Platform Engineer | CKA • ICA Certified";
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
      <title>${name} - DevOps/SRE & Platform Engineer</title>
      <link>https://dhruvchavda.in</link>
      <pubDate>${pubDate.toUTCString()}</pubDate>
      <description>Portfolio of ${name}, a CKA & ICA certified DevOps/SRE and Platform Engineer specializing in Kubernetes, Docker, AWS, and platform automation.</description>
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
