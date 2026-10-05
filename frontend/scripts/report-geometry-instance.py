"""Korean release report. Run from repo root after matched measurements and deployment."""
import json,sys,gzip
from pathlib import Path
from datetime import datetime
sys.path.insert(0,str(Path('tmp/pdf-runtime').resolve()))
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph,Table,TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

data=json.loads(Path('docs/3d-geometry-instance-measurements-2026-10-05.json').read_text(encoding='utf8'))
proof=json.loads(Path('tmp/hybrid-production-verification.json').read_text(encoding='utf8'))
assert proof['verified'] and proof['health']['commit']==proof['commit']
kernel=data['kernel'];scene=data['scene'];summary=scene['summary']
pdfmetrics.registerFont(TTFont('KR','C:/Windows/Fonts/malgun.ttf'));pdfmetrics.registerFont(TTFont('KRB','C:/Windows/Fonts/malgunbd.ttf'))
out=Path('output/pdf/geometry-instance-report-2026-10-05.pdf');out.parent.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(out),pagesize=A4);c.setTitle('Geometry·대량 Instance WASM 전환 및 운영 검증');c.setAuthor('KOSPIMAP engineering')
W,H=A4;LEFT=43;WIDTH=W-LEFT*2;y=0
navy=HexColor('#142A3B');teal=HexColor('#087F8C');gray=HexColor('#516270');pale=HexColor('#F0F5F7')
body=ParagraphStyle('body',fontName='KR',fontSize=9.4,leading=14.5,wordWrap='CJK',textColor=navy)
small=ParagraphStyle('small',parent=body,fontSize=8.2,leading=12)
head=ParagraphStyle('head',parent=body,fontName='KRB',fontSize=12,leading=17,textColor=teal)
cell=ParagraphStyle('cell',parent=small,fontSize=8.1,leading=12)
cellhead=ParagraphStyle('cellhead',parent=cell,fontName='KRB',textColor=white)
names={'ganeung':'의정부 롯데캐슬 골드포레','shindonga':'신동아파밀리에','luceheim':'래미안 개포 루체하임'}
profiles={'desktop':'일반','constrained':'제한'}
def para(text,style=body,gap=8):
 global y
 p=Paragraph(text,style);_,h=p.wrap(WIDTH,700);assert y-h>48,(y,h,text[:80]);p.drawOn(c,LEFT,y-h);y-=h+gap
def start(page,label):
 global y
 if page>1:c.showPage()
 c.setFillColor(navy);c.rect(0,H-96,W,96,fill=1,stroke=0);c.setFillColor(white);c.setFont('KRB',18);c.drawString(LEFT,H-44,'Geometry · Instance WASM 전환')
 c.setFont('KR',9);c.drawString(LEFT,H-68,label+' | 2026-10-05')
 c.setFillColor(gray);c.setFont('KR',7.6);c.drawString(LEFT,25,'KOSPIMAP | 기준 937dc1c | 운영 '+proof['commit'][:12]);c.drawRightString(W-LEFT,25,f'{page} / 5');y=H-118
def table(rows,widths):
 global y
 t=Table([[Paragraph(str(v),cellhead if i==0 else cell)for v in r]for i,r in enumerate(rows)],colWidths=widths)
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[pale,white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,-1),(-1,-1),.5,HexColor('#D6E1E6'))]))
 _,h=t.wrap(WIDTH,700);assert y-h>48,(y,h);t.drawOn(c,LEFT,y-h);y-=h+12
def value(profile,case,mode):return next(r for r in summary if r['profile']==profile and r['case']==case and r['mode']==mode)
def pair(profile,case):return value(profile,case,'off'),value(profile,case,'on')
def change(before,after):return f'{100*(after/before-1):+.1f}%' if before else ('0%' if after==0 else '증가')
def compare(before,after,scale=1,unit='',digits=2):return f'{before/scale:.{digits}f} → {after/scale:.{digits}f}{unit}'
def scene_rows(fields):
 rows=[]
 for profile in ['desktop','constrained']:
  for case in ['ganeung','shindonga']:
   before,after=pair(profile,case);rows.append([profiles[profile]+' / '+names[case],*[fn(before,after)for fn in fields]])
 return rows

start(1,'완료 범위와 개선 결과')
para('주변 건물 형상과 차량·수목 행렬 계산을 Rust/WASM 배치로 전환하고 운영에서 확인했습니다.',head)
para('벽·지붕의 position, normal, UV, color 및 index 생성은 워커의 WASM에서 처리합니다. 지붕 삼각분할은 기존 Earcut을 유지합니다. 차량의 위치·yaw·pitch·비균일 배율을 행렬로 합성하는 계산과 대량 수목 배치 행렬도 WASM 배치로 처리합니다. 보행자 관절·차량 바퀴의 개별 계산은 JS에 남아 있습니다.')
para('대량 행렬 버퍼는 프레임마다 재사용하며, 변경된 Instance 범위만 GPU로 업로드합니다. 원거리 잎의 셀 분할 기준은 1,024개/480m, 줄기는 4,096개/1,024m입니다. 근거리 잎 배치는 유지하고 원거리 잎에 LOD를 적용합니다. 수목 위치·색상·높이를 보존하며 LOD 정점 속성은 공유하고 index만 달리 사용합니다.')
para('전체 장면 비교 - 각 설정·단지·방식 3회 중앙값',head)
table([['설정 / 단지','전체 준비 시간','GPU 제출 삼각형','업로드 / 프레임']]+scene_rows([
 lambda b,a:compare(b['allReadyMs'],a['allReadyMs'],1000,'초'),
 lambda b,a:compare(b['submittedTriangles'],a['submittedTriangles'],1e6,'M')+'<br/>'+change(b['submittedTriangles'],a['submittedTriangles']),
 lambda b,a:compare(b['uploadBytesPerFrame'],a['uploadBytesPerFrame'],1024,'KiB',1),
]),[157,113,119,WIDTH-389])
para('위 표의 개선률은 이 컴퓨터의 동일 장면 비교입니다. CPU 계산 개선이 전체 로딩·FPS 개선과 같은 뜻은 아닙니다. 로딩·메모리·프레임 지표의 증가와 개선이 확인되지 않은 항목도 후속 페이지에 그대로 기재했습니다.',small)
para('메모리에서 확인한 개선',head)
m=kernel['forestMemory']
para(f"제한 기기용 수목 원형의 typed-array 버퍼는 {m['oldBytes']/1024:.1f} → {m['newBytes']/1024:.1f}KiB로 {m['reductionPercent']:.1f}% 감소했습니다. 이는 원형 버퍼 비교이며 전체 브라우저 메모리나 VRAM 감소율이 아닙니다. 전체화면 닫기는 옆 패널을 유지하고, 지도 이탈 후 마지막 소유자가 닫히면 작업 워커가 모두 종료됩니다.")
para('운영 릴리스',head)
para('서비스: https://kospimap.com/realestate-map<br/>코드 commit: '+proof['commit']+'<br/>확인 시간: '+proof['verifiedAt']+'<br/>/api/health commit과 운영 WASM 로딩·장면·도로선 검증을 함께 확인했습니다.',small)

start(2,'Geometry · 대량 Instance 계산과 자원')
para('실제 주변 건물 입력으로 CPU 계산 비교',head)
table([['단지 / 건물 수','기존 JS','WASM','변화 / 정확성']]+[[names[r['name']]+f"<br/>{r['jobs']:,}개",f"{r['medianMs']['js']:.2f}ms",f"{r['medianMs']['wasm']:.2f}ms",change(r['medianMs']['js'],r['medianMs']['wasm'])+f"<br/>float 불일치 {r['mismatches']}건"]for r in kernel['geometry']],[205,81,81,WIDTH-367])
para('WASM 수치는 입력 packing, 기존 Earcut 삼각분할, WASM 호출 및 결과 복사를 포함합니다. 두 단지에서 실제로 전달된 동일 입력을 사용해 방식 순서를 교차하며 각각 7회 측정했습니다. 네트워크와 장면 렌더링 시간은 포함하지 않습니다. 첫 초기화는 별도로 기록했습니다.',small)
para('대량 Instance 행렬 - 복사 비용 포함',head)
table([['행렬 수','Three.js 재사용 객체','WASM 배치','변화']]+[[f"{r['count']:,}개",f"{r['medianMs']['js']:.3f}ms",f"{r['medianMs']['wasm']:.3f}ms",change(r['medianMs']['js'],r['medianMs']['wasm'])]for r in kernel['instances']],[112,158,125,WIDTH-395])
para('기존 대조군도 Matrix4·Quaternion·Vector3를 재사용합니다. 동일 packed 입력의 합성·float32 출력과 WASM 입력/출력 복사까지 비교했습니다. 50배치씩 7회 측정 후 중앙값을 사용했습니다. 이동 경로·교차로 판단·지형 조회는 이 측정에 포함하지 않습니다.',small)
maxerr=max(r['maxError']for r in kernel['instances'])
para(f'행렬의 최대 절대 차이는 {maxerr:.3g}입니다. 반복 실행 중 WASM 메모리 크기는 증가하지 않았습니다. 정상 취소·닫기·재열기 및 WASM 로딩 실패 시 JS 복귀를 Chromium/WebKit/iPad 설정에서 확인했습니다.')
para('Instance batch의 JS 입력 및 WASM 입출력 소유 버퍼는 1,000개 208,000B / 10,000개 2,080,000B입니다. linear memory 크기는 각각 1.25 / 2.56MiB이며 해제 후에도 allocator가 재사용할 수 있는 예약 크기입니다.',small)
para('메모리 비용과 전환 범위',head)
rows=[['단지','형상 결과 버퍼','형상 입력 버퍼','형상 WASM 메모리']]
for r in kernel['geometry']:rows.append([names[r['name']],f"{r['outputBytes']/1048576:.2f}MiB",f"{r['inputBytes']/1048576:.2f}MiB",f"{r['wasmMemoryBytes']/1048576:.2f}MiB"])
table(rows,[180,108,108,WIDTH-396])
para('WASM 형상 결과는 소유권을 가진 typed-array로 복사해 전달합니다. 원본 GPU 배열을 분리하거나 재정렬하지 않습니다. 워커가 종료되면 그 WASM 메모리도 해제됩니다. main thread Instance WASM은 마지막 3D 뷰 소유자가 닫히면 참조를 해제합니다. 실제 reclaim 시점은 브라우저 GC가 결정합니다.',small)
binary=Path('frontend/src/wasm/scene-geometry/scene_geometry.wasm').read_bytes()
para(f'추가 WASM 바이너리 {len(binary):,}B, gzip {len(gzip.compress(binary,mtime=0)):,}B. 배포 빌드는 저장된 바이너리를 사용하므로 운영 빌드에 Rust 도구 설치는 필요하지 않습니다.',small)

start(3,'전체 장면 로딩 지연과 메모리')
para('로딩 지연 - 선택부터 첫 표시 / 전체 준비까지',head)
table([['설정 / 단지','첫 표시','전체 준비','전체 변화']]+scene_rows([
 lambda b,a:compare(b['firstShownMs'],a['firstShownMs'],1000,'초'),
 lambda b,a:compare(b['allReadyMs'],a['allReadyMs'],1000,'초'),
 lambda b,a:change(b['allReadyMs'],a['allReadyMs']),
]),[170,115,115,WIDTH-400])
para('전체 준비는 수목·도로·차량·수계·보행자·필지 요소·주변 건물과 네이티브 렌더러 준비를 함께 기다립니다. 각 방식마다 새 브라우저 context를 사용했습니다. 동적 지리 응답은 처음 받은 동일 응답을 재사용해 입력 차이를 통제했습니다. CDN 정적 자료·셰이더·스케줄링 변동은 남아 있습니다.',small)
para('제한 프로필은 deviceMemory=4, MacIntel/touch 설정으로 앱의 기기 예산 분기를 재현합니다. 같은 Windows GPU를 사용하며 실제 CPU/GPU 감속이나 실물 태블릿 메모리 한도를 재현하지 않습니다. 지리 응답 재사용 결과는 실제 사용자의 네트워크 로딩 시간 예측이 아닙니다.',small)
para('전체 메모리 - JS 힙과 GPU를 구분',head)
table([['설정 / 단지','JS 힙 GC 후','GPU 버퍼','GPU 텍스처']]+scene_rows([
 lambda b,a:compare(b['jsHeapUsedAfterGcBytes'],a['jsHeapUsedAfterGcBytes'],1048576,'MiB',1),
 lambda b,a:compare(b['gpu']['buffers'],a['gpu']['buffers'],1048576,'MiB',1),
 lambda b,a:compare(b['gpu']['textures'],a['gpu']['textures'],1048576,'MiB',1),
]),[161,116,116,WIDTH-393])
para('JS 힙은 CDP Performance.getMetrics의 JSHeapUsedSize이며 측정 전 강제 GC를 수행했습니다. worker heap, ArrayBuffer/WASM backing store, GPU 및 OS process memory를 포함한 전체 RSS가 아닙니다. GPU 값은 실제 createBuffer/createTexture 호출의 수명과 format·mipmap·sampleCount로 계산한 논리적 할당량입니다. 드라이버 padding과 내부 cache는 포함하지 않습니다.',small)
para('메모리 평가의 한계',head)
para('공간 셀 객체와 변경 범위 추적에는 추가 메모리가 필요합니다. 따라서 수목 원형 버퍼가 줄어도 전체 장면 JS 힙·GPU 메모리가 같은 비율로 감소하지 않습니다. 비교 두 방식에는 공통 워커 해제 수정 및 제한 기기의 LOD 속성 공유가 포함돼 있습니다. 원형 버퍼의 40%대 감소와 전체 장면 A/B 결과를 합쳐 전체 메모리 개선율로 표현하지 않았습니다.',small)
para('각 실측 A/B 쌍에서 건물 입력 hash, 도로·차선 삼각형 hash와 수목 수를 비교합니다. 삼각형 hash는 정점의 cyclic 순서와 삼각형 저장 순서만 정규화하며 좌표 오차 허용은 없습니다. 준비 실행과 입력이 다른 쌍은 원자료에 보존하고 중앙값에서 제외합니다. 입력 차이만 재측정 기준으로 삼습니다.',small)

start(4,'렌더링 성능과 프레임 드랍')
para('렌더러 CPU·GPU 시간과 프레임 지연',head)
table([['설정 / 단지','CPU p95','GPU 중앙값','프레임 p95']]+scene_rows([
 lambda b,a:compare(b['renderCpuMs']['p95'],a['renderCpuMs']['p95'],1,'ms',2),
 lambda b,a:compare(b['gpuFrameMs']['p50'],a['gpuFrameMs']['p50'],1,'ms',2) if b['gpuFrameMs']['p50'] and a['gpuFrameMs']['p50'] else '계측 미지원',
 lambda b,a:compare(b['frames']['p95'],a['frames']['p95'],1,'ms',1),
]),[161,116,116,WIDTH-393])
para('완성 후 6초간 requestAnimationFrame 간격을 수집하고 렌더러 함수 CPU 실행 시간을 기록했습니다. GPU 시간은 renderer timestamp timer가 제공한 관측값을 사용합니다. 삼각형·draw 계측은 별도 1.5초 창에서 수행해 프레임 측정을 오염시키지 않도록 했습니다. 약 16.7ms가 유지되면 60Hz 한계에 이미 도달한 상태로 FPS 증가를 주장할 수 없습니다.',small)
para('프레임 드랍 - 25ms 초과 비율 / 심한 지연',head)
table([['설정 / 단지','완성 후 >25ms','로딩 중 >25ms','로딩 최장 간격']]+scene_rows([
 lambda b,a:compare(b['frames']['dropRate25'],a['frames']['dropRate25'],.01,'%',2),
 lambda b,a:compare(b['loadingFrames']['dropRate25'],a['loadingFrames']['dropRate25'],.01,'%',2),
 lambda b,a:compare(b['loadingFrames']['maxMs'],a['loadingFrames']['maxMs'],1,'ms',1),
]),[161,116,116,WIDTH-393])
table([['설정 / 단지','로딩 중 50ms 초과 프레임','로딩 Long Task 수','Long Task 합계']]+scene_rows([
 lambda b,a:compare(b['loadingFrames']['over50ms'],a['loadingFrames']['over50ms'],1,'회',0),
 lambda b,a:compare(b['longTasks']['count'],a['longTasks']['count'],1,'회',0),
 lambda b,a:compare(b['longTasks']['totalMs'],a['longTasks']['totalMs'],1,'ms',0),
]),[161,116,116,WIDTH-393])
para('25ms 기준은 60Hz에서 누락 프레임을 관찰하기 위한 proxy입니다. 50ms 초과 간격과 browser Long Task도 함께 보고합니다. 같은 프레임이 Long Task와 중복될 수 있습니다. 로딩 중 드랍 0, 전 기기 7초 완료, 실제 iPad FPS 개선을 확인한 것으로 해석하지 않습니다.',small)
para('공간 셀은 draw call을 늘립니다. 제한 설정에서는 카메라 가까이 온 셀이 기존 고정 원거리 단계보다 상세해져 제출 삼각형도 늘 수 있습니다. CPU·GPU 시간으로 교환 비용을 함께 판단합니다. LOD에는 15% 거리 hysteresis를 사용하고 근거리 수목의 원래 디테일을 유지합니다.',small)

start(5,'운영 배포와 검증 근거')
para('운영 배포 후 확인',head)
rows=[['운영 단지','형상 계산','Instance 계산','차선 누락 / 오류']]
for case,r in proof['production'].items():rows.append([names[case],r['state']['geometryCompute'],r['instanceMode'],f"{len(r['coverage']['missingPaint'])} / {len(r['coverage']['errors'])}"])
table(rows,[192,105,105,WIDTH-402])
para('운영 /api/health에서 코드 commit 일치를 확인했습니다. 운영에서 실제 형상 계산이 rust-wasm이며 차량·수목 계산 경로가 rust-wasm인지 확인했고, 신규 WASM 정적 파일이 로컬 바이너리와 SHA-256 기준으로 같은지도 확인했습니다. 실제 아스팔트·차선의 누락/매몰 검사를 수행했습니다.',small)
para('회귀·호환성 검증',head)
para('형상·행렬·GPU·수목·도로·차량·메모리 수명 회귀 검사 81개와 부동산 UI 검사 12개를 통과했습니다. TypeScript 및 Vite production 빌드도 통과했습니다. 재질 수명 검사에서 바뀐 renderer 함수 signature를 올바르게 추출하도록 수정했고 기존 잘못된 구현의 실패 재현은 유지했습니다.')
para('Chromium, WebKit, iPad 설정의 WebKit에서 WASM 정상 동작, 차단 시 JS 복귀, 다시 열었을 때 WASM 복원, 취소, 마지막 owner 해제 시 워커 종료를 확인했습니다. WebKit 장면 검사와 운영 단지 검사는 별도의 JSON으로 보존합니다. 에뮬레이션은 실물 iPad의 GPU/메모리/FPS 측정이 아닙니다.')
para('마지막 뷰 종료 후 자원',head)
closed=[r['afterClose']for r in scene['rows']if r['run']>=0 and 'afterClose'in r]
para(f"지도 이탈 후 검사 {len(closed)}건 모두 활성 워커 0개였습니다. 잔존 GPU 논리 버퍼는 최대 {max(r['gpu']['buffers']for r in closed):,}B, 텍스처는 최대 {max(r['gpu']['textures']for r in closed)/1048576:.3f}MiB입니다. 뷰 종료 후 device cache까지 0B라고 주장하지 않습니다. 전체화면 닫기와 마지막 뷰 닫기를 구분해 기록했습니다.")
para('재현 자료',head)
para('측정 JSON: docs/3d-geometry-instance-measurements-2026-10-05.json<br/>기술 기록: docs/3d-geometry-instance-2026-10-05.md<br/>CPU/호환성: frontend/scripts/check-hybrid-browser.py<br/>전체 장면: frontend/scripts/bench-hybrid-scene.py<br/>운영 검증: frontend/scripts/verify-hybrid-production.py<br/>비교 옵션: hybrid=off (BVH는 양쪽 모두 활성)',small)
para('원시 지리 응답·공급자 키·원본 API URL은 보고서나 커밋에 포함하지 않았습니다. 사용한 장면 입력은 로컬 tmp에만 보존합니다. 이번 릴리스는 주변 건물과 차량·수목 배치 계산의 전환이며, 모든 Geometry 처리와 모든 움직이는 관절 계산의 WASM 이전을 의미하지 않습니다.',small)
para('관측 범위: Windows Edge '+scene['environment']['browser']+' / 1440×1000 / DPR 2 / '+kernel['environment']['ua'],small)
c.save();print(str(out.resolve()))
