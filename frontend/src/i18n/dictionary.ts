// Korean source text -> English translation, for fixed UI copy (buttons, labels,
// headers). Keyed by the exact Korean string already used as the JSX text, so
// wiring a component just wraps its literals in t(...) without inventing new key
// names. Dynamic content (stock names, news, comments) is translated separately —
// see useTranslatedText(s) — since it can't be known ahead of time.
export const DICTIONARY: Record<string, string> = {
  // Shared
  "메인으로": "Main",
  "홈": "Home",
  "실시간 시세, 시가총액 맵, 시총 대결까지 한눈에 보는 국내 증시 허브.":
    "Your hub for Korean stocks — live quotes, market-cap maps, and the market-cap battle, all in one place.",
  "본 서비스에서 제공하는 시세 및 데이터는 투자 참고용이며, 실제 매매 판단의 근거로 사용할 수 없습니다. 모든 투자 판단과 책임은 이용자 본인에게 있습니다.":
    "The quotes and data provided by this service are for reference only and must not be used as the basis for actual trading decisions. All investment decisions and responsibility rest with the user.",
  "데이터를 불러오는 중...": "Loading...",
  "불러오는 중...": "Loading...",
  "데이터를 불러오지 못했습니다.": "Failed to load data.",
  "삼성전자": "Samsung Electronics",
  "SK하이닉스": "SK Hynix",
  "닫기": "Close",
  "라이트 테마로 전환": "Switch to light theme",
  "다크 테마로 전환": "Switch to dark theme",

  // Dashboard stock header
  "추정PER": "Est. PER",
  "상장주식수": "Shares Outstanding",

  // Battle page (TugOfWarPage)
  "시총 줄다리기 (삼성전자 VS SK하이닉스)": "Market Cap Tug-of-War (Samsung Electronics VS SK Hynix)",
  "시총대결": "Market Cap Battle",
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

  // MarketCapFightPage
  "삼성 vs SK하이닉스": "Samsung vs SK Hynix",
  "1P를 선택하세요": "Choose Player 1",
  "2P를 선택하세요": "Choose Player 2",
  "대결 준비 중...": "Get ready...",
  "다시 선택": "Choose again",
  "시총 격차": "MARKET CAP GAP",
  "회사 정보 보기": "View company info",
  "주요뉴스": "Top News",
  "최근 뉴스가 없습니다.": "No recent news available.",
  "뉴스를 불러오지 못했습니다.": "Failed to load news.",
  "응원": "Cheer",
  "땡큐! 👍": "Thanks! 👍",
  "글로벌 TOP20 데이터를 불러오지 못했습니다.": "Failed to load the global TOP 20 data.",

  // GlobalTop20 / CompanyDetailModal
  "글로벌 시가총액 TOP 20": "Global Market Cap TOP 20",
  "세계 시총": "World Market Cap Rank #",
  "위": "",
  "회사 정보가 없습니다.": "No company information available.",
  "회사 정보를 불러오지 못했습니다.": "Failed to load company information.",

  // MarketMapPage (KOSPI MAP / KOSDAQ MAP)
  "종목 MAP": "Stocks MAP",
  "맵 보기": "Map View",
  "표로 보기": "Table View",
  "MAP 다운로드": "Download Map",
  "맵 이미지 미리보기": "Map Image Preview",
  "다운로드": "Download",
  "하락": "Down",
  "상승": "Up",
  "-5% ~ +5% 기준 포화": "Saturated at -5% ~ +5%",
  "종목명": "Name",
  "업종": "Sector",
  "시가총액": "Market Cap",
  "현재가": "Price",
  "등락률": "Change %",
  "등락": "Change",
  "맵 면적 비중": "Map Area Share",
  "시총 500개 종목 데이터를 불러오는 중...": "Loading data for the top 500 stocks by market cap...",
  "코스피 시가총액 상위 500개": "KOSPI Top 500",
  "코스닥 시총 200개 종목 데이터를 불러오는 중...": "Loading data for the top 200 KOSDAQ stocks by market cap...",
  "코스닥 시가총액 상위 200개": "KOSDAQ Top 200",

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
  "전체": "All",

  // Dashboard (App.tsx)
  "종목 검색시 현재 시세 및 등락률, 차트, 종목토론과 뉴스를 확인할 수 있습니다.":
    "Search for a stock to see its current price and change rate, chart, discussion board, and news.",
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
  "댓글": "Comments",
  "댓글을 불러오지 못했습니다.": "Failed to load comments.",
  "아직 댓글이 없습니다.": "No comments yet.",

  // SidePanel / OrderBookPanel
  "호가": "Order Book",
  "매도잔량": "Ask Qty",
  "매수잔량": "Bid Qty",
  "잔량합계": "Total Qty",
  "20분 전 시세, 실시간 갱신": "20-min delayed, live updates",
  "호가 데이터를 가져오지 못했습니다.": "Failed to load order book data.",

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
  "외국인 주간매수 TOP20": "Foreign Weekly Buy TOP20",
  "외국인 주간매도 TOP20": "Foreign Weekly Sell TOP20",
  "순위": "Rank",
  "외국인 순매수(억원)": "Foreign Net Buy (100M KRW)",
  "외국인 순매도(억원)": "Foreign Net Sell (100M KRW)",
  "최근 5거래일 기준 외국인 누적 순매수 상위 20종목입니다. · 종목명을 누르면 최근 추이를 볼 수 있습니다.":
    "Top 20 stocks by cumulative foreign net buy over the last 5 trading days · click a stock name to see its recent trend.",

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
  "펼치기": "Expand",
  "접기": "Collapse",

  // InvestorTrendPage
  "투자자별 매매동향": "Investor Trading Trend",
  "날짜별 개인·기관·외국인 순매수 금액(억원)입니다. 매수(+)는 빨간색, 매도(-)는 파란색으로 표시됩니다. 무료 공개 데이터의 한계로 하루 단위 집계이며, 장중 실시간(시간대별) 수급은 제공되지 않습니다.":
    "Daily net buy/sell amounts (100M KRW) by individual/institutional/foreign investors. Buying (+) is shown in red, selling (-) in blue. Due to limits of the free public data source, this is aggregated daily — intraday (hourly) flow isn't available.",
  "투자자 매매동향 데이터가 없습니다.": "No investor trading trend data available.",
  "날짜": "Date",
  "종가": "Close",
};
