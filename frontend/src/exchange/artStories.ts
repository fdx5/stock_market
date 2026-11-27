export interface ArtistNote {
  lifespan: string;
  originKo: string;
  originEn: string;
  movementKo: string;
  movementEn: string;
  bioKo: string;
  bioEn: string;
  keywordsKo: string[];
  keywordsEn: string[];
}

export interface ArtworkDetail {
  titleKo: string;
  titleEn: string;
  textKo: string;
  textEn: string;
}

export interface ArtworkStory {
  artistId: string;
  movementKo: string;
  movementEn: string;
  mediumKo: string;
  mediumEn: string;
  collectionKo: string;
  collectionEn: string;
  leadKo: string;
  leadEn: string;
  storyKo: string[];
  storyEn: string[];
  details: ArtworkDetail[];
}

export const ARTISTS: Record<string, ArtistNote> = {
  "van-gogh": {
    lifespan: "1853–1890",
    originKo: "네덜란드",
    originEn: "Netherlands",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    bioKo: "화랑 직원과 전도사를 거쳐 27세라는 늦은 나이에 붓을 잡았지만, 불과 10년 남짓한 활동 기간 동안 900여 점의 유화를 남기며 서양 미술사의 방향을 바꾼 화가입니다. 생전에는 경제적 궁핍과 정신적 고통에 시달렸으나, 동생 테오와 주고받은 수백 통의 편지에는 색채와 빛으로 인간의 감정을 표현하려던 치열한 예술 혼이 고스란히 담겨 있습니다.",
    bioEn: "Beginning his painting career at twenty-seven after working as an art dealer and preacher, Vincent van Gogh produced roughly 900 oil paintings in a single decade. Though he struggled with poverty and mental illness during his lifetime, his expressive brushwork and emotional use of color reshaped modern art.",
    keywordsKo: ["임파스토 붓질", "보색 대비", "내면의 색채"],
    keywordsEn: ["Impasto brushwork", "Complementary color", "Emotional light"],
  },
  "monet": {
    lifespan: "1840–1926",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    bioKo: "실내 아틀리에를 벗어나 야외로 나가 빛과 대기의 순간적인 변화를 화폭에 옮긴 인상주의의 선구자입니다. 같은 풍경을 시간대와 계절에 따라 반복해 그린 연작을 통해 사물의 고유색보다 ‘눈에 비치는 빛의 인상’이 회화의 본질임을 증명했으며, 말년에는 지베르니 정원의 수련 연못을 그리며 추상미술의 문턱까지 나아갔습니다.",
    bioEn: "A founding master of Impressionism, Claude Monet painted outdoors to capture shifting light, weather, and atmosphere. Through series works—culminating in his Giverny water lily garden—he transformed perception of light into the primary subject of painting.",
    keywordsKo: ["야외 사생", "빛의 순간 포착", "연작 회화"],
    keywordsEn: ["En plein air", "Fleeting light", "Series painting"],
  },
  "klimt": {
    lifespan: "1862–1918",
    originKo: "오스트리아",
    originEn: "Austria",
    movementKo: "빈 분리파 · 상징주의",
    movementEn: "Vienna Secession · Symbolism",
    bioKo: "19세기 말 보수적인 아카데미즘에 반기를 들고 ‘빈 분리파’를 창립한 오스트리아 대표 거장입니다. 금세공사였던 아버지의 영향과 이탈리아 라벤나에서 접한 비잔틴 모자이크의 영감을 결합해, 실제 금박과 정교한 장식 문양으로 관능과 신비로움을 극대화한 ‘황금 시기’ 걸작들을 남겼습니다.",
    bioEn: "Co-founder of the Vienna Secession, Gustav Klimt broke away from conservative academic painting. Inspired by his goldsmith father and Byzantine mosaics in Ravenna, he fused real gold leaf, ornamental geometry, and sensuous figuration in his famed Golden Phase.",
    keywordsKo: ["황금 시기", "금박 장식", "장식적 상징주의"],
    keywordsEn: ["Golden Phase", "Gold leaf", "Ornamental symbolism"],
  },
  "vermeer": {
    lifespan: "1632–1675",
    originKo: "네덜란드",
    originEn: "Netherlands",
    movementKo: "네덜란드 황금기 · 바로크",
    movementEn: "Dutch Golden Age · Baroque",
    bioKo: "네덜란드 델프트에서 평생을 보낸 ‘빛의 마술사’입니다. 현재 전해지는 작품이 35점 안팎에 불과할 만큼 극도로 치밀하고 느리게 작업했으며, 고가의 청금석(울트라마린) 안료와 정교한 광학 관찰을 통해 평범한 실내 풍경 속에 시간이 멈춘 듯한 고요함과 영원성을 담아냈습니다.",
    bioEn: "Working slowly and meticulously in Delft, Johannes Vermeer left behind only around thirty-five known paintings. Celebrated for his luminous natural light, prized ultramarine blue, and serene domestic interiors, he elevated everyday stillness into quiet poetry.",
    keywordsKo: ["측면 자연광", "울트라마린 청색", "고요한 실내극"],
    keywordsEn: ["Side daylight", "Ultramarine blue", "Quiet intimacy"],
  },
  "hokusai": {
    lifespan: "1760–1849",
    originKo: "일본",
    originEn: "Japan",
    movementKo: "우키요에",
    movementEn: "Ukiyo-e",
    bioKo: "에도 시대 일본 목판화 우키요에를 세계 미술사의 반열에 올린 거장입니다. 평생 30번 넘게 아호를 바꾸고 90여 차례 이사를 다니며 3만 점 가까운 그림을 남겼고, 70세를 넘겨 완성한 《후가쿠 36경》은 훗날 모네·고흐·드뷔시 등 유럽 인상주의와 자포니즘 열풍에 결정적 영향을 미쳤습니다.",
    bioEn: "A towering master of Edo-period ukiyo-e woodblock prints, Katsushika Hokusai created his iconic Thirty-Six Views of Mount Fuji past the age of seventy. His bold compositions and graphic rhythm profoundly influenced Monet, Van Gogh, and European Japonisme.",
    keywordsKo: ["다색 목판화", "대담한 구도", "자포니즘의 원천"],
    keywordsEn: ["Woodblock print", "Bold geometry", "Inspiration for Japonisme"],
  },
  "botticelli": {
    lifespan: "1445–1510",
    originKo: "이탈리아",
    originEn: "Italy",
    movementKo: "초기 르네상스",
    movementEn: "Early Renaissance",
    bioKo: "피렌체 메디치 가문의 후원을 받으며 초기 르네상스 회화의 우아한 정점을 이룬 화가입니다. 해부학적 사실성이나 엄격한 명암보다 유려하게 흐르는 선과 시적인 리듬을 중시했으며, 고대 그리스·로마 신화를 기독교 인문주의와 결합해 몽환적이고 이상화된 아름다움을 창조했습니다.",
    bioEn: "Patronized by Florence's Medici circle, Sandro Botticelli brought lyrical line and poetic grace to Early Renaissance painting. He revitalized classical Greco-Roman mythology in monumental works that prized rhythmic beauty over strict sculptural realism.",
    keywordsKo: ["유려한 선묘", "고전 신화 부활", "피렌체 르네상스"],
    keywordsEn: ["Lyrical line", "Classical mythology", "Florentine Renaissance"],
  },
  "da-vinci": {
    lifespan: "1452–1519",
    originKo: "이탈리아",
    originEn: "Italy",
    movementKo: "전성기 르네상스",
    movementEn: "High Renaissance",
    bioKo: "화가이자 해부학자, 건축가, 발명가였던 ‘르네상스 만능인’의 상징입니다. 빛과 공기가 사물의 윤곽을 부드럽게 녹이는 ‘스푸마토(Sfumato)’ 기법과 대기원근법을 완성해 회화를 단순한 장인의 기술에서 과학적·철학적 탐구의 경지로 끌어올렸습니다.",
    bioEn: "The archetype of the Renaissance polymath—painter, anatomist, engineer, and scientist—Leonardo da Vinci perfected sfumato and aerial perspective, uniting empirical observation of nature with enigmatic psychological depth.",
    keywordsKo: ["스푸마토 기법", "대기원근법", "과학과 예술의 융합"],
    keywordsEn: ["Sfumato", "Aerial perspective", "Art & science"],
  },
  "rembrandt": {
    lifespan: "1606–1669",
    originKo: "네덜란드",
    originEn: "Netherlands",
    movementKo: "바로크 · 네덜란드 황금기",
    movementEn: "Baroque · Dutch Golden Age",
    bioKo: "빛과 어둠의 극적인 대비(키아로스쿠로)로 인간의 내면과 존엄을 꿰뚫은 네덜란드 최고의 거장입니다. 젊은 시절 암스테르담에서 큰 명성과 부를 누렸으나 말년에는 파산과 가족의 죽음을 겪었고, 그 깊은 고독 속에서도 끝까지 자신을 응시한 수많은 자화상과 걸작을 남겼습니다.",
    bioEn: "Master of dramatic chiaroscuro and psychological truth, Rembrandt van Rijn transformed Dutch Baroque painting. From triumphant Amsterdam fame to late-life bankruptcy and loss, he painted humanity—including dozens of unsparing self-portraits—with unmatched empathy.",
    keywordsKo: ["빛과 어둠의 대비", "극적 연출", "깊은 인간 통찰"],
    keywordsEn: ["Chiaroscuro", "Theatrical drama", "Human empathy"],
  },
  "seurat": {
    lifespan: "1859–1891",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "신인상주의 · 점묘법",
    movementEn: "Neo-Impressionism · Pointillism",
    bioKo: "인상주의의 직관적인 붓질에 광학 이론과 수학적 질서를 결합해 ‘신인상주의’를 창시한 화가입니다. 팔레트에서 물감을 섞지 않고 캔버스 위에 순수한 원색 점을 나란히 찍어 관람객의 망막에서 색이 혼합되게 하는 점묘법을 확립했으나, 31세의 젊은 나이에 요절했습니다.",
    bioEn: "Founder of Neo-Impressionism, Georges Seurat applied optical color theory and disciplined geometry to modern life. By placing tiny dots of pure pigment side by side to blend in the viewer's eye, he pioneered Pointillism before dying at thirty-one.",
    keywordsKo: ["점묘법(분할주의)", "광학 색채 이론", "고전적 구도 질서"],
    keywordsEn: ["Pointillism", "Optical color theory", "Monumental order"],
  },
  "renoir": {
    lifespan: "1841–1919",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    bioKo: "“그림은 즐겁고 유쾌하며 아름다운 것이어야 한다”고 믿었던 행복의 화가입니다. 도자기 화공 출신답게 부드럽고 투명한 색채 감각이 뛰어났으며, 파리 시민들의 축제와 햇살, 인물들의 생기 넘치는 표정을 따뜻한 붓질로 담아냈습니다. 말년 심각한 류머티즘 관절염으로 손이 굳었을 때도 붓을 손에 묶고 그림을 놓지 않았습니다.",
    bioEn: "Trained early as a porcelain painter, Pierre-Auguste Renoir celebrated joy, conviviality, and sunlit Parisian life. Even in old age, crippled by severe rheumatoid arthritis, he continued painting radiant canvases with brushes bound to his hands.",
    keywordsKo: ["따뜻한 햇살 묘사", "행복한 일상", "부드러운 색채"],
    keywordsEn: ["Dappled sunlight", "Joyful scenes", "Luminous color"],
  },
  "munch": {
    lifespan: "1863–1944",
    originKo: "노르웨이",
    originEn: "Norway",
    movementKo: "표현주의 · 상징주의",
    movementEn: "Expressionism · Symbolism",
    bioKo: "어린 시절 어머니와 누이의 죽음, 가족의 병력이라는 깊은 상처를 예술로 승화시킨 노르웨이 표현주의의 선구자입니다. 눈에 보이는 외형보다 불안·고독·질투·죽음 같은 인간의 원초적 감정을 왜곡된 선과 강렬한 색채로 시각화하며 20세기 현대 회화의 내면 세계를 열었습니다.",
    bioEn: "Shaped by early family bereavement and illness, Norwegian pioneer Edvard Munch turned inward to depict anxiety, love, grief, and mortality. His raw lines and intense psychological palette became a cornerstone of twentieth-century Expressionism.",
    keywordsKo: ["내면의 불안", "왜곡된 곡선", "표현주의 선구"],
    keywordsEn: ["Psychological rawness", "Sinuous distortion", "Expressionist pioneer"],
  },
  "friedrich": {
    lifespan: "1774–1840",
    originKo: "독일",
    originEn: "Germany",
    movementKo: "독일 낭만주의",
    movementEn: "German Romanticism",
    bioKo: "거대하고 신비로운 자연 앞에 선 인간의 고독과 숭고미를 그려낸 독일 낭만주의 풍경화의 대표자입니다. 인물의 뒷모습을 화면 중앙에 배치하는 ‘뤼켄피구어(Rückenfigur)’ 구도를 즐겨 사용해, 관람객이 그림 속 인물의 시선으로 광활한 자연을 함께 명상하게 만들었습니다.",
    bioEn: "The defining master of German Romantic landscape painting, Caspar David Friedrich portrayed nature as a mirror of spiritual awe and human solitude. His signature Rückenfigur (figure seen from behind) invites viewers directly into silent contemplation.",
    keywordsKo: ["숭고미(Sublime)", "뒷모습 구도", "명상적 자연"],
    keywordsEn: ["The Sublime", "Rückenfigur", "Spiritual landscape"],
  },
  "bruegel": {
    lifespan: "c. 1525–1569",
    originKo: "플랑드르(네덜란드·벨기에)",
    originEn: "Flanders",
    movementKo: "북유럽 르네상스",
    movementEn: "Northern Renaissance",
    bioKo: "신화나 귀족 중심이던 시대에 농민들의 소박한 일상, 속담, 계절의 변화를 탁월한 관찰력과 유머로 담아내 ‘농민 브뤼헐’이라 불린 거장입니다. 높은 시점에서 광활한 대지와 수많은 군상을 파노라마처럼 펼쳐 보이며, 자연의 순환 속에서 살아가는 인간의 모습을 정밀하게 기록했습니다.",
    bioEn: "Nicknamed 'Peasant Bruegel,' Pieter Bruegel the Elder elevated everyday rural life, folklore, and seasonal landscapes to monumental art. His sweeping elevated viewpoints capture both grand natural cycles and vivid human vignettes.",
    keywordsKo: ["계절 풍경 연작", "파노라마 시점", "민중의 일상 기록"],
    keywordsEn: ["Seasonal cycles", "Panoramic vista", "Peasant life"],
  },
  "van-eyck": {
    lifespan: "c. 1390–1441",
    originKo: "플랑드르(벨기에)",
    originEn: "Flanders",
    movementKo: "초기 플랑드르파 · 북유럽 르네상스",
    movementEn: "Early Netherlandish · Northern Renaissance",
    bioKo: "유화 기법을 완성 단계로 끌어올려 ‘유화의 아버지’로 칭송받는 초기 플랑드르파 거장입니다. 얇은 반투명 유화 물감을 여러 겹 덧칠하는 글레이징 기법으로 금속 광택, 모피의 결, 유리와 거울의 반사까지 경이로운 극사실적 질감으로 구현해냈습니다.",
    bioEn: "A towering innovator of Early Netherlandish art, Jan van Eyck perfected oil glazing techniques to achieve jewel-like luminosity and microscopic realism—from fur and brass to reflections in convex glass.",
    keywordsKo: ["유화 글레이징 완성", "극사실적 질감", "숨겨진 상징"],
    keywordsEn: ["Oil glazing mastery", "Microscopic realism", "Hidden symbolism"],
  },
  "velazquez": {
    lifespan: "1599–1660",
    originKo: "스페인",
    originEn: "Spain",
    movementKo: "스페인 바로크",
    movementEn: "Spanish Baroque",
    bioKo: "스페인 펠리페 4세의 궁정 수석 화가로, 마네로부터 “화가 중의 화가”라는 극찬을 받은 거장입니다. 권위적인 왕실 인물뿐 아니라 궁정의 시녀와 난쟁이까지 편견 없는 사실주의로 그려냈으며, 가까이서 보면 자유분방한 붓 자국이지만 떨어져 보면 완벽한 공간과 빛으로 살아나는 마법 같은 필치를 선보였습니다.",
    bioEn: "Court painter to King Philip IV of Spain and hailed by Manet as 'the painter of painters,' Diego Velázquez combined fearless realism with breathtakingly fluid brushwork that resolves into living air and space from afar.",
    keywordsKo: ["화가 중의 화가", "공간과 시선의 유희", "자유로운 필치"],
    keywordsEn: ["Painter of painters", "Spatial illusion", "Fluid brushwork"],
  },
  "turner": {
    lifespan: "1775–1851",
    originKo: "영국",
    originEn: "United Kingdom",
    movementKo: "영국 낭만주의",
    movementEn: "British Romanticism",
    bioKo: "‘빛의 화가’로 불리며 영국 풍경화의 위상을 최고조로 끌어올린 낭만주의 거장입니다. 폭풍우 치는 바다와 타오르는 석양, 증기기관의 연기를 형체가 녹아내릴 만큼 과감한 색채 소용돌이로 표현해 훗날 프랑스 인상주의와 20세기 추상표현주의의 선구자로 평가받습니다.",
    bioEn: "Known as 'the painter of light,' J. M. W. Turner revolutionized landscape and seascape painting with incandescent color, mist, and atmospheric drama—foreshadowing both French Impressionism and abstract art.",
    keywordsKo: ["빛의 화가", "대기와 석양", "산업 시대의 시선"],
    keywordsEn: ["Painter of light", "Atmospheric glow", "Industrial sublime"],
  },
  "cezanne": {
    lifespan: "1839–1906",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    bioKo: "피카소와 마티스 모두가 “우리 모두의 아버지”라고 부른 현대미술의 개척자입니다. 자연을 원통·구·원뿔 같은 기하학적 구조로 환원하고 단일 시점 원근법을 과감히 해체함으로써, 19세기 인상주의와 20세기 입체주의(큐비즘)를 잇는 결정적인 다리를 놓았습니다.",
    bioEn: "Called 'the father of us all' by both Picasso and Matisse, Paul Cézanne built form through structured planes of color and multiple viewpoints, bridging Impressionism and twentieth-century Cubism.",
    keywordsKo: ["현대미술의 아버지", "기하학적 구조", "다시점 원근법"],
    keywordsEn: ["Father of modern art", "Geometric planes", "Shifting perspective"],
  },
  "gauguin": {
    lifespan: "1848–1903",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "후기인상주의 · 종합주의",
    movementEn: "Post-Impressionism · Synthetism",
    bioKo: "성공한 파리의 주식 중개인이었던 안정된 삶을 버리고 전업 화가의 길로 뛰어든 이단아입니다. 서구 문명의 인위성을 떠나 브르타뉴와 남태평양 타히티로 건너가, 대담한 평면 색채와 굵은 윤곽선으로 원시적 생명력과 인간의 근원적 질문을 화폭에 담았습니다.",
    bioEn: "Abandoning a prosperous career as a Parisian stockbroker to become an artist, Paul Gauguin journeyed to Brittany and Tahiti in search of raw authenticity, pioneering bold flat color fields and symbolic storytelling.",
    keywordsKo: ["증권가 출신 화가", "타히티 원시주의", "대담한 평면 색채"],
    keywordsEn: ["Former stockbroker", "Tahitian symbolism", "Bold flat color"],
  },
  "raphael": {
    lifespan: "1483–1520",
    originKo: "이탈리아",
    originEn: "Italy",
    movementKo: "전성기 르네상스",
    movementEn: "High Renaissance",
    bioKo: "레오나르도 다 빈치, 미켈란젤로와 함께 전성기 르네상스 3대 거장으로 꼽히는 조화와 균형의 천재입니다. 두 선배 거장의 장점을 흡수해 명쾌하고 이상적인 공간 구성과 우아한 인물 표현을 완성했으며, 불과 37세의 나이에 세상을 떠났지만 서양 고전주의 미학의 영원한 표준이 되었습니다.",
    bioEn: "Alongside Leonardo and Michelangelo, Raphael defined the High Renaissance through supreme clarity, harmony, and spatial balance. Despite dying at thirty-seven, his frescoes and Madonnas set the enduring standard of classical grace.",
    keywordsKo: ["르네상스 3대 거장", "완벽한 균형과 조화", "바티칸 프레스코"],
    keywordsEn: ["High Renaissance master", "Classical harmony", "Vatican frescoes"],
  },
  "manet": {
    lifespan: "1832–1883",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "사실주의 · 인상주의 선구",
    movementEn: "Realism · Modernism",
    bioKo: "신화나 역사화 대신 동시대 파리의 카페, 거리, 현대인의 초상을 정면으로 그려 ‘모더니즘 회화의 아버지’로 불리는 화가입니다. 전통적인 명암법과 낭만적 이상화를 거부한 파격적인 화풍으로 매번 살롱전에서 스캔들을 일으켰지만, 젊은 인상파 화가들에게 정신적 지주가 되었습니다.",
    bioEn: "Widely hailed as the father of modern painting, Édouard Manet broke academic conventions by portraying contemporary Parisian life with stark tonal contrast, unflinching gaze, and self-aware painterly flatness.",
    keywordsKo: ["모더니즘의 아버지", "파리 현대 생활", "도발적 시선"],
    keywordsEn: ["Father of modernism", "Modern Paris", "Direct gaze"],
  },
  "degas": {
    lifespan: "1834–1917",
    originKo: "프랑스",
    originEn: "France",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    bioKo: "인상주의 전시에 적극 참여하면서도 야외 풍경보다 발레 연습실, 경마장, 카페 등 실내의 역동적인 움직임에 매료되었던 관찰의 거장입니다. 사진의 스냅샷과 일본 판화의 비대칭 구도를 받아들여, 무대 뒤 무용수들의 땀과 고된 연습 순간을 냉철하면서도 우아하게 포착했습니다.",
    bioEn: "Though a core organizer of Impressionist exhibitions, Edgar Degas preferred indoor light and disciplined draftsman-like observation. Influenced by photography and Japanese prints, he captured candid, off-center glimpses of dancers backstage.",
    keywordsKo: ["발레 무용수 연작", "스냅샷 비대칭 구도", "움직임의 포착"],
    keywordsEn: ["Ballet rehearsals", "Snapshot cropping", "Motion study"],
  },
  "kim-hong-do": {
    lifespan: "1745–c. 1806",
    originKo: "조선",
    originEn: "Joseon Dynasty (Korea)",
    movementKo: "조선 후기 풍속화",
    movementEn: "Late Joseon Genre Painting",
    bioKo: "단원(檀園)이라는 호로 널리 알려진 조선 후기 최고의 도화서 화원입니다. 정조의 총애를 받으며 어진과 궁중 기록화를 그렸을 뿐만 아니라, 서당·대장간·씨름판 같은 서민들의 삶의 현장을 해학과 생동감 넘치는 필치로 담아내 우리 풍속화의 황금기를 열었습니다.",
    bioEn: "Known by his pen name Danwon, Kim Hong-do was the foremost court painter of late Joseon Korea under King Jeongjo. Celebrated for his humor, rhythmic brushwork, and warmth, he brought ordinary Korean folk life to vivid artistic prominence.",
    keywordsKo: ["단원 풍속도첩", "해학과 생동감", "여백의 미"],
    keywordsEn: ["Danwon genre album", "Wit & vitality", "Expressive ink"],
  },
  "jeong-seon": {
    lifespan: "1676–1759",
    originKo: "조선",
    originEn: "Joseon Dynasty (Korea)",
    movementKo: "조선 후기 진경산수화",
    movementEn: "True-View Landscape (Jingyeong Sansuhwa)",
    bioKo: "겸재(謙齋) 정선은 중국의 이상화된 관념 산수화를 모방하던 관습에서 벗어나, 우리 땅 금강산과 인왕산·한강 유역의 실제 풍경을 독창적인 필묵법으로 그려낸 ‘진경산수화’의 창시자입니다. 과감한 부감 시점과 힘찬 붓질로 조선 산천의 기상을 독자적인 조형 언어로 완성했습니다.",
    bioEn: "Known as Gyeomjae, Jeong Seon pioneered Korean True-View Landscape painting (Jingyeong Sansuhwa), breaking away from idealized Chinese scenery to depict Korea's own mountains and rivers with bold, original ink techniques.",
    keywordsKo: ["진경산수화 창시", "적묵법·수직준", "조선 산천의 기상"],
    keywordsEn: ["True-View landscape", "Bold ink washes", "Korean mountain spirit"],
  },
};

export const ARTWORK_STORIES: Record<string, ArtworkStory> = {
  "starry-night": {
    artistId: "van-gogh",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    mediumKo: "캔버스에 유채 · 73.7 × 92.1 cm",
    mediumEn: "Oil on canvas · 73.7 × 92.1 cm",
    collectionKo: "뉴욕 현대미술관 (MoMA)",
    collectionEn: "Museum of Modern Art (MoMA), New York",
    leadKo: "요양원 쇠창살 너머로 바라본 새벽하늘에 고향의 기억과 격정적인 내면을 수놓은 반 고흐의 영혼의 풍경입니다.",
    leadEn: "Painted from his asylum window in Saint-Rémy, Van Gogh fused real pre-dawn skies with memories of his Dutch homeland into a cosmic whirlwind of emotion.",
    storyKo: [
      "1889년 6월, 프랑스 생레미의 생폴 드 모졸 요양원에 스스로 입원한 반 고흐는 동쪽 창문 너머로 펼쳐진 새벽하늘을 바라보며 이 그림을 완성했습니다. 실제 창밖에는 밀밭과 알피유 산맥만 있었지만, 고흐는 상상력을 더해 고요한 마을과 고향 네덜란드 양식의 뾰족한 교회 첨탑을 화면 아래에 배치했습니다.",
      "당시 극심한 발작과 고독 속에서도 고흐는 밤하늘을 어둡게만 보지 않았습니다. 두껍게 물감을 쌓아 올리는 임파스토 기법으로 소용돌이치는 성운과 눈부신 초승달을 그려내어, 고통 너머로 뻗어 나가는 생명력과 우주적 경외감을 담아냈습니다."
    ],
    storyEn: [
      "In June 1889, while staying at the Saint-Paul-de-Mausole asylum in Saint-Rémy-de-Provence, Van Gogh painted the pre-dawn view from his east-facing window. While the Alpilles hills were visible outside, the peaceful village and tall Dutch-style church steeple were born from memory and imagination.",
      "Rather than depicting night as empty darkness, Van Gogh carved swirling currents of ultramarine, cobalt, and luminous yellow with thick impasto strokes—turning inner turmoil into a radiant vision of the cosmos."
    ],
    details: [
      {
        titleKo: "하늘로 솟구치는 사이프러스 나무",
        titleEn: "The Flame-Like Cypress",
        textKo: "전경 왼쪽의 거대한 사이프러스는 전통적으로 죽음과 애도를 상징하지만, 이 그림에서는 땅과 밤하늘을 잇는 검은 불꽃처럼 화면에 강렬한 수직 리듬을 부여합니다.",
        textEn: "Traditionally associated with mourning, the dark cypress rises like a living flame in the left foreground, bridging earth and swirling sky.",
      },
      {
        titleKo: "유체 역학을 닮은 11개의 별과 성운",
        titleEn: "Swirling Nebulae & Bright Venus",
        textKo: "화면 중앙을 휘감는 거대한 소용돌이와 사이프러스 오른쪽의 유독 밝은 금성(샛별)은 4K 확대 시 붓털의 결까지 선명히 보일 만큼 리듬감 있게 겹쳐져 있습니다.",
        textEn: "Zooming in reveals rhythmic concentric halos around eleven stars and a blazing Venus—patterns scientists have even compared to real fluid turbulence.",
      },
      {
        titleKo: "요양원 창밖에는 없던 네덜란드 첨탑",
        titleEn: "An Imagined Dutch Spire",
        textKo: "프로방스 마을 풍경 한가운데 솟아오른 뾰족한 교회 첨탑은 고흐가 그리워하던 고향 네덜란드 브라반트의 교회를 기억해 그려 넣은 요소입니다.",
        textEn: "The pointed church spire rising from the Provençal village recalls the churches of Van Gogh's native Brabant in the Netherlands.",
      },
    ],
  },
  "sunflowers": {
    artistId: "van-gogh",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    mediumKo: "캔버스에 유채 · 92.1 × 73 cm",
    mediumEn: "Oil on canvas · 92.1 × 73 cm",
    collectionKo: "런던 내셔널 갤러리",
    collectionEn: "The National Gallery, London",
    leadKo: "동료 화가 고갱을 맞이하기 위해 ‘노란 집’을 태양의 색으로 가득 채우려 했던 희망과 우정의 상징입니다.",
    leadEn: "Painted in Arles to welcome Paul Gauguin to the Yellow House, this blazing symphony of chrome yellows celebrates friendship and radiant life.",
    storyKo: [
      "1888년 여름, 남프랑스 아를에 정착한 반 고흐는 예술가 공동체를 꿈꾸며 자신이 세 든 ‘노란 집’에 폴 고갱을 초대했습니다. 고흐는 고갱이 머물 방을 환하게 꾸미기 위해 꽃이 시들기 전에 단숨에 그려야 한다며 열정적으로 해바라기 연작에 몰두했습니다.",
      "당시 새롭게 개발된 선명한 크롬 옐로 안료 덕분에 고흐는 오직 노란색과 황토색의 미묘한 변주만으로 눈부신 광채를 만들어낼 수 있었습니다. 이 작품은 훗날 두 화가의 격렬한 갈등과 비극적 결별을 앞두고 피어난 가장 찬란한 기대의 기록으로 남아 있습니다."
    ],
    storyEn: [
      "In August 1888, dreaming of an artists' studio in Arles, Van Gogh painted sunflowers at breakneck speed to decorate the bedroom prepared for Paul Gauguin. He saw the flower as an emblem of gratitude and Southern light.",
      "Using newly invented chrome yellow pigments, he crafted a near-monochrome harmony of golds, ochres, and lemon tones—preserving the bright optimism of his 'Yellow House' before his tragic rift with Gauguin."
    ],
    details: [
      {
        titleKo: "피고 지는 생명의 모든 단계",
        titleEn: "Every Stage of Life",
        textKo: "만개해 활짝 웃는 꽃봉오리부터 꽃잎이 떨어져 씨방만 남은 시든 해바라기까지 한 화병에 담아, 찬란함과 덧없음을 동시에 노래합니다.",
        textEn: "From freshly blooming petals to heavy, wilting seed heads, the bouquet captures the entire arc of vitality and decay in one vase.",
      },
      {
        titleKo: "화병에 새겨진 소박한 서명 ‘Vincent’",
        titleEn: "A Quiet Signature on the Vase",
        textKo: "성이 아닌 이름 ‘Vincent’만 화병 중앙에 푸른빛으로 서명했습니다. 고흐는 훗날 장인들처럼 이름으로 기억되고 싶어 했으며, 이 작품에 각별한 자부심을 가졌습니다.",
        textEn: "Signed simply 'Vincent' in blue on the earthenware pot—a hallmark reserved for works he felt truly succeeded.",
      },
      {
        titleKo: "조각처럼 돋을새김 된 꽃심 붓질",
        titleEn: "Sculptural Impasto Centers",
        textKo: "확대해 보면 꽃씨 부분을 점처럼 두껍게 찍어 올려 실제 해바라기 꽃술의 거친 입체감을 물감의 질감만으로 구현한 것을 확인할 수 있습니다.",
        textEn: "Up close, thick dabs of ochre, burnt umber, and green build tactile, three-dimensional ridges across each flower's center.",
      },
    ],
  },
  "cafe-terrace": {
    artistId: "van-gogh",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    mediumKo: "캔버스에 유채 · 80.7 × 65.3 cm",
    mediumEn: "Oil on canvas · 80.7 × 65.3 cm",
    collectionKo: "네덜란드 크뢸러 뮐러 미술관",
    collectionEn: "Kröller-Müller Museum, Otterlo",
    leadKo: "검은 물감을 단 한 방울도 쓰지 않고 밤의 따스함과 별빛의 깊이를 완성한 최초의 별밤 걸작입니다.",
    leadEn: "Van Gogh's first starry-sky scene—painted right on the cobbled square in Arles without using a single drop of black paint.",
    storyKo: [
      "1888년 9월, 반 고흐는 아를의 포룸 광장에 이젤을 세우고 가스등 불빛 아래서 직접 야외 작업을 하며 이 작품을 그렸습니다. 그는 여동생 빌에게 보낸 편지에서 “검은색 없이 오직 아름다운 파랑, 보라, 초록만으로 그린 밤의 그림”이라며 깊은 만족감을 드러냈습니다.",
      "이 작품은 《별이 빛나는 밤》보다 먼저 그려진 반 고흐 최초의 별밤 풍경입니다. 그림 속 카페는 오늘날까지도 ‘카페 반 고흐’라는 이름으로 남아 전 세계 여행자들이 찾는 명소가 되었습니다."
    ],
    storyEn: [
      "In September 1888, Van Gogh set up his easel outdoors on Place du Forum in Arles under the warm glow of gas lanterns. As he wrote excitedly to his sister Wil, this was 'a night painting without black, with nothing but beautiful blue and violet and green.'",
      "Predating The Starry Night, it was his very first painting featuring a star-filled sky. The real café still stands in Arles today, famously restored to echo his golden awning."
    ],
    details: [
      {
        titleKo: "노랑과 코발트 블루의 극적인 보색 대비",
        titleEn: "Golden Awning vs. Cobalt Sky",
        textKo: "가스등이 쏟아내는 강렬한 황금빛 테라스와 깊고 서늘한 코발트 블루의 밤하늘이 맞닿으며, 한밤중의 정적 속에서도 따뜻한 온기가 느껴집니다.",
        textEn: "The blazing yellow gaslight of the terrace contrasts directly against the deep blue night sky, creating instant warmth and luminous depth.",
      },
      {
        titleKo: "조약돌 거리를 따라 모이는 소실점",
        titleEn: "Perspective of Cobblestones",
        textKo: "바닥의 거친 붓질이 어두운 골목 깊숙한 곳으로 시선을 자연스럽게 이끌며, 마차와 산책하는 시민들이 살아 숨 쉬는 아를의 밤을 완성합니다.",
        textEn: "Diagonal strokes across the wet-looking cobblestones pull the viewer's eye down the street past strolling figures and a distant carriage.",
      },
      {
        titleKo: "하얀 앞치마를 두른 웨이터와 손님들",
        titleEn: "The Standing Waiter & Diners",
        textKo: "테라스 중앙의 하얀 옷을 입은 웨이터를 중심으로 옹기종기 앉은 손님들의 실루엣이 낭만적인 남프랑스 밤의 정취를 더합니다.",
        textEn: "Under the glowing awning, a white-clad server tends to clustered tables, anchoring the lively human heart of the nocturnal scene.",
      },
    ],
  },
  "almond-blossom": {
    artistId: "van-gogh",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    mediumKo: "캔버스에 유채 · 73.3 × 92.4 cm",
    mediumEn: "Oil on canvas · 73.3 × 92.4 cm",
    collectionKo: "암스테르담 반 고흐 미술관",
    collectionEn: "Van Gogh Museum, Amsterdam",
    leadKo: "자신의 이름을 물려받은 갓 태어난 조카의 침대 위에 걸어주기 위해 그린, 반 고흐 생애 가장 다정한 축복의 그림입니다.",
    leadEn: "Painted as a tender gift for his newborn nephew and namesake, these early-spring almond blossoms symbolize hope, renewal, and family love.",
    storyKo: [
      "1890년 1월 말, 반 고흐는 동생 테오와 제수 요한나 사이에 건강한 아들이 태어났으며 아기 이름을 자신의 이름과 같은 ‘빈센트 빌럼’으로 지었다는 기쁜 편지를 받았습니다. 크게 감동한 고흐는 요양원 정원에서 봄을 가장 먼저 알리는 아몬드 꽃을 그려 아기의 침실에 걸 선물로 보냈습니다.",
      "청록빛 맑은 하늘을 배경으로 뻗어 나가는 힘찬 나뭇가지와 섬세한 윤곽선은 고흐가 깊이 사랑했던 일본 우키요에 판화의 영향이 뚜렷합니다. 생을 마감하기 불과 다섯 달 전 그려진 이 작품은 고흐 가문이 끝까지 소중히 간직하며 오늘날 암스테르담 반 고흐 미술관의 핵심 소장품이 되었습니다."
    ],
    storyEn: [
      "In early 1890, Van Gogh received joyous news that his brother Theo and sister-in-law Jo had welcomed a baby boy—named Vincent Willem after him. Deeply moved, Vincent painted flowering almond branches, the earliest herald of Provençal spring, to hang above the baby's crib.",
      "Crisp dark outlines and branches set against a flat turquoise sky reflect his deep admiration for Japanese ukiyo-e prints. Treasured by the family above all other works, it became a cornerstone of the Van Gogh Museum."
    ],
    details: [
      {
        titleKo: "아래에서 올려다본 수평선 없는 구도",
        titleEn: "Looking Upward to Open Sky",
        textKo: "지평선과 땅을 완전히 생략하고 마치 아기가 요람에 누워 하늘을 올려다보는 듯한 시점으로 화면을 채워 평온한 해방감을 선사합니다.",
        textEn: "Eliminating the horizon entirely, the composition mirrors the gentle upward gaze of an infant looking through blossoms into clear sky.",
      },
      {
        titleKo: "우키요에에서 배운 굵은 윤곽과 여백",
        titleEn: "Japonisme in Line & Space",
        textKo: "어두운 청색 윤곽선으로 가지의 꺾임을 또렷이 살리고 청록빛 하늘에 넉넉한 여백을 남겨 동양화 같은 정갈한 우아함을 완성했습니다.",
        textEn: "Bold dark contours along the gnarled branches and airy negative space echo the graphic elegance of Japanese woodblock prints.",
      },
      {
        titleKo: "흰 꽃잎 끝에 스민 붉은 꽃받침",
        titleEn: "Touches of Pink & Red",
        textKo: "확대해 보면 순백색 꽃잎 중심마다 붉고 분홍빛 물감이 섬세하게 찍혀 있어, 청록색 배경과 어우러지며 봄날의 생기를 더합니다.",
        textEn: "Close inspection reveals delicate crimson and blush-pink accents nestled inside each white bloom, sparkling softly against the turquoise sky.",
      },
    ],
  },
  "irises": {
    artistId: "van-gogh",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    mediumKo: "캔버스에 유채 · 71 × 93 cm",
    mediumEn: "Oil on canvas · 71 × 93 cm",
    collectionKo: "로스앤젤레스 J. 폴 게티 미술관",
    collectionEn: "J. Paul Getty Museum, Los Angeles",
    leadKo: "생레미 요양원에 입원한 첫 주, 흔들리는 마음을 붙잡아 준 ‘피뢰침’ 같은 정원의 붓꽃들입니다.",
    leadEn: "Painted during his very first week in the Saint-Rémy asylum, Van Gogh called this vibrant garden study 'the lightning conductor for my illness.'",
    storyKo: [
      "1889년 5월, 생레미 요양원에 도착하자마자 반 고흐가 가장 먼저 붓을 든 대상은 요양원 정원에 무성하게 피어난 붓꽃 화단이었습니다. 그는 동생 테오에게 이 작업이 “내 병을 막아주는 피뢰침”이라며, 오직 자연을 관찰하고 그리는 행위를 통해 정신적 안정을 되찾고 있다고 적었습니다.",
      "고흐는 이 작품을 단순한 습작으로 여겼지만, 테오는 그 예술적 완성도를 단번에 알아보고 그해 파리 앙데팡당 전에 출품했습니다. 1987년에는 당시 세계 미술품 경매 사상 최고가를 기록하며 전 세계의 이목을 집중시키기도 했습니다."
    ],
    storyEn: [
      "Immediately upon entering the asylum at Saint-Rémy in May 1889, Van Gogh began painting the tangled iris beds in its walled garden. He wrote to Theo that immersing himself in nature served as 'the lightning conductor for my illness.'",
      "Though Vincent humbly regarded it as a study from nature, Theo recognized its power at once and exhibited it at the Salon des Indépendants in Paris."
    ],
    details: [
      {
        titleKo: "보랏빛 물결 속 단 한 송이 흰 붓꽃",
        titleEn: "The Solitary White Iris",
        textKo: "화면 왼쪽 상단에 홀로 피어난 흰 붓꽃이 보라와 푸른빛의 거대한 군락 속에서 묘한 대비를 이루며, 종종 고독했던 화가 자신의 상징으로 읽힙니다.",
        textEn: "Standing alone among a sea of violet and indigo petals near the upper left, a single white iris catches the eye—often read as an emblem of the artist himself.",
      },
      {
        titleKo: "각기 다른 표정을 지닌 잎과 꽃잎",
        titleEn: "Every Petal Unique",
        textKo: "수십 송이의 붓꽃이 한 화폭에 얽혀 있지만 단 하나도 같은 모양으로 반복되지 않으며, 칼날처럼 뻗은 청록색 잎사귀들이 역동적인 파동을 만듭니다.",
        textEn: "No two flowers share the same posture; twisting ribbons of blue-green leaves weave an organic rhythm across the entire frame.",
      },
      {
        titleKo: "붉은 흙과 주황빛 금잔화의 색채 균형",
        titleEn: "Warm Earth & Marigolds",
        textKo: "아래쪽의 붉은 갈색 흙과 뒤편의 따스한 주황빛 꽃들이 보라색 붓꽃과 절묘한 보색 조화를 이루며 화면에 생동감을 불어넣습니다.",
        textEn: "Rich russet soil below and bright orange marigolds behind anchor the cool violets with vibrant complementary warmth.",
      },
    ],
  },
  "water-lilies": {
    artistId: "monet",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    mediumKo: "캔버스에 유채 · 89.9 × 94.1 cm",
    mediumEn: "Oil on canvas · 89.9 × 94.1 cm",
    collectionKo: "시카고 미술관",
    collectionEn: "Art Institute of Chicago",
    leadKo: "하늘과 땅의 경계를 지우고 오직 물 위에 비친 빛과 구름, 떠다니는 수련만으로 채운 명상의 수면입니다.",
    leadEn: "Removing sky and shoreline altogether, Monet fills the entire canvas with floating water lilies and the shimmering reflection of clouds above.",
    storyKo: [
      "1893년 프랑스 노르망디 지베르니의 집 옆 부지를 매입한 모네는 직접 시냇물을 끌어와 연못을 파고, 수양버들과 일본식 다리, 다양한 품종의 수련을 심어 자신만의 ‘살아 있는 화실’을 가꾸었습니다. 이후 생을 마칠 때까지 약 250여 점의 《수련》 연작을 남겼습니다.",
      "1906년 작인 이 작품에서는 연못가와 다리, 지평선이 완전히 사라졌습니다. 관람객은 오직 끝없이 펼쳐진 수면을 내려다보게 되며, 물 위에 떠 있는 수련과 물속에 거꾸로 비친 하늘빛이 뒤섞이면서 20세기 추상회화의 새로운 문을 열었습니다."
    ],
    storyEn: [
      "After acquiring land beside his Giverny home in 1893, Monet diverted a stream to build a lush water garden—his living studio for nearly three decades and roughly 250 Water Lilies paintings.",
      "By 1906, Monet abandoned the shoreline and horizon entirely. Looking straight down onto the pond's surface, floating blossoms merge with reflected clouds and willow boughs, nudging painting toward pure abstraction."
    ],
    details: [
      {
        titleKo: "지평선이 사라진 무한의 수면",
        titleEn: "A World Without a Horizon",
        textKo: "땅과 하늘의 기준선을 없애버림으로써 캔버스 사방으로 연못이 끝없이 이어지는 듯한 깊은 몰입감을 만들어냅니다.",
        textEn: "With no bank or skyline to anchor the eye, the pond feels boundless—inviting quiet immersion in shifting surface and depth.",
      },
      {
        titleKo: "수직으로 드리운 구름과 수양버들의 그림자",
        titleEn: "Reflected Sky & Willows",
        textKo: "수련 잎 사이로 길게 쓸어내린 연보라·청색·황금빛 붓질은 물 위에 비친 구름과 버드나무 그림자로, 보이지 않는 캔버스 위쪽의 하늘을 암시합니다.",
        textEn: "Vertical sweeps of lavender, turquoise, and pale gold mirror unseen clouds and overhanging willows above the pond.",
      },
      {
        titleKo: "가까이서 보면 추상, 멀리서 보면 수련",
        titleEn: "From Pure Pigment to Blossoms",
        textKo: "4K로 크게 확대하면 크림빛·분홍·녹색 물감의 자유로운 덩어리로 보이지만, 한 걸음 물러서면 눈부신 햇살 아래 피어난 수련으로 되살아납니다.",
        textEn: "Zoomed in, the blooms dissolve into bold, painterly dabs of cream, rose, and green; stepped back, they shimmer into sunlit lilies.",
      },
    ],
  },
  "impression-sunrise": {
    artistId: "monet",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    mediumKo: "캔버스에 유채 · 48 × 63 cm",
    mediumEn: "Oil on canvas · 48 × 63 cm",
    collectionKo: "파리 마르모탕 모네 미술관",
    collectionEn: "Musée Marmottan Monet, Paris",
    leadKo: "비평가의 조롱 섞인 한마디가 미술사상 가장 사랑받는 사조 ‘인상주의’의 이름으로 탄생한 역사적 출발점입니다.",
    leadEn: "The misty dawn harbor that gave Impressionism its very name—born from a critic's mockery at the landmark 1874 independent exhibition.",
    storyKo: [
      "1872년 11월, 모네는 어린 시절을 보낸 프랑스 항구 도시 르아브르의 호텔 창가에서 자욱한 새벽안개 너머로 떠오르는 붉은 해를 단숨에 그려냈습니다. 1874년 제1회 무명 예술가 협회전에 출품할 때 모네는 “르아브르의 풍경이라 하기엔 부족하니 ‘인상’이라 붙여달라”고 제목을 정했습니다.",
      "전시를 본 보수 비평가 루이 르루아는 “벽지 초안보다도 덜 완성된 인상일 뿐”이라며 ‘인상파 전시회’라고 비아냥거렸습니다. 그러나 모네와 동료 화가들은 이 비난을 당당히 받아들여 스스로를 ‘인상주의자’라 부르며 서양 미술사의 거대한 혁명을 열었습니다."
    ],
    storyEn: [
      "Painted in November 1872 from a hotel window overlooking the harbor of Le Havre, Monet swiftly captured the rising sun piercing morning fog. When asked for a catalog title for the 1874 independent show, he suggested calling it simply 'Impression.'",
      "Hostile critic Louis Leroy mocked the exhibition as a mere display of 'Impressionists,' sneering that wallpaper was more finished. Monet and his peers proudly embraced the label, launching modern art's most beloved movement."
    ],
    details: [
      {
        titleKo: "배경과 밝기가 같은 주황빛 태양의 착시",
        titleEn: "The Optical Illusion of the Sun",
        textKo: "하늘을 뚫고 타오르는 듯한 주황색 태양은 놀랍게도 주변 푸른 안개와 명도(밝기)가 거의 같습니다. 순수한 색상 대비만으로 태양이 맥동하듯 빛나는 착시를 일으킵니다.",
        textEn: "Remarkably, the fiery orange sun has nearly the same luminance as the surrounding blue-gray mist—its pulsing glow comes purely from chromatic contrast.",
      },
      {
        titleKo: "안개 속 산업 항구의 실루엣",
        titleEn: "Masts & Smokestacks in Mist",
        textKo: "배경 너머 흐릿하게 서 있는 크레인, 돛대, 굴뚝 연기는 낭만적인 자연 풍경이 아닌 19세기 근대 산업 항구의 실제 일상을 담아낸 것입니다.",
        textEn: "Ghostly silhouettes of cranes, rigging, and factory chimneys reveal a busy modern industrial port rather than an idealized pastoral bay.",
      },
      {
        titleKo: "단 몇 번의 붓질로 완성한 나룻배와 물결",
        titleEn: "Economy of Brushwork",
        textKo: "전경의 작은 나룻배와 수면 위에 부서지는 주황색 빛줄기를 최소한의 거친 붓 터치로 표현해, 새벽 공기의 습기와 찰나의 순간을 생생히 전합니다.",
        textEn: "A few swift dark strokes define the rowboat, while broken horizontal dashes of orange evoke rippling dawn water.",
      },
    ],
  },
  "woman-parasol": {
    artistId: "monet",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    mediumKo: "캔버스에 유채 · 100 × 81 cm",
    mediumEn: "Oil on canvas · 100 × 81 cm",
    collectionKo: "워싱턴 내셔널 갤러리 오브 아트",
    collectionEn: "National Gallery of Art, Washington, D.C.",
    leadKo: "여름날 언덕 위, 산들바람에 베일이 흩날리던 단 몇 초의 눈부신 가족의 기억을 붙잡아 둔 산책의 초상입니다.",
    leadEn: "Monet's wife Camille and young son Jean pause on a breezy summer hillside—an effortless snapshot of wind, light, and family warmth.",
    storyKo: [
      "1875년 여름, 파리 근교 아르장퇴유에서 가족과 평화로운 시기를 보내던 모네는 첫째 부인 카미유와 일곱 살 아들 장이 들판 언덕을 산책하는 모습을 그렸습니다. 모네는 전통적인 정식 초상화처럼 자세를 고정하지 않고, 마치 고개를 돌려 자신을 바라보던 찰나의 순간을 야외에서 단 몇 시간 만에 완성했습니다.",
      "안타깝게도 카미유는 이 그림이 완성된 지 불과 4년 뒤 젊은 나이에 병으로 세상을 떠났습니다. 덕분에 이 작품은 빛과 바람의 걸작일 뿐 아니라, 모네가 가장 행복했던 시절을 영원히 간직한 애틋한 기억의 기록으로 남아 있습니다."
    ],
    storyEn: [
      "During a sunlit summer in Argenteuil in 1875, Monet painted his wife Camille and seven-year-old son Jean strolling across a grassy hill. Rather than posing them formally, he captured the spontaneous turn of Camille's head in a single outdoor session.",
      "Camille passed away tragically just four years later, making this luminous canvas both an Impressionist triumph and a poignant memento of Monet's happiest years."
    ],
    details: [
      {
        titleKo: "아래에서 올려다본 드라마틱한 로우 앵글",
        titleEn: "Monumental Low-Angle View",
        textKo: "화가가 언덕 아래에 앉아 올려다보는 시점을 택해, 소박한 일상 산책 장면임에도 카미유의 실루엣이 거대한 구름을 배경으로 조각상처럼 당당히 솟아오릅니다.",
        textEn: "Viewed from below the slope, Camille towers gracefully against billowing summer clouds, turning an everyday stroll into a monumental vision.",
      },
      {
        titleKo: "양산 그늘 속에 비친 들판의 초록빛 반사광",
        titleEn: "Green Light Inside the Parasol",
        textKo: "확대해 보면 카미유의 흰 드레스 그림자 부분이 회색이 아니라 연보라·파랑·초록빛으로 채워져 있으며, 양산 안쪽에는 풀밭에서 반사된 초록빛이 은은히 어립니다.",
        textEn: "Look closely at Camille's white dress and parasol underside: Monet painted shadows in vivid lavender, blue, and reflected meadow green rather than gray.",
      },
      {
        titleKo: "바람의 방향을 보여주는 베일과 풀잎",
        titleEn: "Visible Gusts of Wind",
        textKo: "왼쪽에서 오른쪽으로 휘날리는 스카프와 치맛자락, 비스듬히 누운 야생화 붓질이 화면 전체에 시원한 여름 바람 소리를 불어넣습니다.",
        textEn: "Sweeping brushwork in the fluttering veil, billowing skirt, and bent wildflowers makes the summer breeze almost audible.",
      },
    ],
  },
  "the-kiss": {
    artistId: "klimt",
    movementKo: "빈 분리파 · 상징주의",
    movementEn: "Vienna Secession · Symbolism",
    mediumKo: "캔버스에 유채·금박·은박 · 180 × 180 cm",
    mediumEn: "Oil and gold leaf on canvas · 180 × 180 cm",
    collectionKo: "빈 벨베데레 궁전 오스트리아 갤러리",
    collectionEn: "Österreichische Galerie Belvedere, Vienna",
    leadKo: "실제 순금의 눈부신 광채 속에서 남성과 여성, 장식과 관능이 하나로 녹아드는 클림트 ‘황금 시기’의 절대적 정점입니다.",
    leadEn: "The crowning jewel of Klimt's Golden Phase, enveloping two lovers in shimmering real gold leaf and hypnotic geometric ornament.",
    storyKo: [
      "1907~1908년에 제작된 《키스》는 빈 대학 천장화 논란으로 혹독한 비판을 받았던 클림트가 다시금 최고의 찬사를 되찾게 해준 결정적 걸작입니다. 1908년 빈 쿤스트샤우 전시에 미완성 상태로 공개되자마자 오스트리아 정부가 즉각 매입할 만큼 폭발적인 반응을 얻었습니다.",
      "클림트는 180cm 정사각형의 대형 캔버스 위에 실제 금박과 은박을 섬세하게 입혀, 이탈리아 라벤나의 비잔틴 성화에서 받은 영감을 세속적이고 황홀한 사랑의 순간으로 승화시켰습니다. 모델은 클림트의 평생의 뮤즈이자 동반자였던 패션 디자이너 에밀리 플뢰게로 널리 추정됩니다."
    ],
    storyEn: [
      "Created between 1907 and 1908, The Kiss restored Klimt's acclaim after fierce academic controversies. Displayed at the 1908 Vienna Kunstschau, it was immediately purchased by the Austrian state before the exhibition even closed.",
      "Combining oil paint with genuine gold and silver leaf on a large square canvas, Klimt drew on Ravenna's Byzantine mosaics to turn human embrace into a timeless sacred icon—widely linked to his lifelong companion, Emilie Flöge."
    ],
    details: [
      {
        titleKo: "사각형과 원형으로 대비되는 두 연인의 패턴",
        titleEn: "Masculine Rectangles, Feminine Circles",
        textKo: "남성의 황금 망토에는 흑백과 금빛의 각진 직사각형 문양이, 여성의 드레스에는 부드러운 원형과 다채로운 꽃무늬가 수놓아져 두 성의 조화를 상징합니다.",
        textEn: "Sharp black, white, and gold rectangles cover the man's robe, while fluid concentric circles and colorful blooms adorn the woman's dress.",
      },
      {
        titleKo: "꽃밭 끝 아슬아슬한 절벽 위의 포옹",
        titleEn: "Perched on the Flowered Precipice",
        textKo: "화려한 꽃이 만발한 초원이 여성의 발끝 바로 아래에서 깎아지른 듯 끊어져 있어, 황홀한 사랑의 순간 속에 감춰진 아찔한 긴장감을 자아냅니다.",
        textEn: "Notice the woman's toes curling right at the edge of the flower-strewn ledge—adding fragile tension beneath the golden rapture.",
      },
      {
        titleKo: "사실적인 피부와 평면적 황금 장식의 공존",
        titleEn: "Lifelike Flesh Meets Flat Gold",
        textKo: "몸체는 평면적인 모자이크 패턴으로 녹아들었지만, 서로를 감싼 손과 눈을 감은 얼굴만큼은 놀라울 정도로 입체적이고 따스하게 묘사되어 있습니다.",
        textEn: "While the figures' bodies dissolve into flat ornamental gold, their faces, shoulders, and clasped hands remain tenderly sculpted and lifelike.",
      },
    ],
  },
  "pearl-earring": {
    artistId: "vermeer",
    movementKo: "네덜란드 황금기 · 바로크",
    movementEn: "Dutch Golden Age · Baroque",
    mediumKo: "캔버스에 유채 · 44.5 × 39 cm",
    mediumEn: "Oil on canvas · 44.5 × 39 cm",
    collectionKo: "헤이그 마우리츠하위스 미술관",
    collectionEn: "Mauritshuis, The Hague",
    leadKo: "어깨 너머로 막 고개를 돌리며 입술을 살짝 연 소녀의 찰나가 ‘북유럽의 모나리자’라는 전설을 낳았습니다.",
    leadEn: "Turning over her shoulder with parted lips and a luminous gleam at her ear, Vermeer's enigmatic tronie is celebrated as the 'Mona Lisa of the North.'",
    storyKo: [
      "1665년경 그려진 이 작품은 특정 실존 인물을 주문받아 그린 초상화가 아니라, 17세기 네덜란드에서 유행했던 ‘트로니(Tronie)’—즉 이국적인 의상과 표정을 연구하는 가상의 인물화입니다. 소녀가 누구인지 기록이 전혀 남아 있지 않아 수많은 상상과 소설·영화의 영감이 되었습니다.",
      "놀랍게도 1881년 헤이그 경매에서 이 그림은 상태가 나쁘다는 이유로 불과 2길더(현재 가치로 몇만 원 수준)에 팔렸습니다. 하지만 복원 과정에서 눈부신 빛과 푸른 터번이 되살아나며 오늘날 전 세계에서 가장 사랑받는 명화로 자리매김했습니다."
    ],
    storyEn: [
      "Painted around 1665, this masterpiece is not a commissioned portrait of a real sitter, but a Dutch 'tronie'—an imaginative study of an exotic costume and fleeting expression. Its sitter's enduring anonymity has inspired novels, films, and endless fascination.",
      "Astonishingly, the painting sold at an 1881 Hague auction for just two guilders in grimy condition before restoration revealed its breathtaking luminosity."
    ],
    details: [
      {
        titleKo: "단 두 번의 붓질로 탄생한 ‘진주’의 착시",
        titleEn: "The Illusion of the Pearl",
        textKo: "4K로 진주 귀걸이를 확대해 보세요. 뚜렷한 윤곽선도, 귀에 거는 고리조차 없이 밝은 흰색 반사광과 목덜미의 은은한 반사빛 두 터치만으로 완벽한 진주의 환상을 만들어냈습니다.",
        textEn: "Zoom closely into the earring: there is no outline and no hook—just two deft touches of white paint catching window light and collar reflection.",
      },
      {
        titleKo: "금보다 비쌌던 아프가니스탄산 청금석 터번",
        titleEn: "Priceless Lapis Lazuli Blue",
        textKo: "소녀의 선명한 푸른 터번에는 당시 금보다 비싸던 아프가니스탄산 천연 청금석(울트라마린) 안료가 아낌없이 사용되었습니다.",
        textEn: "Vermeer spared no expense on the cobalt-bright turban, using genuine natural ultramarine ground from Afghan lapis lazuli.",
      },
      {
        titleKo: "검은 배경 속에 숨겨졌던 깊은 암록색 커튼",
        titleEn: "Hidden Deep Green Background",
        textKo: "오늘날 짙은 검은색처럼 보이는 배경은 최근 과학 분석 결과 원래 투명한 짙은 녹색 유약층으로 칠해져 공간감을 주었음이 밝혀졌습니다.",
        textEn: "Modern scientific imaging revealed that the seemingly pitch-black backdrop was originally glazed with a rich, translucent dark green.",
      },
    ],
  },
  "milkmaid": {
    artistId: "vermeer",
    movementKo: "네덜란드 황금기 · 바로크",
    movementEn: "Dutch Golden Age · Baroque",
    mediumKo: "캔버스에 유채 · 45.5 × 41 cm",
    mediumEn: "Oil on canvas · 45.5 × 41 cm",
    collectionKo: "암스테르담 국립미술관 (레이크스뮤지엄)",
    collectionEn: "Rijksmuseum, Amsterdam",
    leadKo: "부엌 구석에서 우유를 따르는 평범한 하녀의 일상에 고전 조각상 같은 숭고한 품격과 햇살의 온기를 불어넣었습니다.",
    leadEn: "A humble kitchen maid pouring milk becomes an icon of quiet dignity, bathed in crisp Delft daylight and jeweled flecks of highlight.",
    storyKo: [
      "1658년경 완성된 《우유 따르는 여인》은 가로세로 45cm 남짓한 작은 크기에도 불구하고 압도적인 존재감을 발산합니다. 당시 네덜란드 풍속화에서 부엌 하녀는 종종 가볍거나 유혹적인 소재로 그려졌지만, 페르메이르는 오직 빵 푸딩을 만들기 위해 우유를 따르는 여인의 진지한 집중과 노동의 존엄을 경건하게 담아냈습니다.",
      "왼쪽 창문에서 쏟아져 들어오는 아침 햇살은 거친 회벽의 못 자국부터 빵 껍질의 바삭한 질감, 흘러내리는 가느다란 우유 줄기까지 완벽하게 비추며, 그림 전체에서 마치 잔잔한 우유 따르는 소리가 들리는 듯한 정적을 자아냅니다."
    ],
    storyEn: [
      "Despite its intimate scale of roughly 45 centimeters, The Milkmaid commands monumental presence. While contemporary Dutch artists often portrayed kitchen maids playfully, Vermeer honored her focused concentration as she prepares bread pudding.",
      "Crisp daylight pouring from the left window illuminates every nail hole in the plaster wall, the crusty loaves, and the steady white stream of milk—creating a stillness so palpable you almost hear the pour."
    ],
    details: [
      {
        titleKo: "빵 껍질 위에 흩뿌린 보석 같은 빛의 점(푸앵티예)",
        titleEn: "Glistening Pointillé Highlights",
        textKo: "식탁 위 바구니와 빵 껍질을 확대해 보면 작은 흰색·노란색 물감 점이 촘촘히 찍혀 있습니다. 빛이 거친 표면에 부딪혀 반짝이는 광학 현상을 포착한 페르메이르의 전매특허 기법입니다.",
        textEn: "Zoom into the bread basket: tiny raised dots of pale paint (pointillé) mimic how sunlight sparkles off rough crusts and glazed earthenware.",
      },
      {
        titleKo: "발치의 발난로와 델프트 도자기 타일",
        titleEn: "Foot Warmer & Delft Tiles",
        textKo: "오른쪽 바닥의 나무 상자는 숯을 넣어 발을 녹이던 네덜란드식 발난로이며, 그 뒤 벽면 하단에는 큐피드 등이 그려진 푸른 델프트 타일이 숨어 있습니다.",
        textEn: "On the floor sits a wooden foot warmer glowing with coals, backed by blue-and-white Delft tiles—including one depicting Cupid.",
      },
      {
        titleKo: "하녀 뒤편 벽에 지워진 흔적들",
        titleEn: "The Power of Simplification",
        textKo: "엑스선 촬영 결과 페르메이르는 원래 벽에 큰 지도와 바닥에 옷 바구니를 그렸다가 과감히 지우고 순백의 회벽만 남겨, 여인의 실루엣과 집중력을 극대화했습니다.",
        textEn: "X-rays show Vermeer painted out a large wall map and a laundry basket, leaving bare sunlit plaster to focus all attention on the maid.",
      },
    ],
  },
  "great-wave": {
    artistId: "hokusai",
    movementKo: "우키요에",
    movementEn: "Ukiyo-e",
    mediumKo: "다색 목판화(니시키에) · 약 25.7 × 37.9 cm",
    mediumEn: "Polychrome woodblock print · approx. 25.7 × 37.9 cm",
    collectionKo: "메트로폴리탄 미술관 · 대영박물관 등 다수 소장",
    collectionEn: "Metropolitan Museum of Art, British Museum & others",
    leadKo: "발톱처럼 덮쳐오는 거대한 파도와 고요히 버티는 후지산의 대비로 전 세계가 사랑하는 동양 판화의 절대적 아이콘입니다.",
    leadEn: "Claw-like crests of Prussian-blue water rear over frail fishing boats while distant Mount Fuji stands unmoved—perhaps the most recognizable print in world art.",
    storyKo: [
      "1831년경 일흔을 넘긴 거장 가쓰시카 호쿠사이가 발표한 연작 《후가쿠 36경(부악삼십육경)》의 첫 번째 작품입니다. 당시 일본에 막 수입된 유럽산 합성 안료 ‘프러시안 블루(베를린 블루)’가 선풍적인 인기를 끌자, 호쿠사이는 이 깊고 선명한 푸른색을 과감하게 활용해 기존 목판화에서 볼 수 없던 역동적인 바다를 창조했습니다.",
      "이 작품은 19세기 후반 유럽으로 건너가 빈센트 반 고흐에게 “독수리 발톱 같은 파도”라는 극찬을 받았고, 클로드 드뷔시가 교향시 《바다》를 작곡하는 데 직접적인 영감을 주며 동서양 예술의 가교가 되었습니다."
    ],
    storyEn: [
      "Published around 1831 when Hokusai was past seventy, this opening print of Thirty-Six Views of Mount Fuji capitalized on newly imported European Prussian blue pigment, whose deep saturation revolutionized Japanese woodblock printing.",
      "Reaching Europe in the late nineteenth century, its dynamic curves astonished Van Gogh—who likened the foam to claws—and inspired Claude Debussy's orchestral masterpiece La Mer."
    ],
    details: [
      {
        titleKo: "파도에 휩쓸리듯 웅크린 세 척의 활어 운반선",
        titleEn: "Three Fast Fish Boats",
        textKo: "거대한 물결 사이를 자세히 보면 신선한 생선을 에도(도쿄)로 나르던 쾌속선 ‘오시오쿠리부네’ 세 척에 노 젓는 사공들이 바짝 엎드려 자연의 위력에 맞서고 있습니다.",
        textEn: "Look inside the troughs: three slender oshiokuri-bune boats carry hunched oarsmen rushing fresh fish toward Edo against the towering swell.",
      },
      {
        titleKo: "거친 파도와 완벽히 대칭을 이루는 작은 후지산",
        titleEn: "Humble, Unshakable Mount Fuji",
        textKo: "전경의 작은 파도가 후지산의 실루엣을 그대로 흉내 내는 듯한 구도 속에서, 멀리 눈 덮인 후지산이 요동치는 바다의 중심축처럼 고요히 자리 잡습니다.",
        textEn: "Echoed in shape by the smaller foreground wave, snow-capped Mount Fuji sits calmly framed beneath the giant arc of foam.",
      },
      {
        titleKo: "독수리 발톱처럼 흩어지는 물보라",
        titleEn: "Claw-Like Sea Foam",
        textKo: "파도 끝자락을 날카로운 발톱 모양으로 조각하고 하늘에 흰 눈송이처럼 물방울을 흩뿌려, 정지된 판화 위에 폭풍우의 굉음을 새겨 넣었습니다.",
        textEn: "The breaking crest splits into razor-sharp tendrils of foam scattering like snow across the pale yellow-pink morning sky.",
      },
    ],
  },
  "red-fuji": {
    artistId: "hokusai",
    movementKo: "우키요에",
    movementEn: "Ukiyo-e",
    mediumKo: "다색 목판화(니시키에) · 약 25.4 × 37.8 cm",
    mediumEn: "Polychrome woodblock print · approx. 25.4 × 37.8 cm",
    collectionKo: "메트로폴리탄 미술관 · 대영박물관 등 다수 소장",
    collectionEn: "Metropolitan Museum of Art, British Museum & others",
    leadKo: "늦여름 새벽 남풍이 불어오는 맑은 아침, 햇살에 붉게 타오르는 후지산을 극도의 절제미로 담아낸 ‘붉은 후지’입니다.",
    leadEn: "Known worldwide as 'Red Fuji,' this daringly minimal print captures the sacred volcano glowing crimson in clear late-summer dawn light.",
    storyKo: [
      "《가나가와 해변의 높은 파도 아래》와 함께 《후가쿠 36경》의 쌍벽을 이루는 걸작으로, ‘개풍쾌청(凱風快晴)’은 ‘남풍이 불고 맑게 갠 아침’을 뜻합니다. 늦여름에서 초가을 무렵, 구름이 걷히고 동틀 녘 햇빛이 정면으로 비출 때 후지산이 붉게 물드는 진귀한 자연현상 ‘아카후지(赤富士)’를 포착했습니다.",
      "사람이나 배, 마을 같은 서사적 요소를 단 하나도 넣지 않고 오직 산의 웅장한 능선과 푸른 하늘, 줄무늬 구름만으로 화면을 구성했습니다. 이 대담한 단순함과 색면 대비는 현대 그래픽 디자인의 원형으로도 높이 평가받습니다."
    ],
    storyEn: [
      "Companion masterpiece to The Great Wave in Thirty-Six Views of Mount Fuji, its title means 'South Wind, Clear Sky.' It depicts the rare late-summer dawn phenomenon when low sunlight ignites Mount Fuji's bare slopes into blazing red.",
      "Eliminating all human figures, ships, and buildings, Hokusai reduced the scene to pure mountain geometry, deep blue sky, and rhythmic clouds—a landmark of bold minimalist design."
    ],
    details: [
      {
        titleKo: "아래에서 위로 번지는 절묘한 그라데이션(보카시)",
        titleEn: "Subtle Woodblock Gradation",
        textKo: "산기슭의 짙은 숲 녹색에서 황토색, 그리고 정상의 타오르는 적갈색으로 이어지는 색채 변화는 목판 위에서 손으로 안료를 문질러 내는 ‘보카시’ 기법의 극치입니다.",
        textEn: "Using the bokashi hand-wiped inking technique, the mountain shifts seamlessly from deep forest green at its base to fiery terracotta near the peak.",
      },
      {
        titleKo: "하늘에 리듬을 더하는 양떼구름",
        titleEn: "Rhythmic Cirrocumulus Clouds",
        textKo: "프러시안 블루 하늘을 가로지르는 하얀 비늘구름(양떼구름)의 패턴이 정적인 산의 삼각형 구도에 경쾌한 새벽 바람의 움직임을 불어넣습니다.",
        textEn: "Crisp horizontal bands of white dappled clouds sweep across the Prussian-blue sky, evoking the cool breeze of early morning.",
      },
      {
        titleKo: "여름 끝자락에도 남아 있는 정상의 만년설",
        titleEn: "Streaks of Late-Summer Snow",
        textKo: "산 정상 화구 주변으로 가늘게 패어 내려온 흰 눈줄기가 붉은 화산암과 선명히 대비되며 후지산의 압도적인 높이를 실감하게 합니다.",
        textEn: "Delicate fissures of lingering snow along the summit rim accentuate the volcano's towering altitude against the red rock.",
      },
    ],
  },
  "birth-of-venus": {
    artistId: "botticelli",
    movementKo: "초기 르네상스",
    movementEn: "Early Renaissance",
    mediumKo: "캔버스에 템페라 · 172.5 × 278.5 cm",
    mediumEn: "Tempera on canvas · 172.5 × 278.5 cm",
    collectionKo: "피렌체 우피치 미술관",
    collectionEn: "Uffizi Gallery, Florence",
    leadKo: "중세의 오랜 금기를 깨고 고대 신화의 미와 사랑이 르네상스의 아침 바다 위로 다시 태어나는 순간입니다.",
    leadEn: "Breaking centuries of medieval taboo, Botticelli reawakens classical myth as Venus glides ashore on a scallop shell in luminous Florentine grace.",
    storyKo: [
      "1485년경 피렌체 메디치 가문의 의뢰로 제작된 것으로 전해지는 《비너스의 탄생》은 중세 이후 서양 미술에서 최초로 등장한 대형 비종교적 누드 명화입니다. 보티첼리는 나무 패널 대신 당시로서는 드문 대형 캔버스 위에 달걀노른자를 섞은 템페라 물감으로 맑고 투명한 색감을 구현했습니다.",
      "신화 속 사랑과 미의 여신 비너스가 거대한 조개껍데기를 타고 키프로스 해안에 막 도착하는 장면을 그렸습니다. 해부학적으로 완벽한 비례보다 길게 늘인 목선과 유려한 곡선을 택해, 현실을 초월한 이상적 아름다움과 신플라톤주의 철학의 영적 순수함을 노래했습니다."
    ],
    storyEn: [
      "Painted around 1485 for the Medici circle in Florence, The Birth of Venus was the first monumental non-religious nude of the Italian Renaissance. Botticelli worked in luminous egg tempera on rare large-scale linen canvas.",
      "Rather than strict anatomical realism, he elongated Venus's neck and sloping shoulders into graceful lyrical curves—celebrating Neoplatonic ideals of spiritual beauty reborn from antiquity."
    ],
    details: [
      {
        titleKo: "서풍의 신 제피로스와 요정 아우라의 입김",
        titleEn: "Zephyr & Aura's Gentle Gale",
        textKo: "왼쪽 공중에서 서로 껴안은 서풍의 신 제피로스와 아우라가 볼을 부풀려 부드러운 바람을 불어주며, 그 숨결을 타고 수십 송이 장미꽃이 바다 위로 흩날립니다.",
        textEn: "Intertwined on the left, the west wind Zephyr and nymph Aura blow Venus gently shoreward amidst a shower of floating roses.",
      },
      {
        titleKo: "봄의 여신 호라가 내미는 꽃무늬 망토",
        titleEn: "The Hora of Spring",
        textKo: "오른쪽 해안에서 계절의 여신(호라)이 데이지와 수레국화가 수놓아진 붉은 망토를 펼쳐 들고 막 태어난 비너스를 맞이할 준비를 하고 있습니다.",
        textEn: "On the right shore, an Hora of Spring steps forward holding a flowing floral cloak embroidered with daisies and anemones to clothe the goddess.",
      },
      {
        titleKo: "황금빛 머리카락에 칠한 진짜 금분",
        titleEn: "Real Gold Highlights",
        textKo: "비너스의 길게 휘날리는 금발과 조개껍데기, 뒤편 오렌지 나무 잎사귀를 확대해 보면 실제 금분을 섬세하게 덧칠해 햇살이 반짝이는 효과를 준 것을 알 수 있습니다.",
        textEn: "Zooming in reveals delicate gilded gold highlights woven through Venus's cascading hair, the shell's ridges, and the orange-grove leaves.",
      },
    ],
  },
  "mona-lisa": {
    artistId: "da-vinci",
    movementKo: "전성기 르네상스",
    movementEn: "High Renaissance",
    mediumKo: "포플러 나무판에 유채 · 77 × 53 cm",
    mediumEn: "Oil on poplar panel · 77 × 53 cm",
    collectionKo: "파리 루브르 박물관",
    collectionEn: "Musée du Louvre, Paris",
    leadKo: "보는 각도와 마음 상태에 따라 표정이 달라지는 신비로운 미소 속에 레오나르도 평생의 과학과 예술이 응축되어 있습니다.",
    leadEn: "Leonardo's lifelong study of optics, anatomy, and human emotion distilled into the world's most enigmatic smile.",
    storyKo: [
      "1503년경 피렌체의 부유한 비단 상인 프란체스코 델 조콘도의 아내 리자 게라르디니를 모델로 시작된 초상화입니다. 그러나 레오나르도는 완성 후에도 이 그림을 의뢰인에게 넘기지 않고 16년 가까이 곁에 두며 계속 수정했고, 말년 프랑스 왕 프랑수아 1세의 초청으로 떠날 때도 끝까지 챙겨 갔습니다.",
      "이 작품이 전 세계에서 가장 유명한 그림이 된 결정적 계기 중 하나는 1911년 루브르 박물관 도난 사건입니다. 2년 넘게 행방이 묘연했던 그림이 이탈리아에서 기적적으로 되찾아 돌아오자, 《모나리자》는 인류 미술사의 절대적 상징으로 자리 잡았습니다."
    ],
    storyEn: [
      "Begun around 1503 as a portrait of Lisa Gherardini, wife of Florentine merchant Francesco del Giocondo, the panel was never delivered to its patron. Leonardo kept refining it for years, carrying it with him to France until his death.",
      "Already admired by artists for centuries, its dramatic 1911 theft from the Louvre—and triumphant recovery two years later—cemented Mona Lisa as the ultimate global icon of art."
    ],
    details: [
      {
        titleKo: "경계를 녹여낸 ‘스푸마토’ 미소의 비밀",
        titleEn: "The Sfumato Smile",
        textKo: "입꼬리와 눈가에 뚜렷한 선을 긋지 않고 연기처럼 얇은 명암층을 수십 겹 쌓아 올렸습니다. 눈을 마주치면 주변 시야로 입꼬리가 웃는 듯 보이고, 입술을 직시하면 미소가 잦아드는 착시가 일어납니다.",
        textEn: "Soft smoky glazes (sfumato) blur the corners of her mouth and eyes—making her smile seem to deepen when you meet her gaze and fade when you stare directly at her lips.",
      },
      {
        titleKo: "좌우 높이가 다른 신비로운 안개 낀 배경",
        titleEn: "Mismatched Dreamlike Horizons",
        textKo: "인물 뒤편의 풍경을 자세히 보면 왼쪽의 구불구불한 길과 오른쪽의 다리·호수의 지평선 높이가 서로 다릅니다. 의도적인 비대칭으로 시선을 화면 안에서 자연스럽게 머물게 합니다.",
        textEn: "Look behind her shoulders: the rocky landscape on the left sits noticeably lower than the winding bridge and lake on the right, subtly enhancing her sculptural poise.",
      },
      {
        titleKo: "자연스럽게 포갠 손과 투명한 베일",
        titleEn: "Poised Hands & Gossamer Veil",
        textKo: "안정적인 삼각형 구도 아래 부드럽게 포갠 두 손과 이마 위를 덮은 극도로 얇은 반투명 베일에서 해부학자 레오나르도의 경이로운 관찰력이 드러납니다.",
        textEn: "Resting calmly in a pyramid composition, her relaxed hands and the sheer dark veil across her hair reveal Leonardo's anatomical precision.",
      },
    ],
  },
  "night-watch": {
    artistId: "rembrandt",
    movementKo: "바로크 · 네덜란드 황금기",
    movementEn: "Baroque · Dutch Golden Age",
    mediumKo: "캔버스에 유채 · 363 × 437 cm",
    mediumEn: "Oil on canvas · 363 × 437 cm",
    collectionKo: "암스테르담 국립미술관 (레이크스뮤지엄)",
    collectionEn: "Rijksmuseum, Amsterdam",
    leadKo: "딱딱한 단체 초상화의 틀을 깨고 출동 직전의 웅장한 드라마로 탈바꿈시킨 렘브란트 최대의 걸작입니다.",
    leadEn: "Shattering static portrait conventions, Rembrandt captures an Amsterdam militia company bursting into sunlit theatrical motion.",
    storyKo: [
      "원래 제목은 《프란스 바닝 코크 대장의 민병대》로, 1642년 암스테르담 시민 자경단 단원들이 각자 돈을 모아 의뢰한 초대형 단체 초상화입니다. 당시 화가들은 돈을 낸 단원 전원을 나란히 세워 공평하게 그리는 것이 관례였지만, 렘브란트는 대장이 출동 명령을 내리는 생생한 찰나를 한 편의 연극처럼 연출했습니다.",
      "사실 이 그림의 배경은 밤이 아니라 환한 낮입니다. 수 세기 동안 쌓인 그을음과 어두워진 바니시 때문에 야간 순찰 장면으로 오해받아 18세기 말부터 《야경(The Night Watch)》이라는 별칭이 붙었고, 1940년대 대대적인 복원 이후에도 그 매혹적인 이름은 그대로 남아 있습니다."
    ],
    storyEn: [
      "Formally titled Militia Company of District II under the Command of Captain Frans Banninck Cocq (1642), this colossal canvas revolutionized Dutch group portraiture by showing guardsmen bustling into action rather than lining up stiffly.",
      "Surprisingly, it depicts a daytime gathering: centuries of darkened varnish misled later viewers into nicknaming it The Night Watch—a title that endured even after restoration uncovered its warm sunlight."
    ],
    details: [
      {
        titleKo: "빛을 한 몸에 받는 수수께끼의 황금빛 소녀",
        titleEn: "The Glowing Girl in Gold",
        textKo: "어두운 대원들 사이로 유독 찬란한 스포트라이트를 받으며 서 있는 소녀의 허리춤에는 흰 닭 한 마리가 매달려 있습니다. 발톱(Clauw)은 이 민병대(Kloveniers)의 상징 마스코트를 뜻합니다.",
        textEn: "Bathed in golden light amidst the militia, a small girl carries a dead white chicken at her belt—its claws (klauwen) punning on the arquebusiers' guild emblem.",
      },
      {
        titleKo: "화면 밖으로 뻗어 나오는 대장의 왼손 그림자",
        titleEn: "Three-Dimensional Hand & Shadow",
        textKo: "중앙의 코크 대장이 관람객 쪽으로 내민 왼손의 그림자가 부관의 노란 코트 위에 정확히 떨어지며, 2차원 화폭을 뚫고 나오는 듯한 입체감을 선사합니다.",
        textEn: "Captain Cocq's outstretched hand casts a crisp shadow onto his lieutenant's embroidered yellow coat, projecting the march right into the viewer's space.",
      },
      {
        titleKo: "군중 뒤편에서 슬쩍 엿보는 렘브란트의 자화상",
        titleEn: "Rembrandt's Hidden Cameo",
        textKo: "기수(깃발을 든 인물) 바로 뒤쪽 어두운 틈새를 확대해 보면 베레모를 쓰고 한쪽 눈만 내민 채 이 소란을 지켜보는 렘브란트 자신의 얼굴이 숨어 있습니다.",
        textEn: "Peer behind the standard-bearer's shoulder: tucked between helmets is a beret-wearing bystander showing just one eye—widely believed to be Rembrandt himself.",
      },
    ],
  },
  "grande-jatte": {
    artistId: "seurat",
    movementKo: "신인상주의 · 점묘법",
    movementEn: "Neo-Impressionism · Pointillism",
    mediumKo: "캔버스에 유채 · 207.5 × 308.1 cm",
    mediumEn: "Oil on canvas · 207.5 × 308.1 cm",
    collectionKo: "시카고 미술관",
    collectionEn: "Art Institute of Chicago",
    leadKo: "수백만 개의 순수한 색점을 과학적으로 찍어 올려 파리 센강변의 일요일 오후를 영원한 고전적 정적으로 얼려두었습니다.",
    leadEn: "Built from millions of tiny optical dots of pure pigment, Seurat turned a bustling Parisian Sunday park into a monument of timeless serenity.",
    storyKo: [
      "조르주 쇠라는 1884년부터 2년 동안 파리 서북쪽 센강에 떠 있는 그랑드 자트 섬을 수십 차례 찾아가 60점 이상의 스케치와 유화 습작을 그린 끝에 폭 3미터가 넘는 이 대작을 완성했습니다. 1886년 마지막 인상주의 전시회에 공개되자, 인상파 내부에서조차 “과학이 예술을 지배한다”는 찬반 논쟁이 거세게 일었습니다.",
      "쇠라는 19세기 색채학자 슈브뢸의 광학 이론을 적용해 팔레트에서 물감을 섞지 않고 원색의 작은 점들을 캔버스에 촘촘히 나란히 찍었습니다. 멀리서 볼 때 눈 속에서 색이 혼합되어 일반 혼합색보다 훨씬 맑고 진동하는 듯한 빛을 뿜어내는 ‘점묘법(분할주의)’의 탄생이었습니다."
    ],
    storyEn: [
      "Over two painstaking years (1884–1886), Seurat made more than sixty sketches and oil studies on the island of La Grande Jatte in the Seine before completing this three-meter-wide manifesto of Neo-Impressionism.",
      "Guided by optical color theory, he placed countless tiny dots of unmixed pigment side by side so they blend optically in the viewer's eye—creating a shimmering radiance unlike conventional brushstrokes."
    ],
    details: [
      {
        titleKo: "원숭이를 데리고 산책하는 파리 귀부인",
        titleEn: "A Pet Monkey on a Leash",
        textKo: "오른쪽 전경에서 신사와 함께 산책하는 우아한 여인의 발치를 보면 개가 아니라 목줄을 맨 작은 원숭이가 앉아 있습니다. 당시 파리 상류층의 기묘한 유행과 풍자가 담긴 디테일입니다.",
        textEn: "Look beside the bustling skirt on the right foreground: the fashionable Parisian woman walks a small pet monkey on a leash—a wry nod to bourgeois eccentricity.",
      },
      {
        titleKo: "48명의 인물 중 유일하게 정면을 바라보는 아이",
        titleEn: "The Lone Forward Gaze",
        textKo: "화폭 속 인물 대부분이 고대 이집트 부조처럼 옆모습으로 굳어 있는 가운데, 중앙의 흰 옷을 입은 어린 소녀만 유일하게 관람객을 똑바로 응시하며 화면의 중심축을 잡습니다.",
        textEn: "Nearly all forty-eight parkgoers appear in stiff, frieze-like profile—except the sunlit little girl in white at dead center who looks directly out at us.",
      },
      {
        titleKo: "물감 점으로 직접 그려 넣은 캔버스 테두리",
        titleEn: "The Painted Pointillist Border",
        textKo: "쇠라는 그림이 벽면과 어울리도록 1888~1889년경 작품 가장자리 둘레에 주변 색의 보색 점들로 이루어진 얇은 액자 테두리를 직접 덧그렸습니다.",
        textEn: "Seurat later added a painted border of contrasting dots around the entire perimeter to harmonize the glowing scene with its frame.",
      },
    ],
  },
  "moulin-galette": {
    artistId: "renoir",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    mediumKo: "캔버스에 유채 · 131 × 175 cm",
    mediumEn: "Oil on canvas · 131 × 175 cm",
    collectionKo: "파리 오르세 미술관",
    collectionEn: "Musée d'Orsay, Paris",
    leadKo: "아카시아 나뭇잎 사이로 쏟아지는 황금빛 햇살 조각 아래, 청춘들의 웃음소리와 음악이 들려오는 파리 몽마르트르의 일요일입니다.",
    leadEn: "Dappled sunlight dances across laughing Parisians, clinking glasses, and waltzing couples on a joyful Sunday afternoon in Montmartre.",
    storyKo: [
      "1876년, 르누아르는 파리 몽마르트르 언덕의 유명한 야외 무도회장 ‘물랭 드 라 갈레트’에 거의 매일 찾아가 친구 화가들과 동네 젊은이들이 춤추고 대화하는 모습을 현장에서 직접 그렸습니다. 그림 속 인물 대부분은 르누아르의 실제 지인들과 몽마르트르의 재봉사, 노동자 등 평범한 파리 청춘들입니다.",
      "당시 야외에서 커다란 캔버스를 세워 작업하며 르누아르는 바람이 불 때마다 캔버스가 넘어지지 않게 붙잡아야 했습니다. 그렇게 담아낸 나뭇잎 사이로 부서지는 얼룩덜룩한 햇빛과 생동감 넘치는 군상은 ‘인상주의가 그린 가장 행복한 순간’으로 꼽힙니다."
    ],
    storyEn: [
      "In 1876, Renoir hauled his canvas into the open-air courtyard of Montmartre's popular dance hall, Le Moulin de la Galette, posing his painter friends and local working-class youths amidst music and conversation.",
      "Painting outdoors amidst shifting breezes, he captured the infectious warmth of Parisian leisure—making this one of the most celebrated images of happiness in Western art."
    ],
    details: [
      {
        titleKo: "옷과 얼굴 위로 내려앉은 푸른빛·분홍빛 햇살 조각",
        titleEn: "Dancing Dappled Sunlight",
        textKo: "춤추는 남성의 검은 정장 어깨와 여인의 드레스를 자세히 보세요. 나뭇잎 틈새로 떨어진 햇살이 하얀 얼룩처럼 반짝이며, 그림자는 검은색 대신 깊은 코발트 블루와 보라색으로 물들어 있습니다.",
        textEn: "Sunlight filters through unseen acacia leaves onto dark coats and cheeks in luminous patches, while shadows glow in rich blues and violets rather than black.",
      },
      {
        titleKo: "전경 테이블에 둘러앉은 르누아르의 실제 친구들",
        titleEn: "Renoir's Circle at the Table",
        textKo: "오른쪽 앞 테이블에서 담소를 나누는 남성들은 화가 프랑크 라미, 노르베르 괴뇌트, 작가 조르주 리비에르 등 르누아르와 동고동락하던 몽마르트르 예술가 동료들입니다.",
        textEn: "The lively group chatting around the foreground table includes Renoir's close friends—artists and writers who regularly gathered in Montmartre.",
      },
      {
        titleKo: "유쾌하게 흐려지는 원경의 춤사위",
        titleEn: "Motion & Music in Depth",
        textKo: "가까운 인물은 생생한 표정으로 포착하고, 뒤쪽 무도회장으로 갈수록 붓질을 부드럽게 풀어내어 수많은 인파가 음악에 맞춰 선회하는 생생한 리듬을 전합니다.",
        textEn: "Crisper brushwork in the foreground softens into swirling strokes deeper in the crowd, conveying the rhythm of couples spinning to live music.",
      },
    ],
  },
  "the-scream": {
    artistId: "munch",
    movementKo: "표현주의 · 상징주의",
    movementEn: "Expressionism · Symbolism",
    mediumKo: "판지에 유채·템페라·파스텔 · 91 × 73.5 cm",
    mediumEn: "Oil, tempera, and pastel on cardboard · 91 × 73.5 cm",
    collectionKo: "노르웨이 국립미술관 (오슬로)",
    collectionEn: "National Museum of Norway, Oslo",
    leadKo: "핏빛으로 타오르는 저녁노을 아래 자연 전체를 관통하는 ‘끝없는 절규’를 시각화한 현대인 불안의 초상입니다.",
    leadEn: "Inspired by a blood-red sunset over Oslofjord, Munch gave visual form to modern existential dread—not a person screaming, but nature itself.",
    storyKo: [
      "1892년 1월, 에드바르 뭉크는 일기에 이렇게 적었습니다. “친구 두 명과 길을 걷고 있었다. 해가 지며 하늘이 갑자기 핏빛으로 변했다. 극심한 피로감에 난간에 기대어 섰는데, 검푸른 피오르와 도시 위로 피와 불의 혀가 드리워져 있었다. 친구들은 계속 걸어갔고, 나는 불안으로 떨며 자연을 관통하는 거대하고 끝없는 절규를 느꼈다.”",
      "흔히 화면 중앙의 인물이 비명을 지르는 것으로 생각하기 쉽지만, 실제로는 대자연이 내뿜는 압도적인 절규를 견디지 못해 두 귀를 틀어막고 있는 모습입니다. 뭉크는 이 강렬한 환영을 1893년부터 1910년 사이 유화·파스텔·판화 등 총 네 가지 버전으로 반복해 남겼습니다."
    ],
    storyEn: [
      "In his 1892 diary, Munch recalled walking above Oslo with two friends when the sky suddenly turned blood-red: exhausted and trembling, he leaned against the railing and 'sensed an infinite scream passing through nature.'",
      "Rather than simply shouting, the central figure clamps both hands over its ears to shut out the overwhelming shriek of the sky and fjord. Munch created four painted and pastel versions between 1893 and 1910."
    ],
    details: [
      {
        titleKo: "하늘에 숨겨진 연필 글씨 ‘미친 사람만이 그릴 수 있다’",
        titleEn: "A Secret Penciled Inscription",
        textKo: "왼쪽 상단 붉은 하늘을 자세히 보면 연필로 쓰인 작은 문장 “Can only have been painted by a madman”이 있습니다. 최근 필적 감정 결과, 비평가의 조롱에 상처받은 뭉크 자신이 직접 적은 것으로 밝혀졌습니다.",
        textEn: "Faintly penciled in the upper-left red sky is the line 'Can only have been painted by a madman'—recently authenticated as written by Munch himself in response to hostile critics.",
      },
      {
        titleKo: "직선 다리와 일렁이는 소용돌이의 대립",
        titleEn: "Rigid Bridge vs. Melting World",
        textKo: "날카로운 대각선으로 뻗은 직선 난간과 멀어지는 두 친구의 차분한 실루엣이, 유령처럼 구불거리며 녹아내리는 중앙 인물 및 하늘과 극적인 대비를 이룹니다.",
        textEn: "The razor-straight diagonal bridge and calm silhouettes of two departing friends sharpen the claustrophobic terror of the undulating figure and sky.",
      },
      {
        titleKo: "크라카토아 화산 폭발이 빚은 핏빛 노을설",
        titleEn: "Volcanic Twilight Skies",
        textKo: "천문학자들은 1883년 인도네시아 크라카토아 화산 대폭발로 성층권에 퍼진 화산재가 수년간 북유럽 하늘을 기이한 핏빛 노을로 물들였고, 이것이 뭉크의 강렬한 기억이 되었을 것이라 추정합니다.",
        textEn: "Scholars suggest the lurid crimson clouds may reflect real Nordic sunsets turned fiery by volcanic ash from the 1883 eruption of Krakatoa.",
      },
    ],
  },
  "wanderer": {
    artistId: "friedrich",
    movementKo: "독일 낭만주의",
    movementEn: "German Romanticism",
    mediumKo: "캔버스에 유채 · 94.8 × 74.8 cm",
    mediumEn: "Oil on canvas · 94.8 × 74.8 cm",
    collectionKo: "함부르크 쿤스트할레 미술관",
    collectionEn: "Kunsthalle Hamburg",
    leadKo: "자욱한 운해가 덮인 험준한 산봉우리 위에서 미지의 세계를 응시하는, 낭만주의적 고독과 숭고미의 영원한 상징입니다.",
    leadEn: "Standing alone atop a jagged crag above an endless sea of mist, Friedrich's solitary traveler embodies the Romantic awe of the unknown.",
    storyKo: [
      "1818년경 완성된 이 작품은 독일 낭만주의를 대표하는 가장 아이코닉한 명화입니다. 어두운 녹색 코트를 입고 지팡이를 짚은 채 바람에 머리카락을 날리며 서 있는 인물은 독일 드레스덴 인근 엘베 사암 산맥의 아찔한 바위 꼭대기에 올라 끝없는 안개 바다를 내려다보고 있습니다.",
      "프리드리히는 인물의 얼굴을 끝내 보여주지 않았습니다. 뒷모습만 드러내는 ‘뤼켄피구어’ 구도를 통해, 그림을 보는 우리 모두가 자연스럽게 이 방랑자의 등 뒤에 서서 그의 시선으로 거대한 자연과 자신의 내면을 마주하게 만든 것입니다."
    ],
    storyEn: [
      "Painted around 1818, this quintessential work of German Romanticism places a lone man in a dark green frock coat atop a rocky pinnacle of the Elbe Sandstone Mountains, gazing out over a billowing ocean of fog.",
      "By turning the traveler's back completely to us (a device called Rückenfigur), Friedrich invites every viewer to step into the wanderer's boots and confront the infinite sublime firsthand."
    ],
    details: [
      {
        titleKo: "인물의 가슴 한가운데로 모이는 모든 구도의 선",
        titleEn: "Converging Geometry at the Heart",
        textKo: "전경 바위의 경사면과 멀리 겹겹이 솟은 산등성이의 대각선들이 모두 방랑자의 심장 부근 한 점으로 모여들며, 고독한 개인을 우주의 중심에 세웁니다.",
        textEn: "The slopes of the foreground crag and distant peaks all converge toward the wanderer's chest, making the solitary soul the emotional axis of the world.",
      },
      {
        titleKo: "안개 너머로 어렴풋이 솟아오른 봉우리들",
        titleEn: "Peaks Piercing the Mist",
        textKo: "하얗게 출렁이는 구름 바다 곳곳에서 어두운 바위 봉우리와 소나무 숲, 멀리 지평선의 산맥이 모습을 드러내며 미지의 미래와 무한한 공간을 암시합니다.",
        textEn: "Through swirling layers of pale mist, jagged spires, distant pines, and faint mountain ridges emerge—evoking mystery and boundless horizon.",
      },
      {
        titleKo: "역광 속에 선명히 부각된 어두운 실루엣",
        titleEn: "High-Contrast Silhouette",
        textKo: "안개와 하늘의 밝고 차가운 청백색 톤과 대조되는 전경 바위와 코트의 짙은 어둠이 극적인 깊이감과 고요한 긴장감을 완성합니다.",
        textEn: "The stark dark mass of the crag and coat against the luminous silver-blue mist creates dramatic depth and quiet contemplation.",
      },
    ],
  },
  "hunters-snow": {
    artistId: "bruegel",
    movementKo: "북유럽 르네상스",
    movementEn: "Northern Renaissance",
    mediumKo: "오크 나무판에 유채 · 117 × 162 cm",
    mediumEn: "Oil on oak panel · 117 × 162 cm",
    collectionKo: "빈 미술사 박물관",
    collectionEn: "Kunsthistorisches Museum, Vienna",
    leadKo: "유럽 소빙기의 매서운 겨울날, 지친 사냥꾼들의 발걸음 아래로 스케이트 타는 마을의 활기가 펼쳐지는 장대한 겨울 서사시입니다.",
    leadEn: "Painted during Europe's Little Ice Age, tired hunters trudge homeward above a bustling frozen valley alive with skating, curling, and winter warmth.",
    storyKo: [
      "1565년 안트베르펜의 부유한 상인 니콜라스 용헬링크의 식당을 장식하기 위해 제작된 《계절 연작》 중 ‘한겨울(12월~1월)’을 담은 걸작입니다. 당시 유럽은 기록적인 혹한이 몰아닥친 ‘소빙기(Little Ice Age)’의 절정이었고, 브뤼헐은 그 매섭고도 고요한 겨울 풍경을 완벽한 파노라마로 기록했습니다.",
      "이 작품은 단순한 풍경화를 넘어, 자연의 냉혹한 순환 속에서 묵묵히 삶을 이어가는 인간의 이야기를 들려줍니다. 훗날 안드레이 타르콥스키 감독의 영화 《솔라리스》와 《거울》에서도 인간의 고향과 기억을 상징하는 핵심 장면으로 오마주되었습니다."
    ],
    storyEn: [
      "Created in 1565 as part of a cycle of the seasons for an Antwerp merchant's dining room, this panel captures the dead of winter during Europe's brutally cold Little Ice Age.",
      "From exhausted hunters in the snow to tiny skaters gleaming on frozen ponds below, Bruegel wove dozens of miniature stories into one sweeping panorama—later famously homaged in Tarkovsky's Solaris."
    ],
    details: [
      {
        titleKo: "여우 한 마리뿐인 빈약한 사냥 성과",
        titleEn: "A Meager Winter Hunt",
        textKo: "지친 개들을 이끌고 눈밭을 헤치며 내려오는 세 사냥꾼의 등을 보면 수확은 고작 여우 한 마리뿐입니다. 고개를 숙인 개들과 구부정한 어깨에서 겨울의 고단함이 전해집니다.",
        textEn: "Look closely at the hunters' backs: after a long trek through deep snow, their entire catch is a single scrawny fox, mirrored in the slumped posture of their weary hounds.",
      },
      {
        titleKo: "여관 앞 돼지 그슬리기와 간판의 디테일",
        titleEn: "The Inn & Hearth Fire",
        textKo: "왼쪽 ‘사슴 여관(Dit is in den Hert)’ 간판이 한쪽 고리가 풀려 비스듬히 매달려 있고, 그 아래에서는 마을 사람들이 모닥불을 피워 겨울 식량을 준비하고 있습니다.",
        textEn: "Outside the inn on the left—its wooden sign hanging precariously from one hinge—villagers tend a roaring fire to singe a pig for winter provisions.",
      },
      {
        titleKo: "얼어붙은 연못 위의 작은 축제와 하늘의 까치",
        titleEn: "Skaters Below & Birds Above",
        textKo: "언덕 아래 얼어붙은 호수를 4K로 확대해 보세요. 스케이트·썰매·컬링을 즐기는 수많은 마을 사람들과 굴뚝 불을 끄려 사다리를 든 주민, 나뭇가지 위 까마귀와 날아오르는 까치까지 깨알 같은 일상이 살아 숨 쉽니다.",
        textEn: "Zoom into the frozen ponds below to discover dozens of tiny villagers skating, playing ice games, and fighting a chimney fire, framed by perched crows and a gliding magpie.",
      },
    ],
  },
  "arnolfini": {
    artistId: "van-eyck",
    movementKo: "초기 플랑드르파 · 북유럽 르네상스",
    movementEn: "Early Netherlandish · Northern Renaissance",
    mediumKo: "오크 나무판에 유채 · 82.2 × 60 cm",
    mediumEn: "Oil on oak panel · 82.2 × 60 cm",
    collectionKo: "런던 내셔널 갤러리",
    collectionEn: "The National Gallery, London",
    leadKo: "거울 속 숨겨진 증인들과 화가의 라틴어 서명까지, 600년 전 브뤼허의 한 방을 돋보기처럼 정밀하게 봉인한 유화의 기적입니다.",
    leadEn: "A triumph of Early Netherlandish oil glazing packed with luminous textures, hidden symbols, and a convex mirror revealing the artist himself as witness.",
    storyKo: [
      "1434년 플랑드르의 무역 도시 브뤼허에서 활동하던 이탈리아 루카 출신 부유한 상인 조반니 디 니콜라오 아르놀피니와 그의 아내를 그린 것으로 알려진 작품입니다. 오랫동안 두 사람의 결혼 서약 장면으로 해석되어 왔으며, 최근에는 세상을 떠난 아내를 기리는 추모 초상이라는 흥미로운 학설도 제기되고 있습니다.",
      "이 작품이 미술사에서 경외받는 이유는 초기 유화 기법의 압도적인 완성도 때문입니다. 모피 코트의 솜털 한 올, 황동 샹들리에의 금속 광택, 그리고 방 안 전체를 거꾸로 비추는 볼록 거울까지—마치 고해상도 사진처럼 15세기 부유층의 실내를 영원히 기록해 두었습니다."
    ],
    storyEn: [
      "Painted in Bruges in 1434, this celebrated double portrait depicts Italian merchant Giovanni di Nicolao di Arnolfini and his wife. Long read as a visual wedding contract, it has also intrigued scholars as a possible posthumous memorial.",
      "Its fame rests equally on Jan van Eyck's astonishing command of oil glazes—rendering velvet, fur, brass luster, and curved mirror reflections with unprecedented optical realism."
    ],
    details: [
      {
        titleKo: "볼록 거울 속 두 명의 증인과 화가의 라틴어 서명",
        titleEn: "The Convex Mirror & Signature",
        textKo: "배경 중앙의 작은 볼록 거울을 최대한 확대해 보세요. 부부의 뒷모습과 함께 방 문턱에 서 있는 두 인물(그중 푸른 옷을 입은 이가 화가 자신)이 비치고, 그 위 벽에는 “얀 반 에이크 여기 있었노라 1434”라는 장식 서명이 적혀 있습니다.",
        textEn: "Zoom into the central convex mirror: it reflects the couple from behind plus two visitors at the doorway, beneath the ornate Latin inscription 'Jan van Eyck was here 1434.'",
      },
      {
        titleKo: "샹들리에의 단 하나의 촛불과 발치의 강아지",
        titleEn: "Single Candle & Loyal Terrier",
        textKo: "화려한 황동 샹들리에에 낮인데도 켜져 있는 단 하나의 촛불은 모든 것을 지켜보는 신의 눈을, 발치의 작은 브뤼셀 그리폰 강아지는 부부의 신의와 충절을 상징합니다.",
        textEn: "A single lit candle in the ornate chandelier symbolizes God's all-seeing presence, while the little terrier at their feet stands for fidelity.",
      },
      {
        titleKo: "창가의 오렌지와 벗어둔 나막신",
        titleEn: "Oranges & Cast-Off Clogs",
        textKo: "당시 북유럽에서 귀한 사치품이었던 창가의 오렌지는 상인의 막대한 부와 에덴의 순수함을, 바닥에 벗어둔 나막신은 이 방이 성스러운 서약의 공간임을 암시합니다.",
        textEn: "Exotic imported oranges on the windowsill signal immense merchant wealth, while the discarded wooden clogs suggest standing on sacred domestic ground.",
      },
    ],
  },
  "las-meninas": {
    artistId: "velazquez",
    movementKo: "스페인 바로크",
    movementEn: "Spanish Baroque",
    mediumKo: "캔버스에 유채 · 318 × 276 cm",
    mediumEn: "Oil on canvas · 318 × 276 cm",
    collectionKo: "마드리드 프라도 미술관",
    collectionEn: "Museo del Prado, Madrid",
    leadKo: "그림을 보는 우리가 곧 스페인 국왕 부부의 자리에 서게 되는, 서양 미술사상 가장 지적이고 매혹적인 시선의 미궁입니다.",
    leadEn: "Velázquez's dazzling Baroque puzzle places the viewer in the exact spot of Spain's King and Queen—caught inside the studio mirror.",
    storyKo: [
      "1656년, 스페인 펠리페 4세의 수석 궁정화가 벨라스케스가 알카사르 궁전의 자신의 화실을 무대로 그린 걸작입니다. 화면 중앙에는 다섯 살 난 마르가리타 공주가 시녀(메니나스)들과 난쟁이, 거대한 마스티프 개에 둘러싸여 서 있고, 왼쪽에는 벨라스케스 자신이 붓과 팔레트를 든 채 거대한 캔버스 앞에서 바깥을 응시하고 있습니다.",
      "도대체 벨라스케스는 무엇을 그리고 있으며, 공주와 화가는 누구를 바라보고 있을까요? 그 해답은 뒤쪽 벽 중앙의 거울 속에 흐릿하게 비친 펠리페 4세와 마리아나 왕비에게 있습니다. 즉, 지금 이 그림을 바라보는 관람객이 바로 모델이 된 국왕 부부의 자리에 서 있는 놀라운 착시를 연출한 것입니다."
    ],
    storyEn: [
      "Painted in 1656 inside Madrid's Royal Alcázar, Velázquez stages five-year-old Infanta Margarita attended by her maids of honor (meninas), court dwarfs, and a massive mastiff—while the artist himself pauses brush-in-hand behind a towering canvas.",
      "Who are the princess and painter staring out at? The dim mirror on the far wall holds the answer: King Philip IV and Queen Mariana, placing the viewer directly in the royal couple's shoes."
    ],
    details: [
      {
        titleKo: "뒤쪽 벽 거울 속 국왕 부부와 계단의 집사",
        titleEn: "The Royal Mirror & Doorway",
        textKo: "배경의 빛나는 거울에는 국왕 부부의 모습이 비치고, 그 옆 환하게 열린 문 계단 위에서는 왕비의 시종장 호세 니에토가 커튼을 젖힌 채 이 장면을 지켜보며 깊은 공간감을 만듭니다.",
        textEn: "Beyond the mirrored reflection of the royal couple, Queen's chamberlain José Nieto pauses on the sunlit back stairs, pulling the space deep into the palace.",
      },
      {
        titleKo: "벨라스케스 가슴에 뒤늦게 추가된 붉은 십자가",
        titleEn: "The Red Cross of Santiago",
        textKo: "화가가 입은 검은 옷 가슴의 붉은 십자가는 스페인 최고 귀족 기사단인 ‘산티아고 기사단’의 문장입니다. 그림 완성 3년 뒤 기사 작위를 받자 훗날 덧그려 넣은 것으로 전해집니다.",
        textEn: "The red cross on Velázquez's doublet signifies the noble Order of Santiago—a knighthood granted three years after the painting was completed and added afterward.",
      },
      {
        titleKo: "공주의 드레스에서 빛나는 마법 같은 자유 필치",
        titleEn: "Impressionistic Brushwork in 1656",
        textKo: "마르가리타 공주의 은빛 드레스와 머리의 붉은 리본을 확대해 보면 정교한 선이 아니라 굵고 자유분방한 물감 터치의 조합임에 놀라게 됩니다. 200년 뒤 인상주의를 예고한 솜씨입니다.",
        textEn: "Zoom into Margarita's luminous gown and ribbons: up close they dissolve into bold, rapid dashes of pigment that stunned nineteenth-century Impressionists.",
      },
    ],
  },
  "temeraire": {
    artistId: "turner",
    movementKo: "영국 낭만주의",
    movementEn: "British Romanticism",
    mediumKo: "캔버스에 유채 · 90.7 × 121.6 cm",
    mediumEn: "Oil on canvas · 90.7 × 121.6 cm",
    collectionKo: "런던 내셔널 갤러리",
    collectionEn: "The National Gallery, London",
    leadKo: "트라팔가르 해전의 전설적인 범선이 검은 증기 예인선에 끌려 해체장으로 향하는, 한 시대의 저묾을 노래한 황금빛 애가입니다.",
    leadEn: "A glorious veteran warship of Trafalgar is towed to the scrapyard by a soot-belching steam tug—Turner's blazing elegy for the passing Age of Sail.",
    storyKo: [
      "1805년 트라팔가르 해전에서 넬슨 제독의 기함을 지켜내며 영국 승리의 주역이 되었던 98문급 대형 전함 ‘테메레르(HMS Temeraire)’는 30여 년이 지난 1838년 퇴역해 해체장으로 끌려갔습니다. 터너는 이 역사적 순간을 신구 시대의 극적인 교체라는 장엄한 시로 승화시켰습니다.",
      "하얗고 우아한 유령처럼 빛나는 위풍당당한 목조 범선 앞에, 검고 작은 철제 증기 예인선이 시커먼 연기를 내뿜으며 앞서갑니다. 터너는 이 작품을 생전에 단 한 번도 팔지 않고 끝까지 ‘나의 소중한 보물(My Darling)’이라 부르며 간직했고, 2005년 BBC 투표에서 영국인이 가장 사랑하는 그림 1위로 선정되었습니다."
    ],
    storyEn: [
      "In 1838, the legendary 98-gun warship HMS Temeraire—hero of the 1805 Battle of Trafalgar—was decommissioned and towed up the Thames to be broken up for scrap. Turner transformed the journey into a poignant meditation on time and industrial progress.",
      "Cherishing the canvas so deeply that he refused to sell it, calling it 'my darling,' Turner created a work later voted Britain's greatest painting."
    ],
    details: [
      {
        titleKo: "역사적 사실보다 시적 상징을 택한 돛대",
        titleEn: "Poetic License in the Masts",
        textKo: "실제 해체장으로 끌려갈 때 테메레르호의 돛대는 이미 모두 제거된 상태였지만, 터너는 노장 전함의 마지막 위엄을 지키기 위해 높다란 돛대와 밧줄을 황금빛으로 되살려 놓았습니다.",
        textEn: "In reality, the ship's masts had already been stripped before towing; Turner restored them in pale gold to preserve the veteran vessel's noble majesty.",
      },
      {
        titleKo: "차가운 초승달과 타오르는 석양의 이분할 하늘",
        titleEn: "Cool Moon vs. Blazing Sunset",
        textKo: "왼쪽의 차갑고 푸른 하늘 아래 뜬 가느다란 초승달은 저물어가는 과거의 전함을, 오른쪽 불타오르는 주황빛 석양은 격동하는 새로운 산업 시대의 에너지를 대조적으로 비춥니다.",
        textEn: "A pale crescent moon cools the left sky above the ghostly warship, balanced by an explosive scarlet-and-gold sunset igniting the right horizon.",
      },
      {
        titleKo: "검은 연기를 뿜는 작은 증기 예인선",
        titleEn: "The Sooty Steam Tug",
        textKo: "거대한 전함보다 훨씬 작지만 불꽃과 검은 매연을 뿜으며 묵묵히 배를 끌고 가는 증기선은, 낭만의 범선 시대가 끝나고 기계 문명이 도래했음을 강렬히 각인합니다.",
        textEn: "Dwarfed by the grand sailing ship yet belching fire and dark smoke, the squat steam tug signals the irreversible triumph of the Industrial Age.",
      },
    ],
  },
  "card-players": {
    artistId: "cezanne",
    movementKo: "후기인상주의",
    movementEn: "Post-Impressionism",
    mediumKo: "캔버스에 유채 · 47.5 × 57 cm",
    mediumEn: "Oil on canvas · 47.5 × 57 cm",
    collectionKo: "파리 오르세 미술관",
    collectionEn: "Musée d'Orsay, Paris",
    leadKo: "요란한 도박장의 소란을 지우고, 오직 두 농부의 깊은 침묵과 단단한 기하학적 균형으로 현대미술의 문을 연 걸작입니다.",
    leadEn: "Stripping away tavern drama, Cézanne turns two Provençal laborers playing cards into a quiet monument of geometric form and stillness.",
    storyKo: [
      "1890년대 초중반, 고향 엑상프로방스에 은거하던 폴 세잔은 인근 농장 일꾼들을 모델로 총 다섯 점의 《카드놀이 하는 사람들》 연작을 제작했습니다. 과거 바로크 시대의 카드놀이 그림들이 속임수와 술 취한 소란을 과장했던 것과 달리, 세잔은 극도의 절제와 고요한 집중만으로 화면을 채웠습니다.",
      "이 오르세 미술관 버전은 다섯 점 중 가장 응축된 구도를 자랑합니다. 세잔은 두 인물의 팔과 모자, 식탁보, 그리고 중앙의 포도주병을 건축 블록처럼 단단한 색면으로 조립해내며, 훗날 피카소와 브라크의 입체주의로 이어지는 혁명적 조형 언어를 완성했습니다."
    ],
    storyEn: [
      "During the early 1890s in Aix-en-Provence, Cézanne painted five versions of local farmhands playing cards. Rejecting the rowdy cheating dramas of earlier art, he stripped the game down to pure silence and concentration.",
      "This distilled two-player composition—the culmination of the series—builds coats, hats, and tabletop from solid architectural planes of color, laying the structural bedrock for Cubism."
    ],
    details: [
      {
        titleKo: "화면을 좌우로 나누는 중앙의 와인병",
        titleEn: "The Wine Bottle Axis",
        textKo: "식탁 중앙에서 살짝 오른쪽으로 치우친 어두운 포도주병이 두 플레이어 사이의 보이지 않는 대칭축 역할을 하며, 병목의 한 줄기 흰 빛이 팽팽한 침묵에 긴장감을 더합니다.",
        textEn: "Slightly off-center, the dark wine bottle acts as a quiet architectural divider between the two players, its crisp vertical highlight anchoring the stillness.",
      },
      {
        titleKo: "서로 다른 자세와 색채로 맞선 두 농부",
        titleEn: "Subtle Counterbalance",
        textKo: "왼쪽 남성은 단정한 모자와 파이프를 물고 여유롭게 앉아 있는 반면, 오른쪽 남성은 몸을 앞으로 숙인 채 신중히 패를 고르고 있어 미묘한 심리적 균형을 이룹니다.",
        textEn: "The smoker on the left sits upright in cool blue-violet tones, while his opponent leans forward in warm ochre—creating quiet psychological tension.",
      },
      {
        titleKo: "벽돌처럼 차곡차곡 쌓아 올린 색면 붓질",
        titleEn: "Constructive Color Planes",
        textKo: "확대해 보면 윤곽선 대신 방향성을 가진 굵은 직사각형 색면들이 서로 맞물리며 인물에 조각 같은 무게감과 영속성을 부여하고 있음을 볼 수 있습니다.",
        textEn: "Up close, coats and faces are constructed from rhythmic, overlapping patches of warm and cool color rather than smooth blending.",
      },
    ],
  },
  "where-from": {
    artistId: "gauguin",
    movementKo: "후기인상주의 · 종합주의",
    movementEn: "Post-Impressionism · Synthetism",
    mediumKo: "캔버스에 유채 · 139.1 × 374.6 cm",
    mediumEn: "Oil on canvas · 139.1 × 374.6 cm",
    collectionKo: "보스턴 미술관",
    collectionEn: "Museum of Fine Arts, Boston",
    leadKo: "삶의 끝자락에서 타히티의 거대한 화폭에 새긴 인류 존재에 대한 세 가지 근원적 질문이자 고갱 예술의 유언장입니다.",
    leadEn: "Painted in Tahiti during profound grief, Gauguin's monumental frieze reads right to left—asking life's three ultimate questions.",
    storyKo: [
      "원제는 《우리는 어디서 왔는가? 우리는 무엇인가? 우리는 어디로 가는가?》입니다. 1897년 타히티에서 극심한 빈곤과 병마에 시달리던 고갱은 가장 사랑하던 딸 알린이 스무 살의 나이로 세상을 떠났다는 비보를 듣고 깊은 절망에 빠졌습니다. 그는 스스로 생을 마감하기 전 자신의 예술 세계 전체를 집대성할 유작을 남기기로 결심하고, 한 달 동안 광기 어린 몰입으로 폭 3.7미터의 이 대작을 완성했습니다.",
      "다행히 직후의 극단적 시도는 미수에 그쳤고, 고갱은 친구에게 보낸 편지에서 “이 그림은 나의 이전 모든 작품을 능가하며, 앞으로도 이보다 나은 그림은 결코 그리지 못할 것”이라고 자평했습니다. 서양의 전통적인 좌→우 읽기와 반대로 오른쪽에서 왼쪽으로 읽어 나가며 탄생·청춘·노년과 죽음이라는 인간의 일생을 사색하게 합니다."
    ],
    storyEn: [
      "Full title: Where Do We Come From? What Are We? Where Are We Going? Stricken by illness, debt, and news of his beloved daughter Aline's death in 1897, Gauguin poured his entire artistic philosophy into this 3.7-meter-wide Tahitian testament over one feverish month.",
      "Intended to be read from right to left like an ancient scroll, the frieze traces the full arc of human existence—from sleeping infancy through striving maturity to quiet old age."
    ],
    details: [
      {
        titleKo: "오른쪽에서 왼쪽으로 흐르는 생애의 세 막",
        titleEn: "Reading Right to Left",
        textKo: "오른쪽 끝 잠든 아기(‘우리는 어디서 왔는가’)에서 시작해, 중앙의 과일을 따는 젊은 인물(‘우리는 무엇인가’)을 거쳐, 왼쪽 끝 고개를 감싸 쥔 늙은 여인(‘우리는 어디로 가는가’)으로 인생이 이어집니다.",
        textEn: "Begin at the far right with the sleeping infant (birth), move to the central fruit-picker (life's prime), and end at the far left with the crouched elderly woman contemplating mortality.",
      },
      {
        titleKo: "왼쪽 상단 황금 모서리에 적은 프랑스어 제목",
        titleEn: "The Golden Corner Inscription",
        textKo: "고갱은 마치 낡은 프레스코 벽화의 모서리가 벗겨진 듯 황금색 칠을 입히고, 왼쪽 위에는 프랑스어 원제를, 오른쪽 위에는 자신의 서명과 연도를 적어 넣었습니다.",
        textEn: "Painting luminous yellow corners to evoke a time-worn fresco, Gauguin inscribed the French title at upper left and his signature at upper right.",
      },
      {
        titleKo: "신비로운 푸른 우상과 흰 새의 상징",
        titleEn: "The Blue Idol & White Bird",
        textKo: "왼쪽 뒤편의 두 손을 든 푸른 조각상은 피안(저승)의 세계를 가리키며, 왼쪽 아래 도마뱀을 움켜쥔 흰 새는 ‘말의 헛됨’을 상징한다고 고갱 스스로 설명했습니다.",
        textEn: "Behind the figures, a blue Tahitian idol raises its arms toward the beyond, while the white bird gripping a lizard at bottom left represents, in Gauguin's words, 'the futility of words.'",
      },
    ],
  },
  "school-of-athens": {
    artistId: "raphael",
    movementKo: "전성기 르네상스",
    movementEn: "High Renaissance",
    mediumKo: "벽면 프레스코 · 약 500 × 770 cm",
    mediumEn: "Fresco · approx. 500 × 770 cm",
    collectionKo: "바티칸 궁전 서명의 방",
    collectionEn: "Apostolic Palace (Stanza della Segnatura), Vatican City",
    leadKo: "고대 그리스의 모든 지성이 웅장한 르네상스 아치 아래 한자리에 모여 진리를 논하는 인문주의의 영원한 전당입니다.",
    leadEn: "Raphael gathers antiquity's greatest philosophers and scientists beneath soaring Renaissance vaults—the supreme visual hymn to human reason.",
    storyKo: [
      "1509년, 교황 율리오 2세는 불과 스물여섯 살이던 라파엘로에게 바티칸 궁전의 개인 서재 ‘서명의 방’ 벽화 장식을 맡겼습니다. 라파엘로는 신학·철학·법학·시학이라는 르네상스 지식의 네 기둥 중 ‘철학(인간의 이성)’을 상징하는 이 거대한 프레스코화를 2년에 걸쳐 완성했습니다.",
      "화폭에는 시대와 장소를 초월해 고대 그리스와 지중해 세계의 철학자·수학자·천문학자 50여 명이 생동감 넘치는 토론을 벌이고 있습니다. 특히 라파엘로는 고대 철학자들의 얼굴에 당대 최고의 르네상스 거장 레오나르도 다 빈치, 미켈란젤로, 그리고 자기 자신의 얼굴을 절묘하게 투영해 예술가의 지위를 철학자의 반열로 끌어올렸습니다."
    ],
    storyEn: [
      "In 1509, Pope Julius II commissioned the twenty-six-year-old Raphael to fresco his private Vatican library, the Stanza della Segnatura. Representing Philosophy and human reason, The School of Athens assembles over fifty classical thinkers across centuries into one radiant hall.",
      "Cleverly casting contemporaries like Leonardo da Vinci, Michelangelo, and himself in the roles of ancient sages, Raphael boldly declared Renaissance artists the intellectual equals of antiquity's greatest minds."
    ],
    details: [
      {
        titleKo: "하늘을 가리키는 플라톤과 땅을 가리키는 아리스토텔레스",
        titleEn: "Plato & Aristotle at Center",
        textKo: "모든 원근법의 소실점이 모이는 중앙에서 레오나르도 다 빈치를 닮은 노인 플라톤은 이데아의 세계(하늘)를 가리키고, 젊은 아리스토텔레스는 경험적 현실(땅)을 향해 손바닥을 뻗어 서양 철학의 두 기둥을 한눈에 보여줍니다.",
        textEn: "Framed at the exact vanishing point, Plato (modeled on Leonardo) points skyward to the realm of ideal Forms, while Aristotle gestures horizontally toward the empirical earthly world.",
      },
      {
        titleKo: "계단에 턱을 괴고 고독하게 글을 쓰는 미켈란젤로",
        titleEn: "Michelangelo as Heraclitus",
        textKo: "중앙 앞 대리석 블록에 팔을 기댄 우울한 철학자 헤라클레이토스는 당시 옆방 시스티나 성당 천장화를 그리던 미켈란젤로의 얼굴과 웅장한 체격으로 뒤늦게 추가한 경의의 오마주입니다.",
        textEn: "Added late in the process, the brooding philosopher Heraclitus leaning on a marble block in the foreground is a direct tribute to Michelangelo, who was painting the Sistine Chapel nearby.",
      },
      {
        titleKo: "오른쪽 끝에서 관람객을 바라보는 라파엘로의 자화상",
        titleEn: "Raphael's Quiet Self-Portrait",
        textKo: "오른쪽 기둥 옆 천구의와 지구의 주변 군중 속을 확대해 보세요. 검은 모자를 쓰고 유일하게 정면의 우리를 고요히 바라보는 젊은 청년이 바로 라파엘로 자신입니다.",
        textEn: "Look near the far right beside the astronomers holding globes: the young man in a dark cap gazing calmly straight out at us is Raphael himself.",
      },
    ],
  },
  "folies-bergere": {
    artistId: "manet",
    movementKo: "사실주의 · 인상주의",
    movementEn: "Realism · Modernism",
    mediumKo: "캔버스에 유채 · 96 × 130 cm",
    mediumEn: "Oil on canvas · 96 × 130 cm",
    collectionKo: "런던 코톨드 갤러리",
    collectionEn: "The Courtauld Gallery, London",
    leadKo: "화려한 파리 사교장의 샹들리에 불빛과 의도적으로 어긋난 거울 반사 속에 현대 도시인의 고독을 담아낸 마네의 마지막 대작입니다.",
    leadEn: "Manet's final masterpiece contrasts glittering Parisian nightlife with a barmaid's weary gaze—and a deliberately impossible mirror reflection.",
    storyKo: [
      "1882년, 심각한 지병으로 걷기조차 힘들던 말년의 에두아르 마네는 파리에서 가장 화려했던 카바레 ‘폴리베르제르’의 실제 바텐더 쉬종을 자신의 화실로 초대해 마지막 대작을 완성했습니다. 그해 파리 살롱전에 출품되어 큰 찬사를 받았지만, 마네는 이듬해 세상을 떠나고 말았습니다.",
      "겉보기에는 샴페인 병과 크리스털 샹들리에, 수많은 관중이 반짝이는 화려한 밤의 풍경이지만, 바 중앙에 선 여인의 공허하고 지친 눈빛은 군중 속의 깊은 소외감을 드러냅니다. 마네는 일부러 거울의 반사 각도를 물리적으로 불가능하게 어긋나게 그려, 관람객으로 하여금 ‘현실과 환상, 시선과 욕망’에 대해 끊임없이 질문하게 만듭니다."
    ],
    storyEn: [
      "Completed in 1882 as illness confined Manet to his studio, A Bar at the Folies-Bergère posed real barmaid Suzon behind a marble counter laden with bottles and oranges. Exhibited at the Paris Salon a year before his death, it became his crowning farewell.",
      "Beneath dazzling chandeliers and a bustling crowd, Suzon's distant, fatigued stare—paired with an impossible mirror reflection—captures the alienation of modern urban life."
    ],
    details: [
      {
        titleKo: "물리적으로 불가능한 거울 속의 수수께끼",
        titleEn: "The Impossible Mirror Reflection",
        textKo: "여인은 정면을 똑바로 보고 있는데, 뒤편 거울에 비친 여인의 뒷모습은 오른쪽으로 크게 치우친 채 실크햇을 쓴 신사와 가까이 대화를 나누고 있습니다. 실수인가, 아니면 두 개의 시간과 심리를 한 화폭에 겹쳐놓은 마네의 천재적 장치인가를 두고 지금도 논쟁이 이어집니다.",
        textEn: "Suzon faces straight ahead, yet her reflection shifts sharply right to lean toward a top-hatted gentleman—an intentional optical paradox that turns the viewer into the unseen customer.",
      },
      {
        titleKo: "왼쪽 상단 그네 위 공중곡예사의 초록색 장화",
        titleEn: "The Trapeze Artist's Green Boots",
        textKo: "왼쪽 맨 위 모서리를 확대해 보세요! 공연장 천장 그네에 매달린 공중곡예사의 두 다리와 초록색 부츠만 살짝 잘려 들어와, 이곳이 서커스와 음악이 펼쳐지던 유흥 극장임을 재치 있게 알려줍니다.",
        textEn: "Look at the top-left corner: just the legs and bright green boots of a trapeze artist dangle on a bar, hinting at the live spectacle beyond the frame.",
      },
      {
        titleKo: "대리석 바 위의 정물과 붉은 삼각형 맥주병",
        titleEn: "Still Life & Bass Pale Ale",
        textKo: "전경의 샴페인, 크렘 드 멘트, 오렌지 그릇, 그리고 붉은 삼각형 로고가 선명한 영국 배스(Bass) 맥주병은 마네가 평생 연마한 정물화 기량의 정수를 보여줍니다.",
        textEn: "Across the marble counter, champagne bottles, glowing tangerines, roses, and bottles of Bass Pale Ale bearing its iconic red triangle showcase Manet's virtuoso still-life mastery.",
      },
    ],
  },
  "dance-class": {
    artistId: "degas",
    movementKo: "인상주의",
    movementEn: "Impressionism",
    mediumKo: "캔버스에 유채 · 85 × 75 cm",
    mediumEn: "Oil on canvas · 85 × 75 cm",
    collectionKo: "파리 오르세 미술관",
    collectionEn: "Musée d'Orsay, Paris",
    leadKo: "화려한 무대 조명이 꺼진 연습실, 땀 흘리며 쉬고 긴장하는 어린 발레리나들의 꾸밈없는 일상을 스냅샷처럼 포착했습니다.",
    leadEn: "Far from stage glamour, Degas slips backstage into a Paris Opéra rehearsal—capturing candid stretches, nerves, and discipline with camera-like immediacy.",
    storyKo: [
      "1874년 완성된 《발레 수업》은 에드가 드가가 평생 천착했던 발레 연작 중 가장 야심 차고 완성도 높은 초기 걸작입니다. 파리 오페라 극장의 전설적인 안무가 쥘 페로가 나무 지팡이를 짚고 서서 어린 무용수들의 시험과 연습을 지도하는 생생한 현장을 담았습니다.",
      "드가는 관객에게 환상을 파는 무대 위 공연보다, 무대 뒤 연습실에서 발목이 붓고 지친 채 순서를 기다리는 소녀들의 ‘진짜 노동의 순간’에 매료되었습니다. 그는 수십 차례의 드로잉을 모아 치밀하게 계산된 비대칭 구도를 설계했지만, 결과물은 마치 방금 문을 열고 엿본 듯 놀라울 만큼 자연스럽습니다."
    ],
    storyEn: [
      "Completed in 1874, The Dance Class is one of Degas's most ambitious early ballet masterpieces, depicting famed ballet master Jules Perrot leaning on his staff as young dancers undergo examination at the Paris Opéra.",
      "Rather than idealizing theatrical fantasy, Degas focused on candid backstage effort—exhaustion, nerves, and routine—combining painstaking studio composition with the spontaneity of a photograph."
    ],
    details: [
      {
        titleKo: "피아노 위에 걸터앉아 등을 긁는 소녀",
        titleEn: "Candid Unposed Gestures",
        textKo: "왼쪽 전경의 소녀는 우아한 발레 포즈 대신 피아노 위에 걸터앉아 무심코 등을 긁고 있고, 옆 소녀는 리본을 고쳐 매거나 귀걸이를 만집니다. 무대 뒤의 솔직한 인간미가 그대로 살아 있습니다.",
        textEn: "In the left foreground, a dancer perches casually on a piano scratching her back while others adjust ribbons, stretch ankles, or wait nervously for their turn.",
      },
      {
        titleKo: "발치의 작은 강아지와 물뿌리개",
        titleEn: "The Watering Can & Little Dog",
        textKo: "왼쪽 아래 구석의 녹색 물뿌리개는 연습실 마루에 물을 뿌려 먼지를 가라앉히고 미끄럼을 방지하던 필수 도구이며, 그 옆에는 한 무용수가 데려온 작은 강아지가 웅크려 있습니다.",
        textEn: "Notice the green watering can at bottom left—used to dampen dusty wooden floors for traction—paired with a tiny terrier curled beside a dancer's skirt.",
      },
      {
        titleKo: "대각선 마룻바닥과 거울 속 파리 창가",
        titleEn: "Diagonal Floorboards & Mirror",
        textKo: "넓게 비워 둔 오른쪽 아래 마룻바닥의 사선과 중앙 뒤편 거울에 비친 맞은편 창문이 좁은 연습실에 깊고 역동적인 공간감을 부여합니다.",
        textEn: "Sweeping diagonal floorboards draw the eye straight toward the aging ballet master, while the rear wall mirror expands the room with reflected Parisian daylight.",
      },
    ],
  },
  "ssireum": {
    artistId: "kim-hong-do",
    movementKo: "조선 후기 풍속화",
    movementEn: "Late Joseon Genre Painting",
    mediumKo: "종이에 수묵담채 · 27 × 22.7 cm",
    mediumEn: "Ink and light color on paper · 27 × 22.7 cm",
    collectionKo: "국립중앙박물관 (보물 제527호)",
    collectionEn: "National Museum of Korea (Treasure No. 527)",
    leadKo: "배경을 과감히 비우고 둥글게 모여든 구경꾼들의 함성과 팽팽한 승부의 찰나를 유쾌한 해학으로 담아낸 조선 풍속화의 백미입니다.",
    leadEn: "Removing all background scenery, Kim Hong-do arranges cheering spectators in a vibrant ring around two straining wrestlers—complete with a playful hidden quirk.",
    storyKo: [
      "조선 후기 도화서 화원 단원 김홍도가 그린 《단원 풍속도첩》 25점 가운데 가장 널리 사랑받는 대표작입니다. 18세기 후반 장터나 마을 공터에서 벌어진 씨름판의 열기를 단 27cm 남짓한 작은 종이 위에 놀라운 밀도와 생동감으로 압축해냈습니다.",
      "배경의 산이나 나무를 일절 그리지 않고 오직 인물들만으로 X자형 원형 구도를 짰습니다. 갓을 쓴 양반부터 상투 튼 장정, 댕기 머리 아이까지 신분과 나이를 넘어 모두가 한마음으로 승부에 몰입하는 모습은 조선 서민 사회의 건강한 활력을 보여줍니다."
    ],
    storyEn: [
      "The best-loved leaf from the 25-scene Danwon Genre Painting Album, Ssireum condenses the roar of an eighteenth-century Korean village wrestling match onto a compact sheet of paper.",
      "Omitting trees or buildings entirely, Kim Hong-do builds a dynamic circular X-composition where scholars in horsehair hats and commoners alike lean in together at the decisive throw."
    ],
    details: [
      {
        titleKo: "승부에 무심한 채 고개를 돌린 엿장수 소년",
        titleEn: "The Unbothered Taffy Seller",
        textKo: "스무 명 넘는 구경꾼 모두가 숨죽여 씨름판을 노려보는 가운데, 오른쪽 위 엿판을 메고 서 있는 소년만 유일하게 딴청을 피우며 엿을 팔려 합니다. 긴장감 넘치는 화면에 숨통을 틔워주는 단원 특유의 해학입니다.",
        textEn: "While every spectator stares intently at the match, only the young taffy peddler at upper right looks away toward potential customers—adding Kim Hong-do's trademark comic relief.",
      },
      {
        titleKo: "유명한 ‘반대로 그려진 손과 발’의 비밀",
        titleEn: "The Famous Reversed Hands & Feet",
        textKo: "오른쪽 아래 부채를 쥔 인물과 그 옆 땅을 짚은 구경꾼을 4K로 확대해 보세요! 엄지손가락 방향이나 좌우 발이 뒤바뀌어 그려진 부분이 보입니다. 일부러 웃음을 유발하려 넣은 장난인지, 거침없는 속필의 흔적인지 지금도 흥미로운 감상 포인트로 꼽힙니다.",
        textEn: "Zoom into the spectators along the lower right: look closely at the hands bracing on the ground and crossed feet—some appear playfully swapped left-for-right, sparking endless delight among viewers.",
      },
      {
        titleKo: "벗어둔 짚신과 팽팽히 엉킨 두 장사의 힘",
        titleEn: "Cast-Off Straw Sandals & Tension",
        textKo: "경기장 한켠에 나란히 벗어둔 두 켤레의 짚신이 승부의 현장감을 더하고, 들배지기를 당해 발이 공중에 뜬 장사의 다급한 표정과 버티는 상대의 근육이 정지 화면에 폭발적인 에너지를 불어넣습니다.",
        textEn: "Two pairs of straw sandals left tidily beside the ring anchor the arena, while the lifted wrestler's strained grimace freezes the exact split-second before the fall.",
      },
    ],
  },
  "inwang": {
    artistId: "jeong-seon",
    movementKo: "조선 후기 진경산수화",
    movementEn: "Korean True-View Landscape",
    mediumKo: "종이에 수묵 · 79.2 × 138.2 cm",
    mediumEn: "Ink on paper · 79.2 × 138.2 cm",
    collectionKo: "국립중앙박물관 (국보 제216호)",
    collectionEn: "National Museum of Korea (National Treasure No. 216)",
    leadKo: "소나기가 갠 뒤 비에 젖어 검게 웅장해진 인왕산 바위산과 피어오르는 안개 속에, 병든 평생 지기의 쾌유를 빌었던 노화가의 깊은 우정이 서려 있습니다.",
    leadEn: "Painted at age seventy-six as rain cleared over Seoul's Mount Inwang, Jeong Seon poured bold wet ink—and a silent prayer for his dying lifelong friend—into Korea's supreme landscape.",
    storyKo: [
      "1751년(영조 27년) 윤5월 말, 일흔여섯 살의 노대가 겸재 정선이 여름비가 갓 그친 인왕산의 장엄한 모습을 단숨에 그려낸 한국 회화사의 최고봉입니다. 이 그림이 탄생한 배경에는 60년 지기였던 시인 사천 이병연과의 애틋한 우정이 자리하고 있습니다.",
      "당시 이병연은 인왕산 자락에서 위독한 병상에 누워 있었고, 정선은 장맛비가 갠 뒤 맑게 드러난 인왕산처럼 친구의 병마도 깨끗이 걷히기를 간절히 기원하며 이 그림을 완성했습니다. 안타깝게도 이병연은 그림이 완성된 바로 다음 날 세상을 떠나고 말아, 《인왕제색도》는 두 거장의 영원한 이별과 우정의 기념비가 되었습니다."
    ],
    storyEn: [
      "Completed in 1751 when master Jeong Seon was seventy-six years old, Clearing After Rain on Mount Inwang stands at the pinnacle of Korean True-View landscape painting—born from sixty years of devotion to his close friend, the poet Yi Byeong-yeon.",
      "As his friend lay gravely ill at the foot of the mountain, Jeong Seon painted the rain-washed granite peaks emerging from mist as a heartfelt wish for recovery. Sadly, Yi passed away the very next day, turning the scroll into a timeless monument to friendship."
    ],
    details: [
      {
        titleKo: "폭우에 젖은 화강암 암벽의 압도적 ‘적묵법’",
        titleEn: "Bold Wet-Ink Granite Mass",
        textKo: "큰 붓에 짙은 먹물을 듬뿍 적셔 위에서 아래로 힘차게 내리긋는 ‘적묵법’과 ‘부벽준’으로, 비를 머금어 검푸르게 무거워진 인왕산 화강암 절벽의 웅장한 질감을 완벽히 포착했습니다.",
        textEn: "Repeated downward strokes of saturated dark ink capture the wet, monumental weight of Mount Inwang's granite crags immediately after a summer downpour.",
      },
      {
        titleKo: "산허리를 가로지르는 백색의 비구름과 여백",
        titleEn: "Swirling Rain Mist & Negative Space",
        textKo: "칠하지 않고 남겨둔 종이의 순백 여백만으로 골짜기에서 피어오르는 안개와 물안개를 표현해, 짙은 먹색 바위산과 극적인 흑백 대비를 이룹니다.",
        textEn: "Unpainted paper becomes drifting white mist curling through the valleys, creating electrifying contrast against the rain-darkened cliffs.",
      },
      {
        titleKo: "산 아래 소나무 숲과 벗이 머물던 초당",
        titleEn: "Pines & the Friend's Pavilion",
        textKo: "화면 아래쪽 오른쪽 숲을 확대해 보면 짙은 소나무 군락 사이로 기와집과 정자가 아담하게 자리하고 있습니다. 거대한 자연의 기상 아래 고요히 숨 쉬는 한양 인왕곡의 정취를 담았습니다.",
        textEn: "Zoom into the lower slopes: clusters of dark ink pines shelter modest tiled roofs and a quiet pavilion where Jeong Seon and his circle once exchanged poems.",
      },
    ],
  },
};

export function getArtworkStory(id: string): { story: ArtworkStory; artist: ArtistNote } | null {
  const story = ARTWORK_STORIES[id];
  if (!story) return null;
  const artist = ARTISTS[story.artistId];
  if (!artist) return null;
  return { story, artist };
}
