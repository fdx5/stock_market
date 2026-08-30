import datetime as dt
import logging
import os
import threading
import time
from pathlib import Path
from zoneinfo import ZoneInfo

from app.services import market_brief_store

KST = ZoneInfo("Asia/Seoul")
log = logging.getLogger(__name__)

EXPORTS_DIR = Path("i:/ai_root/stock_market/exports/naver_blog")

TARGET_CONFIG = [
    {
        "market": "KOSPI",
        "folder": "1.코스피",
        "name": "코스피 (KOSPI)",
        "type": "index",
        "keywords": ["코스피", "코스피전망", "코스피지수", "오늘주식시장", "외국인순매수", "국내증시", "주식시황", "장마감브리핑", "KOSPI"],
    },
    {
        "market": "KOSDAQ",
        "folder": "2.코스닥",
        "name": "코스닥 (KOSDAQ)",
        "type": "index",
        "keywords": ["코스닥", "코스닥지수", "코스닥전망", "2차전지", "바이오주", "성장주", "코스닥마감", "주식투자", "KOSDAQ"],
    },
    {
        "market": "SAMSUNG",
        "folder": "3.삼성전자",
        "name": "삼성전자 (005930)",
        "type": "stock",
        "keywords": ["삼성전자", "삼성전자주가", "삼전주가전망", "HBM3E", "005930", "DRAM가격", "반도체관련주", "외국인대량매수", "27만전자"],
    },
    {
        "market": "HYNIX",
        "folder": "4.SK하이닉스",
        "name": "SK하이닉스 (000660)",
        "type": "stock",
        "keywords": ["SK하이닉스", "하이닉스주가", "HBM4", "000660", "엔비디아관련주", "160만닉스", "반도체대장주", "AI반도체", "신고가랠리"],
    },
    {
        "market": "HYUNDAI",
        "folder": "5.현대차",
        "name": "현대차 (005380)",
        "type": "stock",
        "keywords": ["현대차", "현대차주가", "005380", "인도IPO", "자동차주", "밸류업수혜주", "하이브리드차", "전기차관련주", "신고가"],
    },
    {
        "market": "SKSQUARE",
        "folder": "6.SK스퀘어",
        "name": "SK스퀘어 (402340)",
        "type": "stock",
        "keywords": ["SK스퀘어", "402340", "SK스퀘어주가", "SK하이닉스지분", "지주사할인", "NAV재평가", "자사주소각", "반도체투자"],
    },
    {
        "market": "SEMCO",
        "folder": "7.삼성전기",
        "name": "삼성전기 (009150)",
        "type": "stock",
        "keywords": ["삼성전기", "009150", "삼성전기주가", "MLCC관련주", "유리기판", "FCBGA", "AI서버부품", "전자부품대장주"],
    },
]


def _format_money(n: float) -> str:
    if not n:
        return "0원"
    sign = "+" if n > 0 else "-" if n < 0 else ""
    amount = abs(n)
    if amount >= 10_000:
        return f"{sign}{(amount / 10_000):.2f}조원"
    return f"{sign}{round(amount):,}억원"


def generate_seo_blog_post(brief: dict, meta: dict) -> tuple[str, str]:
    """Generates an SEO-optimized title, hashtags, and smart editor HTML content."""
    date = brief.get("date", "")
    name = meta["name"]
    market_key = brief.get("market", "")
    idx = brief.get("index", {})
    inv = brief.get("investor", {})
    summary = brief.get("summary", "")
    analysis = brief.get("analysis", [])
    key_issues = brief.get("key_issues", [])
    checkpoints = brief.get("checkpoints", [])
    headlines = brief.get("headlines", [])

    close_val = idx.get("close", 0)
    change_val = idx.get("change", 0)
    change_pct = idx.get("change_pct", 0)
    change_sign = "+" if change_pct > 0 else ""
    color_tone = "#d9424e" if change_pct >= 0 else "#3467bd"

    close_display = f"{close_val:,.2f}" if isinstance(close_val, float) and close_val < 10000 else f"{close_val:,.0f}원"

    # 1. High-CTR SEO Title
    if meta["type"] == "stock":
        seo_title = f"[{date}] {name} 주가 전망 및 장마감 브리핑 | 종가 {close_val:,.0f}원 ({change_sign}{change_pct:.2f}%) 외인·기관 수급 분석"
    else:
        seo_title = f"[{date}] {name} 마감 시황 분석 | {close_val:,.2f}pt ({change_sign}{change_pct:.2f}%) 거래대금·외국인 수급 총정리"

    # 2. Smart Tags
    tags = list(meta["keywords"])
    tags.extend([f"{date.replace('-', '')}증시", "주식시장전망", "오늘의브리핑", "주식투자전략"])
    hashtags_str = " ".join([f"#{t}" for t in tags])

    # 3. Rich HTML Body
    html = f"""<!-- ==========================================
NAVER BLOG POST (SEO Optimized)
제목: {seo_title}
태그: {hashtags_str}
========================================== -->
<div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif; max-width: 720px; margin: 0 auto; color: #222e3e; line-height: 1.85; letter-spacing: -0.03em;">

  <!-- 상단 프리미엄 헤더 카드 -->
  <div style="background: linear-gradient(135deg, #102a43 0%, #1e3a8a 50%, #2563eb 100%); padding: 32px 24px; border-radius: 16px; color: #ffffff; text-align: center; margin-bottom: 26px; box-shadow: 0 10px 25px rgba(30, 58, 138, 0.2);">
    <div style="display: inline-block; background: rgba(255, 255, 255, 0.18); padding: 4px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; margin-bottom: 10px; color: #93c5fd;">DAILY MARKET BRIEFING</div>
    <h1 style="font-size: 23px; font-weight: 800; margin: 0 0 14px 0; color: #ffffff; line-height: 1.4;">{seo_title}</h1>
    
    <div style="display: inline-flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.25); padding: 10px 22px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.2);">
      <span style="font-size: 15px; color: #e2e8f0; margin-right: 8px;">마감 종가</span>
      <span style="font-size: 24px; font-weight: 800; color: #ffffff; margin-right: 10px;">{close_display}</span>
      <span style="font-size: 16px; font-weight: 700; color: {'#fca5a5' if change_pct >= 0 else '#93c5fd'};">({change_sign}{change_val:,.0f} / {change_sign}{change_pct:.2f}%)</span>
    </div>
  </div>

  <!-- 핵심 요약 (TL;DR) -->
  <div style="background: #f8fafc; border-left: 6px solid {color_tone}; padding: 20px 22px; border-radius: 0 12px 12px 0; margin-bottom: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
    <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: #0f172a;">📌 오늘 장 핵심 포인트 3줄 요약</h3>
    <p style="margin: 0; font-size: 14.5px; color: #334155; line-height: 1.75; font-weight: 500;">{summary}</p>
  </div>

  <!-- 1. 수급 및 주요 지표 테이블 -->
  <h2 style="font-size: 19px; font-weight: 800; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin: 32px 0 16px 0; color: #0f172a; display: flex; align-items: center;">
    <span style="margin-right: 8px;">📊</span> 투자자별 수급 및 거래대금 동향
  </h2>
  
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 26px; font-size: 14px; text-align: center; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
    <thead>
      <tr style="background: #1e293b; color: #f8fafc;">
        <th style="padding: 12px 8px; font-weight: 600;">외국인 순매수</th>
        <th style="padding: 12px 8px; font-weight: 600;">기관 순매수</th>
        <th style="padding: 12px 8px; font-weight: 600;">개인 순매수</th>
        <th style="padding: 12px 8px; font-weight: 600;">당일 거래대금</th>
      </tr>
    </thead>
    <tbody>
      <tr style="background: #ffffff; font-weight: 700;">
        <td style="padding: 14px 8px; border-bottom: 1px solid #e2e8f0; color: {'#dc2626' if inv.get('foreign_amount', 0) > 0 else '#2563eb'}; font-size: 15px;">{_format_money(inv.get('foreign_amount', 0))}</td>
        <td style="padding: 14px 8px; border-bottom: 1px solid #e2e8f0; color: {'#dc2626' if inv.get('institution_amount', 0) > 0 else '#2563eb'}; font-size: 15px;">{_format_money(inv.get('institution_amount', 0))}</td>
        <td style="padding: 14px 8px; border-bottom: 1px solid #e2e8f0; color: {'#dc2626' if inv.get('individual_amount', 0) > 0 else '#2563eb'}; font-size: 15px;">{_format_money(inv.get('individual_amount', 0))}</td>
        <td style="padding: 14px 8px; border-bottom: 1px solid #e2e8f0; color: #1e293b; font-size: 15px;">{(brief.get('turnover_estimate', 0) / 1e12):.2f}조원</td>
      </tr>
    </tbody>
  </table>

  <!-- 2. 심층 브리핑 상세 본문 -->
  <h2 style="font-size: 19px; font-weight: 800; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin: 32px 0 16px 0; color: #0f172a; display: flex; align-items: center;">
    <span style="margin-right: 8px;">📝</span> 마감 심층 분석 (Executive Summary)
  </h2>
  
  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 22px 24px; margin-bottom: 28px;">
    <ol style="margin: 0; padding-left: 22px;">
"""
    for item in analysis:
        html += f"""      <li style="margin-bottom: 12px; color: #334155; font-size: 14.5px; line-height: 1.75;">{item}</li>\n"""

    html += """    </ol>
  </div>
"""

    if key_issues:
        html += """  <!-- 3. 핵심 이슈 사항 -->
  <h2 style="font-size: 19px; font-weight: 800; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin: 32px 0 16px 0; color: #0f172a; display: flex; align-items: center;">
    <span style="margin-right: 8px;">💡</span> 오늘 시장 핵심 이슈 사항
  </h2>
  
  <div style="background: #fff7ed; border-left: 5px solid #ea580c; padding: 18px 22px; border-radius: 0 12px 12px 0; margin-bottom: 28px;">
    <ul style="margin: 0; padding-left: 20px;">
"""
        for issue in key_issues:
            html += f"""      <li style="margin-bottom: 10px; font-size: 14.5px; color: #9a3412; font-weight: 600; line-height: 1.6;">{issue}</li>\n"""
        html += """    </ul>
  </div>
"""

    if checkpoints:
        html += """  <!-- 4. 다음 거래일 확인 사항 -->
  <h2 style="font-size: 19px; font-weight: 800; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin: 32px 0 16px 0; color: #0f172a; display: flex; align-items: center;">
    <span style="margin-right: 8px;">🔍</span> 다음 거래일 투자 체크포인트
  </h2>
  
  <div style="background: #eff6ff; border-left: 5px solid #2563eb; padding: 18px 22px; border-radius: 0 12px 12px 0; margin-bottom: 28px;">
    <ul style="margin: 0; padding-left: 20px;">
"""
        for cp in checkpoints:
            html += f"""      <li style="margin-bottom: 10px; font-size: 14.5px; color: #1e40af; font-weight: 600; line-height: 1.6;">{cp}</li>\n"""
        html += """    </ul>
  </div>
"""

    if headlines:
        html += """  <!-- 5. 관련 핵심 뉴스 -->
  <h2 style="font-size: 19px; font-weight: 800; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin: 32px 0 16px 0; color: #0f172a; display: flex; align-items: center;">
    <span style="margin-right: 8px;">📰</span> 언론사별 마감 주요 뉴스
  </h2>
  
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-bottom: 28px;">
    <ul style="margin: 0; padding-left: 18px;">
"""
        for h in headlines[:6]:
            t = h.get("title", "")
            u = h.get("url", "#")
            p = h.get("press", "언론사")
            html += f"""      <li style="margin-bottom: 9px; font-size: 13.5px;"><span style="color: #64748b; font-weight: 600; font-size: 12px;">[{p}]</span> <a href="{u}" target="_blank" style="color: #2563eb; text-decoration: none; font-weight: 600;">{t}</a></li>\n"""
        html += """    </ul>
  </div>
"""

    # 4. Footer & Tags
    html += f"""  <!-- 네이버 블로그 스마트 태그 및 푸터 -->
  <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; text-align: center; margin-top: 32px;">
    <p style="font-size: 13.5px; font-weight: 700; color: #0284c7; margin: 0 0 12px 0; word-break: break-all;">{hashtags_str}</p>
    <p style="font-size: 12px; color: #64748b; margin: 0 0 6px 0;">※ 본 포스팅은 시장 공개 데이터와 수급 통계를 기반으로 자동 집계된 투자 참고 자료입니다.</p>
    <p style="font-size: 12px; color: #334155; margin: 0;">🌐 실시간 차트 및 인터랙티브 맵 보기: <a href="https://kospimap.com/market-brief/{date}/{market_key.lower()}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: underline;">K-Stock Hub 바로가기</a></p>
  </div>
</div>
"""
    return seo_title, html


def export_all_blog_posts(target_date: str = "2026-08-14") -> dict:
    """Exports structured HTML files and summary guides organized by folder for Naver Blog."""
    results = {}
    base_dir = EXPORTS_DIR / target_date
    base_dir.mkdir(parents=True, exist_ok=True)

    summary_manifest = [f"# {target_date} 네이버 블로그 게시 가이드 및 태그 목록\n"]

    for cfg in TARGET_CONFIG:
        market_key = cfg["market"]
        folder_name = cfg["folder"]
        target_folder = base_dir / folder_name
        target_folder.mkdir(parents=True, exist_ok=True)

        brief = market_brief_store.get(target_date, market_key)
        if not brief:
            continue

        seo_title, html_content = generate_seo_blog_post(brief, cfg)
        out_file = target_folder / f"{target_date}_{market_key}_naver_blog.html"
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(html_content)

        results[market_key] = {
            "title": seo_title,
            "path": str(out_file),
            "folder": folder_name,
        }
        summary_manifest.append(f"## {folder_name} - {cfg['name']}")
        summary_manifest.append(f"* **추천 제목**: `{seo_title}`")
        summary_manifest.append(f"* **파일 경로**: `{out_file}`")
        summary_manifest.append(f"* **추천 태그**: `{' '.join(['#' + t for t in cfg['keywords']])}`\n")
        log.info("Saved SEO Naver Blog HTML: %s", out_file)

    manifest_file = base_dir / "00_블로그_게시가이드.md"
    with open(manifest_file, "w", encoding="utf-8") as f:
        f.write("\n".join(summary_manifest))

    return results


def schedule_blog_export_after_brief():
    """Runs 5 minutes (300s) after daily brief completion."""
    def _delayed_run():
        time.sleep(300)
        today_str = dt.datetime.now(KST).strftime("%Y-%m-%d")
        try:
            export_all_blog_posts(today_str)
            log.info("Completed automated Naver Blog export for %s", today_str)
        except Exception:
            log.exception("Automated Naver Blog export failed")

    threading.Thread(target=_delayed_run, daemon=True, name="naver-blog-exporter").start()
