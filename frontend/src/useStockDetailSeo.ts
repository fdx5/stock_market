import { useEffect } from "react";

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

export function useStockDetailSeo({ code, name, market, price, report = false }: { code: string; name?: string; market: "KR" | "US"; price?: number; report?: boolean }) {
  useEffect(() => {
    if (!name) return;
    const marketName = market === "US" ? "미국 주식" : "국내 주식";
    const title = report ? `${name}(${code}) 종목 한 장 보고서 | K-Stock Hub` : `${name}(${code}) 주가·차트·뉴스·종합정보 | K-Stock Hub`;
    const description = report ? `${name}(${code}) 가격 변화, 기간 수익률, 거래량, 기술 지표와 업종 비교 근거를 한 장 보고서로 확인하세요.` : `${name}(${code}) ${marketName} 현재가, 기술적 분석, 거래량, 기업정보, 관련뉴스, 종목토론과 일별 시세를 한 페이지에서 확인하세요.`;
    const url = `https://kospimap.com/stock/${encodeURIComponent(code)}${report ? "/report" : ""}`;
    document.title = title;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:url"]', "property", "og:url", url);
    setMeta('meta[property="og:type"]', "property", "og:type", "website");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", url);
    const id = "stock-detail-structured-data";
    document.getElementById(id)?.remove();
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: title,
      description,
      url,
      inLanguage: "ko-KR",
      about: { "@type": "Corporation", name, tickerSymbol: code },
      mainEntity: { "@type": "FinancialProduct", name: `${name} 주식`, tickerSymbol: code, category: marketName, ...(price ? { offers: { "@type": "Offer", price, priceCurrency: market === "US" ? "USD" : "KRW" } } : {}) },
    });
    document.head.appendChild(script);
    return () => script.remove();
  }, [code, market, name, price, report]);
}
