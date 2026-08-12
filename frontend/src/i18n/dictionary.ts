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

  // Dashboard zones
  "마켓 개요": "Market Overview",
  "종목 상세": "Stock Detail",
  "글로벌 지수": "Global Indices",

  // Quick access strip / search suggestions
  "실시간 인기": "Trending",
  "종목 레이더": "Stock radar",
  "상승 폭넓음": "Broad advance",
  "상승 우세": "Advancing",
  "혼조세": "Mixed",
  "하락 우세": "Declining",
  "하락 폭넓음": "Broad decline",
  "미국 지수": "US indices",
  "S&P 500 + 나스닥 100": "S&P 500 + NASDAQ 100",
  "상승 TOP": "Top gainers",
  "하락 TOP": "Top losers",
  "업종별 등락": "By sector",
  "범위": "Scope",
  "프리마켓 기준": "Pre-market",
  "애프터마켓 기준": "After hours",
  "정규장 기준": "Regular session",
  "오늘의 주목 종목": "Today's stocks in focus",
  "주목 종목": "In focus",
  "프리장 기준": "Pre-market",
  "장중 기준": "Intraday",
  "장 마감 기준": "Session close",
  "상승률과 거래대금을 기준으로 지수별 3종목을 선별합니다.": "Three per board, selected on move and turnover.",
  "프리마켓 상승률을 기준으로 지수별 3종목을 선별합니다.":
    "Three per board, selected on the pre-market move.",
  "시장 폭": "Market breadth",
  "시장 체온": "Market temperature",
  "지수 쏠림": "Cap tilt",
  /* "시총가중" is already carried further down, for the treemap legend. */
  "동일가중": "Equal-weighted",
  "격차": "Spread",
  "대형주 우위": "Large caps ahead",
  "중소형주 우위": "Small caps ahead",
  "고른 흐름": "Evenly spread",
  "코스피+코스닥": "KOSPI+KOSDAQ",
  "주도 업종": "Leading sectors",
  "부진 업종": "Lagging sectors",
  "마켓 펄스": "Market pulse",
  "수급 · 순위": "Flows & rankings",
  "구역 이동": "Jump to section",
  "종목 · 페이지 바로가기": "Go to stock or page",
  "종목명, 종목코드, 페이지 이름": "Stock name, code, or page",
  "결과가 없습니다.": "No results.",
  "어디서든 열기": "Open anywhere",
  "아직 집계된 인기 종목이 없습니다.": "No popular stocks yet.",
  "최근 살펴본 종목이 여기에 쌓입니다.": "Stocks you view will collect here.",
  "이상": "or more",
  "이하": "or less",
  "종목": " stocks",
  "이동": "Move",
  "열기": "Open",
  "최근 본 종목": "Recently Viewed",
  "기록 삭제": "Clear",
  // Short forms for the mobile tab strip, where the labels above are too long to
  // fit three tabs across a phone.
  "인기": "Hot",
  "관심": "Saved",
  "최근": "Recent",

  // Macro rates strip (USD/KRW, WTI). The first tile cycles through these four FX
  // crosses; JPY is quoted per 100 yen.
  "원/달러 환율": "USD/KRW",
  "원/엔 환율": "JPY/KRW",
  "원/유로 환율": "EUR/KRW",
  "원/파운드 환율": "GBP/KRW",
  "100엔": "per 100",
  "국제유가": "Crude Oil",

  // US extended-hours session badge, and the regular/extended split that goes with it
  // — the maps, the NASDAQ board and the /global header all quote an after-hours price
  // against the previous regular close, then break the two legs apart underneath.
  "프리장": "Pre-market",
  "애프터장": "After-hours",
  "정규장": "Regular",
  "미국 정규장 시간외 거래": "Traded outside US regular hours",
  "정규장 종가 + 시간외 변동 반영": "Regular close plus extended-hours move",

  // Market session status
  "장중": "Open",
  "장마감": "Closed",
  "장 시작 전": "Pre-market",

  // Gainers / losers tab
  "급등 TOP": "Top Gainers",
  "급락 TOP": "Top Losers",
  "코스피·코스닥 시총 200위 이내 종목의 당일 등락률 순위입니다. · KP=코스피, KQ=코스닥":
    "Ranked by today's move among the top 200 stocks by market cap on each board. · KP=KOSPI, KQ=KOSDAQ",

  // Technical signal badges
  "정배열": "Bullish MA Stack",
  "역배열": "Bearish MA Stack",
  "5일선 > 20일선 > 60일선": "MA5 > MA20 > MA60",
  "5일선 < 20일선 < 60일선": "MA5 < MA20 < MA60",
  "골든크로스": "Golden Cross",
  "데드크로스": "Death Cross",
  "5일선이 20일선을 상향 돌파": "MA5 crossed above MA20",
  "5일선이 20일선을 하향 돌파": "MA5 crossed below MA20",
  "과매수": "Overbought",
  "과매도": "Oversold",
  "중립": "Neutral",
  "RSI(14) · 70 이상 과매수, 30 이하 과매도": "RSI(14) · 70+ overbought, 30- oversold",
  "볼린저 상단": "Above Upper Band",
  "볼린저 하단": "Below Lower Band",
  "종가가 볼린저밴드 상단 위": "Close is above the upper Bollinger band",
  "종가가 볼린저밴드 하단 아래": "Close is below the lower Bollinger band",
  "거래량 급증": "Volume Spike",
  "20일 평균 거래량 대비": "vs. the 20-day average volume",

  // 공매도 수급 — the side panel's last tab, right of 호가. "잔고" is rendered as
  // "Balance" rather than "Outstanding" because the column is a share count on a given
  // date, not an amount owed.
  // The tab label names both upstreams the panel merges, since 대차잔고 is not a 공매도
  // figure and a reader looking for it would not think to open a tab called 공매도.
  "공매도/대차": "Shorts & Lending",
  "공매도 거래량": "Short Volume",
  "공매도 비중": "Short % of Volume",
  "공매도 거래대금": "Short Value",
  "업틱룰 적용": "Uptick Rule Applied",
  "업틱룰 예외": "Uptick Rule Exempt",
  "그날 공매도로 체결된 수량(주). 쌓여 있는 잔고가 아니라 하루치 거래입니다.":
    "Shares sold short that session. A single day's trading, not a standing position.",
  "그날 전체 거래량에서 공매도가 차지한 비율(%).":
    "Short sales as a share of that session's total volume.",
  "그날 공매도로 체결된 금액(원).": "Value of the shares sold short that session, in won.",
  "직전가 이하 호가를 금지하는 업틱룰이 적용된 공매도 수량(주).":
    "Shares sold short under the uptick rule, which bars quoting at or below the last price.",
  "차익거래·헤지 등으로 업틱룰이 면제된 공매도 수량(주).":
    "Shares sold short while exempt from the uptick rule, e.g. arbitrage and hedging.",
  // 대차잔고 is live, sourced from SEIBro rather than KRX.
  "대차잔고": "Securities Lending",
  "기관이 빌려간 주식 잔고(주). 공매도의 선행지표로 읽습니다.":
    "Shares currently borrowed by institutions. Read as a leading indicator of short selling.",
  // Reserved series — typed and translated, but no free source publishes them per
  // stock, so they never reach the panel. See backend balance_fetcher.
  "공매도잔고": "Short Interest",
  "신용융자잔고": "Margin Loans",
  "공매도 미상환 잔고(주).": "Shares sold short and not yet covered.",
  "개인이 증권사에서 빌려 산 잔고(주).": "Shares bought with money borrowed from a broker.",
  // "일자" is already carried by the DailyPricePanel block below, same translation.
  "수량": "Quantity",
  "전일 대비": "Change",
  "증감률": "Change %",
  "공시된 공매도 데이터가 없습니다.":
    "No short selling figures have been published for this stock.",
  "공매도 데이터를 가져오지 못했습니다.": "Failed to load short selling data.",

  // Order book balance bar
  "호가 잔량": "Order Book Depth",
  "매수 우위": "Bids Lead",
  "매도 우위": "Asks Lead",
  "매수": "Bid",
  "매도": "Ask",

  // Battle page (TugOfWarPage)
  "시총 줄다리기 (삼성전자 VS SK하이닉스)": "Market Cap Tug-of-War (Samsung Electronics VS SK Hynix)",
  "시총대결": "Market Cap Battle",
  "AI 예측": "AI Forecast",
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

  // NewsPage
  "글로벌 뉴스": "Global News",

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
  "목록으로": "Back to list",
  "본문을 불러오지 못했습니다. 원문에서 확인해 주세요.": "Couldn't load the full article — please check the original.",
  "원문에서 보기": "View original",
  "응원": "Cheer",
  "땡큐! 👍": "Thanks! 👍",
  "글로벌 TOP20 데이터를 불러오지 못했습니다.": "Failed to load the global TOP 20 data.",

  // GlobalTop20 / CompanyDetailModal
  "글로벌 시가총액 TOP 20": "Global Market Cap TOP 20",
  "세계 시총": "World Market Cap Rank #",
  "위": "",
  "회사 정보가 없습니다.": "No company information available.",
  "회사 정보를 불러오지 못했습니다.": "Failed to load company information.",

  // GlobalTop100Page
  "글로벌 시총": "Global Cap",
  "글로벌 시가총액 TOP 100": "Global Market Cap TOP 100",
  "전 세계 시가총액 상위 100개 기업의 순위·주가·재무지표를 제공합니다.":
    "Ranking, prices, and fundamentals for the world's 100 largest companies by market cap.",
  "종목명 · 심볼 검색": "Search by name or symbol",
  "글로벌 시가총액 TOP 100을 불러오는 중입니다…": "Loading the global TOP 100…",
  "서버가 데이터를 처음 준비하는 중입니다. 최대 몇 분 정도 걸릴 수 있어요.":
    "The server is preparing this data for the first time — this can take a few minutes.",
  "순위·국가·로고는 companiesmarketcap.com, 시세는 Yahoo Finance 기준이며 20초마다 갱신됩니다. 순위 변동은 전일 대비이며, 서비스 시작 첫날은 비교 대상이 없어 전 종목 신규로 표시됩니다.":
    "Rank, country, and logos are sourced from companiesmarketcap.com; prices from Yahoo Finance, refreshed every 20 seconds. Rank change is versus the previous day — on launch day there is no prior data yet, so every row shows as new.",
  "당일 등락률순": "By today's change",
  "순위 상승순": "By rank gain",
  "PER 낮은순": "By lowest PER",
  "이름순": "By name",
  "1일": "1D",
  "7일": "7D",
  "6개월": "6M",
  "1년": "1Y",
  "전체기간": "All-time",
  "희석 EPS": "Diluted EPS",
  "순마진": "Net Margin",
  "EPS 성장률": "EPS Growth",
  "애널리스트 의견": "Analyst Rating",

  // MarketMapPage (KOSPI MAP / KOSDAQ MAP)
  "종목 MAP": "Stocks MAP",
  "맵 보기": "Map View",
  "표로 보기": "Table View",
  "MAP 다운로드": "Download Map",
  "맵 이미지 미리보기": "Map Image Preview",
  "다운로드": "Download",
  "저장 중...": "Saving...",
  "저장": "Save",
  "저장에 실패했습니다. 이미지를 길게 눌러 저장해 주세요.":
    "Couldn't save. Press and hold the image to save it.",
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
  // Index tiles — only the number links out to the index chart page
  "지수 차트 보기": "view index chart",
  // Dashboard sector map (the treemap beside the chart column)
  "업종 맵": "Sector Map",
  "같은 업종의 종목을 찾지 못했습니다.": "No peers found in this sector.",
  // Mobile bottom stock bar
  "이번 접속 동안 숨기기": "Hide for this visit",
  "시총 500개 종목 데이터를 불러오는 중...": "Loading data for the top 500 stocks by market cap...",
  "코스피 시가총액 상위 500개": "KOSPI Top 500",
  "코스닥 시총 200개 종목 데이터를 불러오는 중...": "Loading data for the top 200 KOSDAQ stocks by market cap...",
  "코스닥 시가총액 상위 200개": "KOSDAQ Top 200",
  "S&P500 종목 데이터를 불러오는 중...": "Loading S&P 500 stock data...",
  "S&P500 지수 구성 500개": "S&P 500 (all 500 constituents)",
  "나스닥100 종목 데이터를 불러오는 중...": "Loading NASDAQ-100 stock data...",
  "나스닥100 지수 구성 100개": "NASDAQ-100 (all 100 constituents)",
  "지수 내 비중": "Index Weight",

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

  // GICS sector labels — the NASDAQ board's own classification (see
  // stock_board.py's _US_SECTOR_KO for why it keeps GICS rather than being
  // remapped onto the KRX buckets above). 금융 and 기타 are shared with that set.
  "정보기술": "Information Technology",
  "커뮤니케이션": "Communication Services",
  "임의소비재": "Consumer Discretionary",
  "필수소비재": "Consumer Staples",
  "헬스케어": "Health Care",
  "산업재": "Industrials",
  "에너지": "Energy",
  "유틸리티": "Utilities",
  "소재": "Materials",
  "부동산": "Real Estate",

  // TOP 100 card boards (/kospi-100, /kosdaq-100, /nasdaq-100)
  "코스피 100": "KOSPI 100",
  "코스닥 100": "KOSDAQ 100",
  "나스닥 100": "NASDAQ 100",
  "코스피 시가총액 상위 100종목을 업종별로": "The 100 largest KOSPI stocks, grouped by sector",
  "코스닥 시가총액 상위 100종목을 업종별로": "The 100 largest KOSDAQ stocks, grouped by sector",
  "나스닥100 지수 편입 상위 100종목을 업종별로": "The 100 largest NASDAQ-100 members, grouped by sector",
  "코스피 상위 100종목을 불러오는 중...": "Loading the KOSPI top 100...",
  "코스닥 상위 100종목을 불러오는 중...": "Loading the KOSDAQ top 100...",
  "나스닥 상위 100종목을 불러오는 중...": "Loading the NASDAQ top 100...",
  "시장 선택": "Choose a market",
  "시총가중 평균 등락": "Cap-weighted average change",
  "시총가중": "cap-weighted",
  "보합": "Flat",
  "종목 검색": "Search stocks",
  "종목명 · 코드 검색": "Search by name or code",
  "정렬": "Sort",
  "시가총액순": "By market cap",
  "상승률순": "Top gainers",
  "하락률순": "Top losers",
  "거래량순": "By volume",
  "52주 고점 근접순": "Closest to 52-week high",
  "1개월 수익률순": "By 1-month return",
  "업종별": "By sector",
  "전체 순위": "Full ranking",
  "카드": "Cards",
  "간략히": "Compact",
  "시장 대비": "vs market",
  "52주 범위": "52-week range",
  "고점 대비": "off high",
  "현재": "now",
  "1주": "1W",
  "1개월": "1M",
  "3개월": "3M",
  "연초": "YTD",
  "최근 3개월 종가 추이": "Closing prices over the last three months",
  "차트 데이터 없음": "No chart data",
  "조건에 맞는 종목이 없습니다.": "No stocks match these filters.",
  "KOSPI MAP": "KOSPI MAP",
  "NASDAQ MAP": "NASDAQ MAP",
  "시세·시가총액은 실시간(장중 10초 갱신), 차트·52주 범위·기간수익률은 일봉 종가 기준입니다. 기간수익률은 거래일 기준(1주=5거래일, 1개월=21거래일, 3개월=63거래일)이며 연초수익률은 전년도 종가 대비입니다.":
    "Price and market cap are live (refreshed every 10s during the session); the chart, the 52-week range and the trailing returns are computed from daily closes. Trailing returns are measured in trading sessions (1W = 5, 1M = 21, 3M = 63); YTD is measured against last year's closing price.",

  // Dashboard (App.tsx)
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
  "휴장 중에는 호가 정보가 제공되지 않습니다.": "Order book data isn't available while the market is closed.",

  // SidePanel / DailyPricePanel
  "일별": "Daily",
  "일자": "Date",
  "주가": "Close",
  "대비": "Change",
  "거래량": "Volume",
  "거래대금": "Value",
  "시가": "Open",
  "고가": "High",
  "저가": "Low",
  // Abbreviated forms for the daily table's second line, where the full labels do not
  // fit the rail at its narrowest — see DailyPricePanel.tsx.
  "시": "O",
  "고": "H",
  "저": "L",
  "대금": "Val",
  "일별 시세가 없습니다.": "No daily prices available.",
  "일별 시세를 불러오지 못했습니다.": "Failed to load daily prices.",
  "거래대금은 거래량 × 평균가 기준 추정치입니다.":
    "Value is an estimate (volume x average price), not the exchange's published figure.",

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

  // 원자재 패널 (선물가격 · D램 현물가격) / D램 이력 페이지
  "원자재": "Commodities",
  "선물가격": "Futures",
  "D램 현물가격": "DRAM Spot",
  "일중 고가": "Day high",
  "일중 저가": "Day low",
  "변동률": "Change %",
  "기준일": "As of",
  "10초마다 갱신 · 가격은 지연될 수 있습니다": "Refreshed every 10s · prices may be delayed",
  "선물 시세를 불러오는 중...": "Loading futures prices...",
  "선물 시세를 불러오지 못했습니다.": "Could not load futures prices.",
  "표시할 D램 현물가격이 없습니다.": "No DRAM spot prices to show.",
  "이력": "History",
  "D램 현물가격 이력": "DRAM Spot Price History",
  "TrendForce 일별 현물가 · 수집된 전체 기간": "TrendForce daily spot prices · full recorded period",
  "아직 수집된 이력이 없습니다.": "No history has been recorded yet.",
  "표시 기준": "Measure",
  "기간": "Period",
  "가격": "Price",
  "지수": "Index",
  "품목": "Item",
  "시작": "Start",
  "기간 등락": "Period change",
  "최근 일간": "Latest daily",
  "기간 요약": "Period summary",
  "일": " days",
  "각 품목의 기간 첫날을 100으로 환산했습니다. 가격대가 다른 품목의 등락을 같은 축에서 비교합니다.":
    "Each item is rebased to 100 at the first day in range, so items at different price levels can be compared on one axis.",
  "실제 현물가(USD)입니다. 품목별 가격대 차이가 커서 저가 품목의 움직임은 지수 보기가 더 잘 보입니다.":
    "Actual spot prices in USD. Price levels differ widely between items, so the index view shows the cheaper items' movement more clearly.",
};
