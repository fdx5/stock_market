import type { NewsItem } from "../api/client";

export default function NewsPanel({ items, name }: { items: NewsItem[]; name: string }) {
  return (
    <div className="card news-panel">
      <h2>{name} 관련 뉴스</h2>
      {items.length === 0 ? (
        <div className="empty-state">최근 뉴스를 가져오지 못했습니다.</div>
      ) : (
        <div className="news-list">
          {items.map((item, idx) => (
            <a key={idx} className="news-item" href={item.link} target="_blank" rel="noreferrer">
              <div className="title">{item.title}</div>
              <div className="meta">
                <span>{item.press}</span>
                <span>{item.date}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
