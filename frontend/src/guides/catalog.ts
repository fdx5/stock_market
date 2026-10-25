import catalog from "./market-guides.json";

export const guideCatalog = catalog;
export const guidePath = (slug: string) => `/guides/${slug}`;
export const GUIDE_SEO: Record<string, { title: string; description: string }> = {
  "/guides": { title: `${catalog.title} | K-Stock Hub`, description: catalog.description },
  ...Object.fromEntries(catalog.guides.map(guide => [guidePath(guide.slug), { title: `${guide.title} | K-Stock Hub`, description: guide.description }])),
};

export function guideStructuredData(path: string) {
  const site = "https://kospimap.com";
  const guide = catalog.guides.find(item => guidePath(item.slug) === path);
  const page = {
    "@type": guide ? "Article" : "CollectionPage",
    [guide ? "headline" : "name"]: guide?.title ?? catalog.title,
    description: guide?.description ?? catalog.description,
    url: `${site}${path}`, inLanguage: "ko-KR", isAccessibleForFree: true,
    ...(guide ? {
      datePublished: catalog.updated, dateModified: catalog.updated,
      mainEntityOfPage: { "@type": "WebPage", "@id": `${site}${path}` },
      author: { "@type": "Organization", name: "K-Stock Hub", url: site },
    } : {}),
  };
  const crumbs = [
    { "@type": "ListItem", position: 1, name: "K-Stock Hub", item: `${site}/` },
    { "@type": "ListItem", position: 2, name: catalog.title, item: `${site}/guides` },
    ...(guide ? [{ "@type": "ListItem", position: 3, name: guide.title, item: `${site}${path}` }] : []),
  ];
  return { "@context": "https://schema.org", "@graph": [page, { "@type": "BreadcrumbList", itemListElement: crumbs }] };
}
