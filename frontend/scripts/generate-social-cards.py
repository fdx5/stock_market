"""Render original, route-specific 1200x630 share artwork from the navigation source.

Artwork is decorative vector geometry, never a fabricated market screenshot.
Outputs are checked in; production needs neither Pillow nor desktop fonts.
"""
import hashlib,json,math,os,random,re
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'frontend/public/img/social';OUT.mkdir(parents=True,exist_ok=True)
FONT=Path(os.getenv('SOCIAL_FONT','C:/Windows/Fonts/malgun.ttf'))
BOLD=Path(os.getenv('SOCIAL_BOLD_FONT','C:/Windows/Fonts/malgunbd.ttf'))
if not FONT.exists() or not BOLD.exists():raise SystemExit('Set SOCIAL_FONT and SOCIAL_BOLD_FONT to Korean-capable TTF fonts')

DESCRIPTIONS={
 '/':'한국과 미국 증시, 환율과 가상자산의 흐름을 하나의 관제 홈에서 연결해 살펴보세요.',
 '/desk':'코스피·코스닥 지수, 시장 등락 분포와 외국인·기관 수급, 주요 종목을 함께 확인하세요.',
 '/global':'S&P 500·나스닥 흐름, 미국 주요 종목과 섹터, 시간외 시세를 살펴보세요.',
 '/stocks':'국내외 종목을 검색하고 시세·등락률·거래대금으로 원하는 기업을 찾아보세요.',
 '/etf':'국내와 미국 ETF의 시세, 수익률과 거래 흐름을 비교하고 투자 대상을 탐색하세요.',
 '/map':'코스피 종목의 시가총액과 등락을 면적과 색으로 한눈에 읽는 시장 지도입니다.',
 '/kosdaq-map':'코스닥 기업의 규모와 가격 변화를 업종별 면적과 색으로 살펴보세요.',
 '/sp500-map':'S&P 500 주요 기업의 구성과 등락을 섹터별 히트맵에서 확인하세요.',
 '/nasdaq100-map':'나스닥 100 기업의 비중과 가격 움직임을 한 장의 시장 지도에서 비교하세요.',
 '/realestate-map':'지도 위에서 지역과 단지의 부동산 실거래를 찾고 3D 단지 공간을 탐색하세요.',
 '/market-brief':'오늘 시장의 종가, 수급과 거래 흐름을 데이터 기반 브리핑으로 읽어보세요.',
 '/news':'세계 주요 기업의 최신 뉴스를 기업과 출처별로 선택해 확인하세요.',
 '/ai-prediction':'주가와 기술적 지표를 바탕으로 제공하는 AI 예측과 분석 근거를 확인하세요.',
 '/ai-prediction/grading':'지난 예측이 실제 결과와 어떻게 달랐는지 날짜별 채점 내역을 검토하세요.',
 '/investors':'투자 거물과 연관 운용사의 공개 포트폴리오, 보유 비중과 변화를 살펴보세요.',
 '/investment-videos':'한국과 미국 증시를 다루는 한국어 유튜브 영상을 모아 확인하세요.',
 '/dram-price':'D램 현물가격과 메모리 반도체 가격 흐름을 기간별로 살펴보세요.',
 '/kospi-100':'코스피 주요 100개 종목의 시세와 등락을 순위별로 확인하세요.',
 '/kosdaq-100':'코스닥 주요 100개 기업의 시세, 등락과 시장 비중을 비교하세요.',
 '/nasdaq-100':'나스닥 주요 100개 종목의 가격 흐름과 순위를 확인하세요.',
 '/global-top100':'전 세계 주요 기업의 시가총액과 국가·업종별 구성을 비교하세요.',
 '/fight':'세계 주요 기업의 시가총액 규모와 순위를 대결 구도로 비교하세요.',
 '/battle':'주요 종목의 상승·하락 흐름이 맞서는 시장 줄다리기를 살펴보세요.',
 '/index/kospi':'코스피 지수의 가격 차트와 이동평균, RSI 등 기술적 지표를 확인하세요.',
 '/index/kosdaq':'코스닥 지수의 과거 가격 흐름과 기술적 보조지표를 함께 살펴보세요.',
 '/discussion-explorer':'국내외 주식과 ETF의 종목 토론을 공간 속에서 탐색하고 게시글을 읽어보세요.',
 '/kospi-orbit':'코스피 기업을 항성과 행성으로 만나는 3D 시장 궤도를 탐험하세요.',
 '/kosdaq-orbit':'코스닥 기업의 규모와 등락이 펼쳐지는 독자적인 3D 행성계를 둘러보세요.',
 '/nasdaq100-orbit':'나스닥 주요 기업이 구성하는 3D 우주에서 섹터와 종목을 탐색하세요.',
 '/drone-explore':'실제 지형과 건물로 구성한 3D 도시 위를 드론 시점으로 이동하며 탐험하세요.',
 '/market-bubbles':'기업의 규모와 가격 움직임을 버블의 크기와 색으로 비교하세요.',
 '/market-bubbles2':'네오 스타일의 시장 버블 공간에서 종목 간 규모와 움직임을 살펴보세요.',
 '/hub':'행성과 궤도가 펼쳐지는 태양계 입구에서 다양한 시장 탐험으로 진입하세요.',
 '/support':'커피 한 잔으로 K Stock Hub의 업데이트와 서비스 운영을 응원해 주세요.',
 '/desk2':'지수, 종목과 시장 정보를 기존 위젯 데스크 구성으로 확인하세요.',
}

def font(size,bold=False):return ImageFont.truetype(str(BOLD if bold else FONT),size)
def wrap(draw,text,face,width):
 lines=[];line=''
 for char in text:
  if line and draw.textlength(line+char,font=face)>width:lines.append(line.rstrip());line=''
  line+=char
 if line:lines.append(line.rstrip())
 return lines

def motif(draw,path,group,accent,rng):
 cx,cy=914,312
 faint='#56425f';white='#f3ecdc';gold='#f4d34c'
 if 'orbit' in path or path=='/hub':
  for i in range(4):
   radius=65+i*38;draw.ellipse((cx-radius,cy-radius*.65,cx+radius,cy+radius*.65),outline=faint,width=2)
   angle=rng.random()*math.tau;x=cx+math.cos(angle)*radius;y=cy+math.sin(angle)*radius*.65;r=14+i*3
   draw.ellipse((x-r,y-r,x+r,y+r),fill=[accent,gold,'#f27560','#a8bca0'][i],outline=white,width=2)
   for band in range(3):draw.arc((x-r+3,y-r+band*6,x+r-2,y+r-band*3),0,160,fill=faint,width=2)
  draw.ellipse((cx-30,cy-30,cx+30,cy+30),fill=accent,outline=white,width=3)
 elif ('map' in path and path!='/realestate-map') or 'bubbles' in path:
  if 'bubbles' in path:
   for i in range(18):
    r=rng.randint(13,47);x=rng.randint(758,1088);y=rng.randint(170,462)
    draw.ellipse((x-r,y-r,x+r,y+r),fill=['#503066','#856133','#6c3949'][i%3],outline=[accent,gold,'#f27560'][i%3],width=2)
  else:
   for row in range(4):
    x=735
    for col in range(3):
     w=[110,95,130][col]+rng.randint(-14,14);y=174+row*74
     draw.rectangle((x,y,x+w-6,y+66),fill=['#503066','#7a6131','#753d4d','#37493f'][(row+col+len(path))%4],outline=accent if row==col else faint,width=2);x+=w
 elif path in ('/drone-explore','/realestate-map'):
  for row in range(4):
   for col in range(4):
    x=775+col*60-row*23;y=310+row*34+col*11;h=rng.randint(30,115)
    draw.polygon([(x,y),(x+40,y+14),(x+40,y-h+14),(x,y-h)],fill='#493358',outline=accent)
    draw.polygon([(x+40,y+14),(x+63,y),(x+63,y-h),(x+40,y-h+14)],fill='#261e31',outline=faint)
    draw.polygon([(x,y-h),(x+23,y-h-14),(x+63,y-h),(x+40,y-h+14)],fill='#72538a',outline=accent)
  if path=='/drone-explore':
   draw.line([(920,170),(986,202),(1050,167),(986,135),(920,170)],fill=gold,width=4)
   for x,y in [(920,170),(986,202),(1050,167),(986,135)]:draw.ellipse((x-14,y-6,x+14,y+6),outline=gold,width=3)
 elif path=='/support':
  draw.rounded_rectangle((798,236,1010,399),radius=45,fill='#302039',outline=accent,width=5)
  draw.arc((966,252,1082,355),270,90,fill=gold,width=8);draw.line((780,420,1045,420),fill=gold,width=5)
  for x in (838,902,966):draw.line([(x,208),(x-10,186),(x+4,157)],fill=accent,width=4)
 elif group=='assets':
  if '/prices/' in path and any(k in path for k in ('bitcoin','ethereum','xrp')):
   draw.ellipse((790,188,1040,438),fill='#2c2038',outline=accent,width=6)
   draw.ellipse((805,203,1025,423),outline=faint,width=2)
   mark={'bitcoin':'BTC','ethereum':'ETH','xrp':'XRP'}[path.split('/')[-1]]
   draw.text((cx,306),mark,font=font(54,True),fill=gold,anchor='mm')
   for i in range(10):
    a=i*math.tau/10;x=cx+math.cos(a)*170;y=cy+math.sin(a)*170;draw.line((cx,cy,x,y),fill=faint,width=1);draw.ellipse((x-5,y-5,x+5,y+5),fill=accent)
  else:
   for i in range(8):
    x=755+i*46;y=rng.randint(185,340);h=rng.randint(40,100)
    draw.line((x+10,y-26,x+10,y+h+25),fill=accent,width=2);draw.rectangle((x,y,x+21,y+h),fill=accent if i%2 else gold)
 elif group=='intelligence' or path=='/discussion-explorer':
  if path=='/investors':
   for i in range(6):draw.arc((775,175,1060,460),i*60+5,(i+1)*60-5,fill=[accent,gold,'#f27560','#a8bca0','#72599e','#b98e52'][i],width=48)
   draw.text((918,318),'HOLDINGS',font=font(18,True),fill=white,anchor='mm')
  elif path=='/investment-videos':
   for i in range(3):
    x=745+i*29;y=175+i*90;draw.rounded_rectangle((x,y,x+300,y+145),radius=8,fill='#281e30',outline=accent if i==2 else faint,width=2)
   draw.polygon([(913,384),(913,441),(960,413)],fill=gold)
  elif path=='/dram-price':
   draw.rectangle((805,208,1038,426),fill='#302039',outline=accent,width=4)
   for i in range(7):
    v=825+i*31;draw.line((v,183,v,207),fill=gold,width=6);draw.line((v,427,v,451),fill=gold,width=6)
    h=225+i*29;draw.line((780,h,803,h),fill=accent,width=5);draw.line((1039,h,1065,h),fill=accent,width=5)
   draw.text((920,315),'DRAM',font=font(40,True),fill=gold,anchor='mm')
  elif path=='/ai-prediction':
   nodes=[(760,240),(760,360),(863,193),(863,300),(863,410),(973,240),(973,360),(1081,301)]
   for a in nodes[:5]:
    for b in nodes[5:]:draw.line((*a,*b),fill=faint,width=2)
   for i,(x,y) in enumerate(nodes):draw.ellipse((x-17,y-17,x+17,y+17),fill='#302039',outline=gold if i==7 else accent,width=3)
  elif path=='/ai-prediction/grading':
   for i in range(4):
    y=186+i*65;draw.rectangle((770,y,805,y+35),outline=accent,width=2)
    draw.line([(778,y+17),(786,y+25),(802,y+7)],fill=gold,width=4)
    draw.rectangle((837,y+7,837+int(220-i*31),y+25),fill=accent if i%2 else gold)
  elif path=='/discussion-explorer':
   for i in range(3):
    x=745+(i%2)*70;y=179+i*90;draw.rounded_rectangle((x,y,x+270,y+75),radius=12,fill='#302039',outline=accent if i%2 else gold,width=3)
    draw.polygon([(x+40,y+75),(x+40,y+91),(x+65,y+75)],fill=accent)
    for j in range(3):draw.ellipse((x+75+j*48,y+32,x+86+j*48,y+43),fill=white)
  else:
   for i in range(3):
    x=750+i*(18 if path=='/news' else 4);y=170+i*(100 if path=='/news' else 87)
    draw.rounded_rectangle((x,y,1080+i*8,y+78),radius=4,fill='#281e30',outline=accent if i==0 else faint,width=2)
    draw.rectangle((x+15,y+17,x+49,y+51),fill=[accent,gold,'#f27560'][i])
    for j in range(3):draw.line((x+64,y+20+j*15,x+rng.randint(215,285)-j*34,y+20+j*15),fill=white if j==0 else faint,width=3)
 elif group=='rankings' or path=='/etf':
  for i in range(6):
   y=188+i*43;w=rng.randint(110,300);draw.text((735,y),f'{i+1:02}',font=font(16),fill='#b9aabf');draw.rectangle((774,y,774+w,y+23),fill=[accent,gold,'#f27560'][i%3])
 else:
  points=[(730+i*12,320+math.sin(i*.34)*47+rng.uniform(-32,32)-i*1.2) for i in range(32)]
  for row in range(5):draw.line((734,160+row*70,1120,160+row*70),fill=faint,width=1)
  draw.line(points,fill=accent,width=4,joint='curve')
  for i in range(0,32,5):x,y=points[i];draw.ellipse((x-5,y-5,x+5,y+5),fill=gold)

def render(path,ko,en,group,description,index):
 seed=int(hashlib.sha256(path.encode()).hexdigest()[:12],16);rng=random.Random(seed)
 accent={'markets':'#f4d34c','maps':'#bf85ff','intelligence':'#d398ff','rankings':'#f27560','explore':'#c697ff','assets':'#d6b54e'}[group]
 if path in ('/global','/prices/wti','/prices/gold','/prices/silver'):accent='#f27560'
 if path in ('/prices/bitcoin','/prices/ethereum','/prices/xrp'):accent='#bf85ff'
 im=Image.new('RGB',(1200,630),'#100d13');d=ImageDraw.Draw(im)
 for y in range(630):
  mix=y/630;d.line((0,y,1200,y),fill=(int(16+mix*8),int(13+mix*4),int(19+mix*10)))
 for x in range(690,1170,38):d.line((x,124,x,510),fill='#241b2b')
 for y in range(124,510,38):d.line((690,y,1170,y),fill='#241b2b')
 d.rectangle((24,24,1175,605),outline='#58415e',width=1)
 d.line((24,24,390,24),fill=accent,width=3);d.line((1175,300,1175,605),fill=accent,width=3)
 d.rounded_rectangle((59,54,105,100),radius=9,fill='#f4d34c');d.text((82,77),'K',font=font(35,True),fill='#1a0e22',anchor='mm')
 d.text((122,58),'K STOCK HUB',font=font(29,True),fill='#f3ecdc')
 d.text((65,131),f'{group.upper()}  /  NEO GENESIS',font=font(13),fill=accent)
 title_lines=wrap(d,ko,font(60,True),625)
 for i,line in enumerate(title_lines[:2]):d.text((59,181+i*80),line,font=font(60,True),fill='#f3ecdc')
 subtitle_y=181+len(title_lines[:2])*80+7
 d.text((63,subtitle_y),en.upper(),font=font(17,True),fill=accent)
 desc_y=max(355,subtitle_y+47)
 for i,line in enumerate(wrap(d,description,font(22),610)[:3]):d.text((63,desc_y+i*34),line,font=font(22),fill='#bfb0c8')
 motif(d,path,group,accent,rng)
 d.line((63,526,1135,526),fill='#58415e',width=1)
 d.text((63,549),'KOSPIMAP.COM'+(' /' if path=='/' else path.upper()),font=font(16),fill='#d6b54e')
 d.text((1137,548),f'{index:02}  /  MARKET INTELLIGENCE',font=font(12),fill='#a99aaa',anchor='ra')
 digest=hashlib.sha256(('social-v2|'+path+'|'+ko+'|'+description).encode()).hexdigest()[:10]
 slug=path.strip('/').replace('/','-') or 'home';image=f'/img/social/{slug}-{digest}.png'
 im.save(ROOT/'frontend/public'/image.lstrip('/'),optimize=True)
 return {'title':f'{ko} | K Stock Hub','description':description,'image':image,'alt':f'K Stock Hub {ko} — {en}'}

def main():
 nav=(ROOT/'frontend/src/neo/navigation.ts').read_text(encoding='utf-8')
 entries=[]
 for group,body in re.findall(r'\{ id: "([^"]+)".*?links: \[(.*?)\n  \] \}',nav,re.S):
  for url,ko,en in re.findall(r'\["([^"]+)", "([^"]+)", "([^"]+)"\]',body):entries.append((url.split('?')[0],ko,en,group))
 assert len(entries)>=42,len(entries)
 cards={}
 for index,(path,ko,en,group) in enumerate(entries,1):
  if path.startswith('/prices/'):
   description=f'{ko}의 최근 1년 차트와 날짜별 시가·고가·저가·종가, 등락 내역을 확인하세요.'
  else:description=DESCRIPTIONS[path]
  cards[path]=render(path,ko,en,group,description,index)
 assert len(set(card['image'] for card in cards.values()))==len(cards)
 data=json.dumps(cards,ensure_ascii=False,indent=2)+'\n'
 (ROOT/'backend/app/data/social_cards.json').write_text(data,encoding='utf-8')
 (ROOT/'frontend/src/neo/socialCards.json').write_text(data,encoding='utf-8')
 print(json.dumps({'pages':len(cards),'images':len(cards),'bytes':sum((ROOT/'frontend/public'/card['image'].lstrip('/')).stat().st_size for card in cards.values())}))

if __name__=='__main__':main()
