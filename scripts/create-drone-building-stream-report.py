"""Fixed-quality Korean report from isolated Chrome QA and public release checks."""
import argparse
import json
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

parser = argparse.ArgumentParser()
parser.add_argument('--release', required=True, type=Path)
parser.add_argument('--version', default='v12')
parser.add_argument('--accepted-below-50', action='store_true', help='Record an explicitly accepted release that still misses the 50 FPS target.')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
qa = root/'tmp/drone-performance-20261010'
release = json.loads(args.release.read_text(encoding='utf8'))
assert release['deployed']
reports = [json.loads((qa/f'building-release-{place}-{args.version}/report.json').read_text(encoding='utf8')) for place in ['haeundae', 'changdong']]
assert all(r['gateFixedResolution'] and not r['errors'] and not r['profileOn'] for r in reports)
passed50 = all(r['gate50fps'] for r in reports)
assert passed50 or args.accepted_below_50, 'The release still misses 50 FPS; do not silently report acceptance.'
for report in reports:
    for row in report['results']:
        assert row['resolution'] == {'pixelRatios':[1.75], 'canvas':[2520,1750], 'quality':'high'}
detail = json.loads((qa/f'building-release-detail-{args.version}/report.json').read_text(encoding='utf8'))
assert not detail['errors'] and detail['controls']['released'] and detail['controls']['movedMetres'] > .1
baseline = json.loads((qa/'baseline-building-5571c59/report.json').read_text(encoding='utf8'))
before = {t['key']:t for t in baseline['records'][-1]['tiles'] if not t['key'].startswith('view:')}
after = {t['key']:t for t in detail['records'][-1]['tiles'] if not t['key'].startswith('view:')}
keys = sorted(before.keys() & after.keys())
assert keys and all(before[k]['towers'] == after[k]['towers'] for k in keys)
old_count = sum(before[k]['replaced'] for k in keys)
new_count = sum(after[k]['replaced'] for k in keys)
output = root/f'output/pdf/drone-building-stream-fixed-quality-2026-10-10-{args.version}.pdf'
assert not output.exists(), 'Preserve existing reports; choose a fresh version.'
output.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Korean','C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('KoreanBold','C:/Windows/Fonts/malgunbd.ttf'))
pdfmetrics.registerFontFamily('Korean', normal='Korean', bold='KoreanBold')
navy = colors.HexColor('#153449'); teal = colors.HexColor('#067c83'); gray = colors.HexColor('#516776')
styles = {name:ParagraphStyle(name, fontName='KoreanBold' if name in ['title','heading','header'] else 'Korean',
    fontSize=size, leading=leading, textColor=colors.white if name=='header' else teal if name=='heading' else gray if name=='small' else navy,
    wordWrap='CJK', spaceAfter=8 if name in ['body','small'] else 10) for name,size,leading in
    [('title',20,27),('heading',12,18),('body',10,15.5),('small',8.5,13),('cell',9,13),('header',9,13)]}
story=[]
def p(text, kind='body'): return Paragraph(str(text), styles[kind])
def add(text, kind='body'): story.append(p(text,kind))
def table(rows, widths):
    t = Table([[p(v,'header' if i==0 else 'cell') for v in row] for i,row in enumerate(rows)],colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#eef5f7'),colors.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story.extend([t,Spacer(1,10)])

add('건물 상세 로딩 누락 수정','title')
add(f"2026-10-10 | 출력 품질 유지 검증 | 운영 배포 {release['commit'][:7]}",'small')
add('5층 이상 건물도 상세화되지 않는 로딩 경로를 수정했습니다. <b>최초 영역 누락, 실측 모델 매칭 실패, 다운로드 오류의 완료 처리</b>가 핵심 원인이었습니다. 가까운 순서로 상세 모델을 적용하고 GPU 준비가 끝날 때 기본 건물을 교체합니다.')
add('해상도를 유지한 Chrome 비행 결과','heading')
names=['해운대 최초 영역','해운대 도심 이동','해안 이동','광안대교 이동','해운대 복귀','창동 최초 영역','창동 이동','창동 복귀']
rows=[['측정 구간','평균 FPS','최저 1초 FPS','최대 프레임']]
for name,row in zip(names,[x for r in reports for x in r['results']]):
    rows.append([name,f"{row['meanFps']:.2f}",f"{row['minWindowFps']:.2f}",f"{row['worstMs']:.1f} ms"])
table(rows,[183,85,112,135])
add('Chrome 154.0.8037.98 / NVIDIA Ampere / WebGPU / 새 독립 세션. 뷰포트 1440×1000, 실제 출력 2520×1750, 픽셀 비율 1.75, 품질 high 고정. 각 구간 2.5초 정착 후 10초 측정. CPU 샘플링은 끄고 실제 렌더 프레임을 함께 확인했습니다.','small')
if not passed50:
    add('<b>최소 50 FPS 목표는 미달입니다.</b> 창동 최저 45.98 FPS를 보고한 뒤 사용자가 해당 수치로 배포를 허용했습니다. 전 구간 최소 50 FPS는 남은 개선 과제이며, 평균 FPS로 합격 처리하지 않았습니다.','small')
add('실제 상세 모델 적용 확인','heading')
add(f'같은 이동 경로의 공통 {len(keys)}개 타일에서, 같은 상세화 대상에 적용된 실측 모델 대응 건물은 <b>{old_count}개 → {new_count}개</b>입니다. 처음 보이는 영역에도 같은 대기열이 적용되며, 키보드 이동과 키 해제를 확인했습니다.')
add('외부 GIS의 도착 순서와 네트워크 상태에 따라 로딩 시간은 달라집니다. 다운로드 모델 수와 실제 건물 교체 수는 서로 다른 지표이며, 모델 자료가 없는 건물까지 상세화되었다는 뜻은 아닙니다.','small')
add('기존 성능 보고의 정정','heading')
add('이전 601cd83 보고의 동적 해상도 FPS는 같은 화질의 성능 개선 근거에서 제외합니다. 이번 표는 해상도를 낮추지 않은 결과입니다. 수정 중 50fps 미달 실행도 보존했으며 49.98fps를 합격으로 반올림하지 않았습니다.','small')
story.append(PageBreak())
add('무엇이 달라졌는가','title')
table([
    ['문제','수정 후 동작'],
    ['처음 보이는 영역의 누락','최초 600m 영역도 이동 영역과 같은 가까운 순서의 형상/색상 작업 대기열에 포함합니다.'],
    ['실측 모델이 있는데도 미적용','등록 건물 외곽과 실측 외곽의 실제 겹침을 우선 판정합니다. 다른 건물이나 작은 옥탑만으로 전체 건물을 교체하지 않습니다.'],
    ['실패 후 상세 로딩 정지','8초 안에 완료된 모델 중 충분한 형상이 확인된 건물부터 적용합니다. 일부 날개만 받은 건물은 기본 형상을 유지하고 재시도합니다.'],
    ['비슷한 재질과 뒤늦은 색상','상세 모델에도 건물별 벽/지붕/단부 색상을 반영하고 지붕에 창문 재질을 적용하지 않습니다. 등록 층 높이의 창문 간격을 유지합니다.'],
    ['로딩과 조작이 겹치는 부담','형상과 사진 분석 작업자를 분리하고 큰 모델 범위 계산을 작업자로 이동합니다. 반복 예약/차량 높이/차량 후보 배열/철도 검사 데이터/행렬 복사를 재사용합니다.'],
    ['메모리와 교체 중 빈 건물','작업자와 다운로드를 제한하고 멀어진 장면 자원을 회수합니다. 새 형상이 GPU에 준비된 뒤에 기본 건물을 교체하고 드론 종료 시 최초 영역을 복원합니다.'],
],[135,380])
add('검증과 배포 확인','heading')
add(f"관련 회귀 검사 <b>88개 통과</b>, TypeScript 검사와 새 출력 경로의 배포 빌드 통과. 두 지역과 상세 로딩 검증의 브라우저 오류는 0개입니다. 공개 health/HTML/진입 스크립트 및 버전 자산과 작업자 해시 {len(release['assets'])}개를 확인했습니다.")
add(f"비행 후 GC 잔류 JS 힙: 해운대 {reports[0]['retained']['heap']/1048576:.1f} MiB / 창동 {reports[1]['retained']['heap']/1048576:.1f} MiB. GPU 전체 메모리나 장시간 누수 부재의 증명은 아닙니다.",'small')
add('남은 한계와 점진적 개선 과제','heading')
add('실측 자료가 없거나 건물 대응을 확정하지 못하면 등록 외곽 기반 기본 건물을 유지합니다. 공유 외벽 재질에 실제 형상과 층 간격 및 항공 사진 색상을 적용하며, 모든 건물의 실제 외벽 사진이나 BIM 재질을 확보한 상태는 아닙니다. 외벽 사진의 다양화와 전국 장시간 비행, 사용자 장비별 전체 화면 검증은 추가 과제입니다.')
add('이 결과는 측정한 지역과 장비에 한정하며 전국/모든 장비의 최소 50fps 또는 항상 60fps를 보증하지 않습니다. 운영 DB는 시험 대상으로 사용하지 않았습니다. 배포 재시작의 기존 통계 보관 기간 정리는 확인 후 사용자가 명시적으로 허용했으며, 별도 DB 정리 명령은 실행하지 않았습니다.','small')
add('근거: docs/drone-building-stream-hotfix-20261010.md, building-release-haeundae / changdong / detail 보고서, baseline-building-5571c59 보고서 및 공개 배포 확인 JSON.','small')
def footer(canvas, doc):
    canvas.saveState(); canvas.setStrokeColor(colors.HexColor('#dce6ea')); canvas.line(40,40,A4[0]-40,40)
    canvas.setFont('Korean',8); canvas.setFillColor(gray); canvas.drawString(40,26,'드론뷰 상세 로딩 개선 | 출력 해상도 고정 검증'); canvas.drawRightString(A4[0]-40,26,str(doc.page)); canvas.restoreState()
SimpleDocTemplate(str(output),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=38,bottomMargin=54,title='건물 상세 로딩 누락 수정',author='Local Rendering Review').build(story,onFirstPage=footer,onLaterPages=footer)
print(str(output))
