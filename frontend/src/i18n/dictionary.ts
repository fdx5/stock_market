// Korean source text -> English translation, for fixed UI copy (buttons, labels,
// headers). Keyed by the exact Korean string already used as the JSX text, so
// wiring a component just wraps its literals in t(...) without inventing new key
// names. Dynamic content (stock names, news, comments) is translated separately —
// see useTranslatedText(s) — since it can't be known ahead of time.
export const DICTIONARY: Record<string, string> = {
  // Shared
  "메인으로": "Main",
  "데이터를 불러오는 중...": "Loading...",
  "불러오는 중...": "Loading...",
  "데이터를 불러오지 못했습니다.": "Failed to load data.",
  "삼성전자": "Samsung Electronics",
  "SK하이닉스": "SK Hynix",
  "닫기": "Close",

  // Dashboard stock header
  "추정PER": "Est. PER",
  "상장주식수": "Shares Outstanding",

  // Battle page (TugOfWarPage)
  "시총 줄다리기 (삼성전자 VS SK하이닉스)": "Market Cap Tug-of-War (Samsung Electronics VS SK Hynix)",
  "🔥 시총 줄다리기": "🔥 Market Cap Tug-of-War",
  "시가총액 데이터를 불러오지 못했습니다.": "Failed to load market cap data.",
  "2위": "#2",
  "차이": "difference",
  "환율 UP 👍": "FX UP 👍",
  "환율 DOWN 👎": "FX DOWN 👎",
  "환율(원)": "FX Rate (KRW)",

  // CheerSection
  "응원 댓글": "Cheer Comments",
  "응원 한마디 쓰고 회사 버튼을 눌러보세요": "Write a cheer message and tap a company button",
  "댓글을 등록하지 못했습니다.": "Failed to post the comment.",
  "삼성전자 응원 💙": "Cheer Samsung 💙",
  "SK하이닉스 응원 🧡": "Cheer SK Hynix 🧡",
  "더보기": "Load more",
  "감사합니다!!": "Thank you!!",
  "HBM 나 너무 좋아": "I love HBM so much",

  // GlobalTop20 / CompanyDetailModal
  "글로벌 시가총액 TOP 20": "Global Market Cap TOP 20",
  "세계 시총": "World Market Cap Rank #",
  "위": "",
  "회사 정보가 없습니다.": "No company information available.",
  "회사 정보를 불러오지 못했습니다.": "Failed to load company information.",

  // MarketMapPage (KOSPI MAP / KOSDAQ MAP)
  "종목을 업종별로 묶어 시가총액 크기, 등락률을 한눈에 보여줍니다. 타일을 클릭하면 해당 종목 상세로 이동합니다.":
    "Shows market-cap size and change rate at a glance, grouped by sector. Click a tile to view that stock's details.",
  "맵 보기": "Map View",
  "표로 보기": "Table View",
  "하락": "Down",
  "상승": "Up",
  "-5% ~ +5% 기준 포화": "Saturated at -5% ~ +5%",
  "종목명": "Name",
  "업종": "Sector",
  "시가총액": "Market Cap",
  "현재가": "Price",
  "등락률": "Change %",
  "등락": "Change",
  "시총 500개 종목 데이터를 불러오는 중...": "Loading data for the top 500 stocks by market cap...",
  "코스피 시가총액 상위 500개": "KOSPI top 500 by market cap",
  "코스닥 시총 200개 종목 데이터를 불러오는 중...": "Loading data for the top 200 KOSDAQ stocks by market cap...",
  "코스닥 시가총액 상위 200개": "KOSDAQ top 200 by market cap",

  // Sector labels (fixed, small set — see market_map.py's _SECTOR_KEYWORDS)
  "배터리": "Battery",
  "반도체/전자": "Semiconductor/Electronics",
  "제약/바이오": "Pharma/Bio",
  "자동차/조선": "Auto/Shipbuilding",
  "금융": "Finance",
  "화학/소재": "Chemicals/Materials",
  "철강/금속": "Steel/Metals",
  "기계/산업재": "Machinery/Industrials",
  "건설/부동산": "Construction/Real Estate",
  "에너지/유틸리티": "Energy/Utilities",
  "운송/물류": "Transport/Logistics",
  "IT서비스/미디어": "IT Services/Media",
  "식품/음료": "Food/Beverage",
  "유통/소비재": "Retail/Consumer Goods",
  "지주/서비스": "Holding/Services",
  "기타": "Other",

  // Dashboard (App.tsx)
  "종목을 검색하면 현재 시세와 등락률, 일봉 차트(최근 3개월 기본 표시, 최대 3년 조회), 최근 3일 뉴스 요약과 관련 뉴스를 한눈에 확인할 수 있습니다.":
    "Search for a stock to see its current price and change rate, a daily candlestick chart (3 months by default, up to 3 years), a 3-day news digest, and related news, all at a glance.",
  "종목을 검색해 주세요. (예: 삼성전자, 005930)": "Please search for a stock (e.g. Samsung Electronics, 005930)",

  // SidePanel / BoardPanel
  "종목토론방": "Discussion Board",
  "관련 뉴스": "Related News",
  "게시글을 불러오는 중...": "Loading posts...",
  "게시글을 불러오지 못했습니다.": "Failed to load posts.",
  "조회": "Views",
  "공감/비공감": "Likes/Dislikes",
  "(본문 없음)": "(No content)",
  "네이버에서 새 창으로 보기 ↗": "View on Naver in a new window ↗",

  // MarketOverviewPanel
  "코스피": "KOSPI",
  "코스닥": "KOSDAQ",
  "개인": "Individual",
  "외국인": "Foreign",
  "기관": "Institution",
  "코스피 · 코스닥 지수": "KOSPI · KOSDAQ Index",
  "지수 하단은 시장 전체 개인/외국인/기관 누적 순매수(억원)이며, 매수는 빨간색, 매도는 파란색입니다.":
    "Below each index is the market-wide cumulative net buy/sell (100M KRW) by individuals/foreign/institutional investors — red for net buying, blue for net selling.",
  "코스피 시총 50위": "KOSPI Top 50 by Market Cap",
  "코스닥 시총 50위": "KOSDAQ Top 50 by Market Cap",
  "종목별 투자자 매매동향": "Investor Activity by Stock",
  "기준 누적 순매수(억원)": "cumulative net buy/sell (100M KRW)",
  "최근 확정 거래일 기준 누적 순매수(억원)": "Cumulative net buy/sell (100M KRW), as of the last confirmed trading day",
  "시총 100위까지 · 종목명을 누르면 최근 추이를 볼 수 있습니다.":
    "Top 100 by market cap · click a stock name to see its recent trend.",

  // SearchBar
  "종목명 또는 코드 검색 (예: 삼성전자, 005930)": "Search by name or code (e.g. Samsung Electronics, 005930)",

  // PriceChart / IndicatorPanel
  "일봉 차트": "Daily Chart",
  "볼린저밴드(20,2)": "Bollinger Bands(20,2)",
  "보조 지표": "Indicators",
  "RSI(14) · 점선 30/70": "RSI(14) · dashed 30/70",
  "히스토그램(녹/적)": "Histogram (green/red)",
  "MACD 히스토그램": "MACD Histogram",
  "20일 변동성": "20-Day Volatility",
  "거래량/20일평균": "Volume / 20-Day Avg",

  // InvestorTrendPage
  "투자자별 매매동향": "Investor Trading Trend",
  "날짜별 개인·기관·외국인 순매수 금액(억원)입니다. 매수(+)는 빨간색, 매도(-)는 파란색으로 표시됩니다. 무료 공개 데이터의 한계로 하루 단위 집계이며, 장중 실시간(시간대별) 수급은 제공되지 않습니다.":
    "Daily net buy/sell amounts (100M KRW) by individual/institutional/foreign investors. Buying (+) is shown in red, selling (-) in blue. Due to limits of the free public data source, this is aggregated daily — intraday (hourly) flow isn't available.",
  "투자자 매매동향 데이터가 없습니다.": "No investor trading trend data available.",
  "날짜": "Date",
  "종가": "Close",
};
