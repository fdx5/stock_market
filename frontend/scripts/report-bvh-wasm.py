"""Two-page Korean report. Run after production verification, from repo root."""
import sys,json,statistics
from pathlib import Path
sys.path.insert(0,str(Path('tmp/pdf-runtime').resolve()))
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph,Table,TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4

data=json.loads(Path('docs/3d-bvh-wasm-measurements-2026-10-04.json').read_text(encoding='utf8'))
proof=json.loads(Path('tmp/bvh-production-verification.json').read_text(encoding='utf8'))
assert proof['health']['commit']==proof['commit'] and proof['verified']
pdfmetrics.registerFont(TTFont('KR','C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('KRB','C:/Windows/Fonts/malgunbd.ttf'))
out=Path('output/pdf/bvh-wasm-report.pdf');out.parent.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(out),pagesize=A4);c.setTitle('3D 지도 Rust/WASM BVH 실험 보고서');c.setAuthor('KOSPIMAP engineering')
W,H=A4;LEFT=44;WIDTH=W-88;y=0
navy=HexColor('#142A3B');teal=HexColor('#087F8C');gray=HexColor('#516270');pale=HexColor('#F0F5F7')
style=ParagraphStyle('body',fontName='KR',fontSize=9.3,leading=14,wordWrap='CJK',textColor=navy)
small=ParagraphStyle('small',parent=style,fontSize=8.1,leading=11.7)
head=ParagraphStyle('head',parent=style,fontName='KRB',fontSize=11.5,leading=16,textColor=teal)
cell=ParagraphStyle('cell',parent=small,fontSize=8.4,leading=12)
cellhead=ParagraphStyle('cellhead',parent=cell,fontName='KRB',textColor=white)
def para(text,kind=style,gap=8):
 global y
 p=Paragraph(text,kind);_,height=p.wrap(WIDTH,700);assert y-height>44,(text,y,height)
 p.drawOn(c,LEFT,y-height);y-=height+gap
def title(page,label):
 global y
 c.setFillColor(navy);c.rect(0,H-100,W,100,fill=1,stroke=0);c.setFillColor(white);c.setFont('KRB',19);c.drawString(LEFT,H-48,'Rust/WASM BVH 실험 보고서')
 c.setFont('KR',9);c.drawString(LEFT,H-72,label+' | 2026-10-04')
 c.setFillColor(gray);c.setFont('KR',8);c.drawString(LEFT,24,'KOSPIMAP  ·  기준 a258bc6  ·  운영 '+proof['commit'][:7]);c.drawRightString(W-LEFT,24,f'{page} / 2');y=H-122
def table(rows,widths):
 global y
 content=[[Paragraph(str(v),cellhead if i==0 else cell)for v in row]for i,row in enumerate(rows)]
 t=Table(content,colWidths=widths);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[pale,white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,-1),(-1,-1),.5,HexColor('#D6E1E6'))]));_,h=t.wrap(WIDTH,700);assert y-h>44,(y,h);t.drawOn(c,LEFT,y-h);y-=h+12
names={'ganeung':'의정부롯데캐슬골드포레','shindonga':'신동아파밀리에','luceheim':'래미안 개포 루체하임'}
title(1,'구현 범위와 CPU 측정')
para('도로 계산 CPU 시간은 33.7~41.5% 감소했습니다. 전체 로딩·FPS의 극적인 개선은 확인되지 않았습니다.',head)
para('기존 6m 격자 색인을 Rust 생성 2D AABB BVH로 교체했습니다. Three.js 객체·geometry와 기존 WebGPU 렌더러를 유지하며, 정밀 도로 클리핑과 높이 계산은 기존 JS를 사용합니다. BVH 생성만 WASM 워커로 분리했습니다.')
para('실데이터 CPU 비교 - 각 방식 7회, 중앙값',head)
rows=[['단지 / 도로 삼각형','기존 격자','WASM 1워커','CPU 감소']]
for case in data['kernel']['cases']:
 s=case['summary'];pct=(1-s['wasm1']['totalMs']/s['grid']['totalMs'])*100
 rows.append([names[case['name']]+f"<br/>{case['triangles']:,}개",f"{s['grid']['totalMs']:.1f}ms",f"{s['wasm1']['totalMs']:.1f}ms",f'{pct:.1f}%'])
table(rows,[215,91,99,WIDTH-405])
para('측정 범위: 색인 생성 + 약 1만 회 도로 높이 조회 + 노란색/흰색 차선 보정. Windows Edge 155, 논리 코어 16, Rust 1.99.0. 호출 순서를 교차했고 최종 CPU 측정 중 빌드를 병행하지 않았습니다.',small)
para('언어 변경 효과와 병렬 처리 효과',head)
rows=[['단지','JS BVH 1워커','WASM 1워커','WASM 2워커']]
for case in data['kernel']['cases']:
 s=case['summary'];rows.append([names[case['name']],*[f"{s[k]['workerMs']:.1f}ms"for k in ['js1','wasm1','wasm2']]])
table(rows,[215,97,97,WIDTH-409])
para('위 수치는 워커 준비·BVH 생성 시간입니다. 2워커 생성은 더 빠르지만 두 트리 검색 비용으로 전체 CPU 시간은 1워커가 가장 좋았습니다. 기본값은 1워커이며, 기존 두 차선 보정 워커의 병렬 처리는 유지합니다. 개선의 상당 부분은 BVH 알고리즘 효과이고, JS BVH도 빨라졌습니다.',small)
para('자원·정확성·복구',head)
para('WASM 28,085B (gzip 10,969B), 보관 색인 약 0.68~1.33MiB. 원래 격자의 전체 heap은 미측정입니다. 제어 실험의 높이 및 차선 float 결과 차이는 0건이고, 실측 A/B 6쌍의 도로·차선 좌표 해시가 같았습니다. 원본 GPU 버퍼는 분리·재정렬하지 않습니다.',small)
para('자동 검사 81개 통과. Chromium·WebKit·iPad 설정에서 취소, 워커 종료, WASM 차단 시 격자 복귀를 확인했습니다. 실패·1초 초과 시 복귀하며 iPad는 최대 1워커를 사용합니다. 실제 iPad FPS는 측정하지 않았습니다.',small)
c.showPage();title(2,'전체 장면 측정과 후속 후보')
para('전체 장면 A/B - 단지별 3쌍, 중앙값',head)
rows=[['단지','전체 로딩 전 → 후','변화','완성 후 프레임']]
for key in ['ganeung','luceheim']:
 s=data['scene']['summary'][key];before=s['grid']['allReadyMs'];after=s['wasm']['allReadyMs'];rows.append([names[key],f'{before/1000:.3f} → {after/1000:.3f}s',f'{(after/before-1)*100:+.1f}%', '16.7ms → 16.7ms'])
table(rows,[168,142,62,WIDTH-372])
para('나무·도로·차량·수계·보행 요소와 렌더러 준비까지 확인했습니다. 동일 빌드·카메라·시간대에서 격자와 WASM을 번갈아 측정했습니다. 준비 실행은 제외했습니다. 첫 의정부 준비 실행은 입력 도로 개수가 달랐고, 실제 측정 6쌍은 좌표 해시가 모두 같았습니다.',small)
para('일관된 전체 로딩 개선이나 FPS 상승은 입증되지 않았습니다. 의정부는 약 0.10초 증가, 루체하임은 약 0.21초 감소했습니다. 완성 후 약 60 FPS는 두 방식 모두 같습니다. 마우스 다음 프레임 지연 p95는 각각 12.5→17.2ms, 9.1→10.6ms로, 응답 개선도 입증되지 않았습니다. 반복 수가 작고 네트워크·스케줄링 변동이 있으며 7초 완료 보장은 아닙니다.',small)
para('추가 Rust/WASM 후보 - 현재 코드 기준',head)
table([
 ['후보','권장 적용 / 기대 효과'],
 ['Geometry','로딩 1순위. 삼각분할·도로/지형 클리핑·법선·메시 병합을 큰 typed-array 작업으로 묶기.'],
 ['Quadtree + Culling','FPS 후보. 공간 셀별 보수적 가시성 검사로 GPU 제출량 감소. Quadtree 단독 이전 효과는 제한적.'],
 ['LOD','Culling과 결합. 화면상 크기로 먼 객체의 비용 감소, 근거리 건물 품질·전환 안정성 유지.'],
 ['Instance update','CPU 프레임 후보. 차량·바퀴·보행자 행렬을 일괄 계산하고 변경 버퍼만 갱신.'],
 ['Path finding','일반 지도에서는 후순위. 많은 동적 경로를 동시에 계산할 때 재검토.'],
 ],[135,WIDTH-135])
para('권장 순서: 로딩은 Geometry, iPad GPU 비용은 Quadtree+Culling+LOD, CPU 프레임 비용은 Instance update입니다. WASM 전환만으로 극단적인 배수를 약속하지 않고 다음 구간도 A/B 측정 후 적용합니다.',small)
para('운영 반영 및 근거',head)
para('운영 반영 '+proof['commit'][:7]+' 확인. 운영 도로선 메시 검사를 통과했고 기본 WASM 1워커 동작을 확인했습니다. 비교 옵션: bvh=grid / bvh=wasm2. 원시 측정과 상세 재현 방법은 저장소 docs/3d-bvh-wasm-2026-10-04.md 및 측정 JSON에 남겼습니다.',small)
para('기술 근거: <link href="https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html" color="#087F8C">Rust WASM target</link> · <link href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers" color="#087F8C">Web Workers</link> · <link href="https://threejs.org/docs/pages/Frustum.html" color="#087F8C">Three.js Culling</link> · <link href="https://threejs.org/docs/pages/LOD.html" color="#087F8C">LOD</link> · <link href="https://threejs.org/docs/pages/InstancedMesh.html" color="#087F8C">InstancedMesh</link>',small)
c.save();print(str(out.resolve()))
