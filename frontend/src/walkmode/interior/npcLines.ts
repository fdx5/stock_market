import type { FacilityKind, FacilityRole } from "./plan/types";

/* What a building's people say when the visitor does more than say hello — the Sims-like part:
 * asking how they are, a joke, a compliment, a worry shared, a question about the building, a gift.
 * Each answer is put together from parts (an opening by how well they know the visitor, a body
 * from the action's own pools — many of them templates over the floor's names — and a close), so
 * the same person rarely says the same thing twice. Also: what they say to someone running in a
 * hospital, rumours, small stories of their day, and tips for the visitor's missions. */

export type Social = "greet" | "joke" | "compliment" | "worry" | "building" | "gift" | "rumor" | "story" | "tip";
export const SOCIAL_LABEL: Record<Social, string> = {
  greet: "안부 묻기", joke: "농담하기", compliment: "칭찬하기", worry: "고민 털어놓기", building: "이 건물에 대해 묻기",
  gift: "선물 건네기", rumor: "요즘 소문 묻기", story: "사는 얘기 듣기", tip: "꿀팁 묻기",
};
export interface SocialCtx { role: FacilityRole; kind: FacilityKind; bldg: string; floor: string; places: string[]; affinity: number; rnd: () => number; gift?: string }
export interface SocialAnswer { text: string; delta: number; mood: "happy" | "neutral" | "awkward" | "annoyed" }

const pick = <T,>(r: () => number, a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];
const STAFF = new Set<FacilityRole>(["doctor", "nurse", "clerk", "guard", "desk", "cook", "teacher"]);

// ------------------------------------------------------------- how well they know the visitor
const OPEN_BY_AFFINITY: [number, string[]][] = [
  [0, ["음… 네?", "저요? 아, 네.", "무슨 일이시죠?", "아, 처음 뵙는 분이네요.", "네, 말씀하세요.", "안녕하세요, 무슨 일로 오셨어요?", "아, 네. 저 부르셨어요?"]],
  [30, ["아, 안녕하세요!", "또 뵙네요.", "네네, 말씀하세요.", "아까 그분이시죠?", "반가워요.", "오늘도 오셨네요!", "어, 또 뵙네요, 하하."]],
  [60, ["오, 왔어요?", "기다렸잖아요, 하하.", "역시 또 오셨네!", "오늘도 반가워요!", "우리 단골 오셨네요.", "어서 와요, 오늘은 무슨 얘기 할까요?", "왔어요? 앉아요 앉아."]],
  [85, ["어머, 내 친구 왔네!", "오늘 기분 좋아 보여요!", "딱 보고 싶었는데!", "오, 베프 등장!", "드디어 왔구나!", "우리 사이에 뭘 그렇게 쭈뼛거려요!", "오늘 밥 같이 먹을래요?"]],
];
const openFor = (r: () => number, a: number) => pick(r, [...OPEN_BY_AFFINITY].reverse().find(([min]) => a >= min)![1]);

// ------------------------------------------------------------- 안부 묻기
const GREET = {
  staffGood: ["덕분에 잘 지내요. 오늘은 환자분들이 다들 친절하시네요.", "바쁘지만 보람 있어요.", "점심 맛있게 먹어서 힘이 나요.", "오늘 근무는 순조로워요.", "아침에 커피 두 잔 마셔서 쌩쌩해요!", "요즘 운동을 시작해서 컨디션이 좋아요.", "어제 푹 자서 괜찮아요.", "주말에 쉬고 와서 상쾌해요.", "오늘 칭찬을 받아서 기분이 좋아요.", "동료들이 도와줘서 할 만해요.", "새로 들어온 장비가 좋아서 일이 편해요.", "오늘은 감사 인사를 세 번이나 들었어요.", "점심에 짜장면 먹었어요, 하하.", "후배가 일을 잘해서 든든해요.", "이번 달 목표를 벌써 채웠어요.", "출근길에 무지개를 봤어요.", "오늘따라 다들 웃는 얼굴이네요.", "휴가 계획 세우는 중이라 설레요."],
  staffTired: ["솔직히 좀 피곤하네요. 야간 근무였거든요.", "오늘 정신이 하나도 없어요.", "아직 점심을 못 먹었어요.", "다리가 퉁퉁 부었어요, 하하.", "커피가 절실해요.", "민원이 좀 많은 날이에요.", "퇴근 시간만 기다리고 있어요.", "어제 회식이 길어서요…", "전화가 쉬지 않고 와요.", "교대할 사람이 늦어서요.", "어깨가 뭉쳤어요.", "보고서 마감이 내일이라…", "에어컨이 너무 세서 추워요."],
  peerGood: ["그럭저럭 괜찮아요. 오늘 날씨도 좋고요.", "기분 좋아요! 방금 좋은 소식 들었거든요.", "잘 지내죠. 그쪽은요?", "오늘은 운이 좋은 날 같아요.", "요즘 새 취미가 생겨서 즐거워요.", "맛있는 거 먹고 와서 행복해요.", "기다리는 것만 빼면 다 좋아요.", "아이가 오늘 첫걸음을 뗐어요!", "복권 한 장 샀어요, 혹시 몰라서요.", "오늘 머리가 잘 됐어요.", "어제 산 운동화가 편해서 좋아요.", "친구랑 저녁 약속 있어요.", "키우는 화분에 꽃이 폈어요.", "월급날이라 기분 좋아요!", "다이어트 3일째 성공 중이에요."],
  peerMeh: ["그냥 그래요. 기다리는 게 지루하네요.", "좀 긴장돼요.", "어제 잠을 설쳐서요.", "버스를 놓쳐서 아침부터 꼬였어요.", "휴대폰 배터리가 3%예요…", "우산을 놓고 왔지 뭐예요.", "생각보다 오래 걸리네요.", "주차할 데가 없어서 한참 돌았어요.", "커피를 쏟았어요…", "점심 메뉴를 못 정하겠어요.", "할 일이 산더미예요.", "감기 기운이 좀 있어요."],
};
// ------------------------------------------------------------- 농담하기
const JOKE_SET: [string, string][] = [
  ["세상에서 가장 가난한 왕은?", "최저임금! …아, 썰렁했나요?"], ["바나나가 웃으면?", "바나나킥!"], ["소가 웃으면?", "우하하!"],
  ["왕이 넘어지면?", "킹콩!"], ["오리가 얼면?", "언덕!"], ["세상에서 가장 뜨거운 과일은?", "천도복숭아!"],
  ["깨가 죽으면?", "주근깨!"], ["가장 억울한 도형은?", "원통!"], ["자동차를 톡 치면?", "카톡!"],
  ["진짜 문제투성이인 것은?", "시험지!"], ["미소의 반대말은?", "당기소!"], ["고기 먹을 때 따라오는 개는?", "이쑤시개!"],
  ["물고기의 반대말은?", "불고기!"], ["가장 무서운 비는?", "사이비!"], ["반성문을 영어로 하면?", "글로벌!"],
  ["아몬드가 죽으면?", "다이아몬드!"], ["별이 숨는 곳은?", "별장!"], ["딸기가 직장을 잃으면?", "딸기시럽!"],
  ["엘리베이터 농담 아세요?", "그거 수준이 좀 올라가요, 하하!"], ["계단이 웃으면?", "층층이 웃겨요!"],
  ["의사가 좋아하는 음악은?", "링거송!"], ["병원 의자가 좋아하는 말은?", "앉으세요!"], ["간호사가 제일 좋아하는 꽃은?", "주사꽃… 은 없네요, 하하."],
  ["로봇이 좋아하는 국은?", "메카국!"], ["세상에서 가장 빠른 닭은?", "후다닥!"], ["비가 오면 생각나는 동물은?", "우산이… 아니 우사슴!"],
];
const JOKE_REACT = {
  laugh: ["푸하하! 아, 너무 웃겨요!", "하하하, 그거 진짜 좋은데요?", "아 배 아파, 하하!", "킥킥, 그런 거 어디서 들으셨어요?", "아재개그 장인이시네요!", "와, 그거 저도 써먹어야겠다!", "하하, 오늘 한 번 웃었네요!", "그거 회식 때 써야겠다!", "와, 순발력 대박!", "제 스타일이에요, 하하!", "웃다가 사레들렸어요, 하하."],
  groan: ["아… 썰렁해요.", "음… 노코멘트할게요.", "하하… (억지웃음)", "그건 좀… 춥네요.", "다음엔 더 센 걸로 부탁해요.", "그 정도는 저도 알아요!", "그건 우리 할아버지도 하시던 거예요.", "에어컨 켠 줄 알았어요.", "썰렁함에 소름이 돋았어요.", "점수는… 10점 만점에 3점!"],
  annoyed: ["지금 좀 바빠서요…", "농담할 기분은 아니에요.", "아까도 하셨잖아요.", "여기서 그런 얘기는 좀…"],
};
// ------------------------------------------------------------- 칭찬하기
const COMPLIMENT_REPLY = {
  happy: ["어머, 정말요? 고마워요!", "그런 말 들으니 힘이 나네요!", "아이고, 부끄럽게 왜 그래요, 하하.", "오늘 들은 말 중에 제일 좋아요.", "덕분에 하루가 환해졌어요.", "칭찬은 고래도 춤추게 한다잖아요!", "그쪽도 멋져요!", "우와, 감동이에요.", "오늘 저녁은 제가 기분 좋게 먹을 수 있겠네요.", "집에 가서 자랑해야지!", "덕분에 웃었어요.", "그런 말은 언제 들어도 좋네요."],
  staff: ["감사합니다. 더 열심히 할게요.", "그렇게 봐주시니 보람 있네요.", "제 일인걸요, 하하.", "칭찬 고객 카드에 적어주시면 더 좋고요!"],
  awkward: ["아, 네… 감사합니다.", "갑자기요? 하하…", "음… 어디서 뵌 적 있던가요?", "고맙긴 한데… 좀 부끄럽네요."],
};
const COMPLIMENT_WHAT = ["오늘 옷이 잘 어울려요", "미소가 정말 좋아요", "일을 참 꼼꼼하게 하시네요", "목소리가 듣기 좋아요", "센스가 좋으세요", "안내를 정말 친절하게 해주셨어요", "여기 분위기를 밝게 만드세요", "머리 스타일 바꾸셨어요? 잘 어울려요", "오늘 표정이 밝으세요", "정리 정돈을 참 잘하시네요", "설명을 귀에 쏙쏙 들어오게 하세요", "손글씨가 예쁘세요", "말투가 다정하세요", "안경이 잘 어울려요", "패션 센스가 남다르세요"];
// ------------------------------------------------------------- 고민 털어놓기
const WORRY_OPEN = ["음, 그런 고민이 있구나.", "아, 저도 그런 적 있어요.", "얘기해 줘서 고마워요.", "충분히 그럴 수 있어요.", "그거 진짜 힘들죠."];
const WORRY_ADVICE = [
  "너무 혼자 끌어안지 마세요.", "일단 오늘은 푹 자 보세요.", "작은 것부터 하나씩 해보면 돼요.", "산책 한 바퀴 하면 머리가 맑아져요.", "맛있는 거 먹고 다시 생각해요.",
  "가까운 사람한테 털어놓는 것도 방법이에요.", "완벽하지 않아도 괜찮아요.", "가끔은 쉬어가는 것도 용기예요.", "내일의 나에게 맡겨 봐요.", "그건 시간이 해결해 줄 거예요.",
  "목록으로 적어보면 생각보다 별거 아닐 때가 많아요.", "물 한 잔 마시고 심호흡 세 번!", "운동이 의외로 효과 있어요.", "좋아하는 노래 크게 틀어 봐요.", "남과 비교하지 마세요, 당신 속도가 있어요.",
  "잠깐 하늘 한 번 올려다봐요.", "실수는 누구나 해요, 다음에 잘하면 돼요.", "가끔은 '아니요'라고 말해도 괜찮아요.", "따뜻한 차 한 잔이 생각보다 큰 위로가 돼요.", "일기를 써 보면 마음이 정리돼요.", "오늘 잘한 일 세 가지만 떠올려 봐요.", "휴대폰 잠깐 내려놓고 쉬어 봐요.", "누구나 처음은 서툴러요.", "지금도 충분히 잘하고 있어요.", "걱정의 90%는 일어나지 않는대요."];
const WORRY_CLOSE = ["힘내요!", "응원할게요.", "잘 될 거예요.", "또 얘기하러 와요.", "", "파이팅!"];
const WORRY_COLD = ["음… 그건 제가 뭐라 하기가 좀…", "아, 네… 그렇군요.", "그런 얘기는 친한 분께 하시는 게…", "죄송해요, 지금은 들어드릴 여유가 없네요."];
// ------------------------------------------------------------- 이 건물에 대해
const BUILDING_FACTS = [
  "{bldg}은 이 동네에서 제일 유명한 곳 중 하나예요.", "{floor}에는 {place}이(가) 있어요.", "엘리베이터는 출퇴근 시간에 진짜 붐벼요.", "{place} 쪽이 제일 사람이 많아요.",
  "이 건물 지하에 주차장이 꽤 넓어요.", "점심엔 {place} 근처가 북적여요.", "비상계단은 복도 끝마다 있어요.", "화장실은 층마다 엘리베이터 근처에 있어요.",
  "옥상 정원이 있다는 소문이 있는데 저도 아직 못 가봤어요.", "주말엔 좀 한산해요.", "로비에 안내도가 있으니까 참고하세요.", "{bldg} 처음 지었을 때보다 많이 바뀌었대요.",
  "자판기는 로비랑 복도 곳곳에 있어요.", "여기 커피는 {place} 것이 제일 맛있대요.", "층마다 분위기가 달라서 구경하는 재미가 있어요.", "건물이 커서 처음엔 다들 길을 잃어요.",
  "여기 로비 천장이 높아서 낮엔 햇빛이 예쁘게 들어와요.", "밤에 보면 건물 조명이 멋있어요.", "{bldg} 근처에 맛집이 많아요.", "{place} 앞이 사진 찍기 좋은 곳이에요.", "출입구가 여러 개라 헷갈리기 쉬워요.", "엘리베이터 버튼 두 번 누르면 취소되는 거 아세요?", "여기 직원 식당 메뉴가 꽤 괜찮대요.", "건물 안에 자판기 음료 종류가 서른 개가 넘어요."];
const HOSPITAL_FACTS = ["외래 접수는 1층 원무과에서 해요.", "검사 결과는 보통 며칠 걸려요.", "응급실은 별도 출입구가 있어요.", "약은 처방전 들고 약국으로 가시면 돼요.", "면회 시간은 정해져 있으니 확인하세요.", "병원 안에서는 뛰시면 안 돼요!", "대기 번호는 전광판에 떠요.", "보호자 대기실이 층마다 있어요.", "채혈은 공복으로 오시는 게 좋아요.", "진료 예약은 앱으로도 돼요.", "병원 주차는 진료 영수증이 있으면 할인돼요.", "휠체어는 안내 데스크에서 빌릴 수 있어요.", "외래는 오후보다 오전이 더 붐벼요."];
// ------------------------------------------------------------- 선물
const GIFT_REPLY = {
  happy: ["어머, 이걸 저한테요? 고마워요!", "와, 감동이에요! 잘 쓸게요.", "정말요? 오늘 최고의 날이에요!", "이런 거 안 주셔도 되는데… 너무 좋아요!", "평생 기억할게요, 하하.", "세상에, 제가 이거 좋아하는 거 어떻게 아셨어요?"],
  staff: ["근무 중이라 받으면 안 되는데… 마음만 감사히 받을게요. 아니, 그냥 받을게요, 하하.", "규정상 곤란하지만… 이번만이에요!", "동료들이랑 나눠 쓸게요, 감사합니다!"],
};
// ------------------------------------------------------------- 소문, 사는 얘기, 꿀팁
const RUMOR_WHO = ["3층 사무실 김 과장님이", "{place} 사장님이", "여기 보안 요원 아저씨가", "자주 오시는 할머니가", "옆 건물 카페 알바생이", "새로 온 직원이", "청소 담당 이모님이", "주차장 관리하시는 분이", "5층 회의실 단골 손님이", "매일 아침 산책하시는 할아버지가", "옆 가게 사장님 아들이", "택배 기사님이", "{bldg} 경비 반장님이"];
const RUMOR_WHAT = ["복권에 당첨됐대요!", "곧 결혼한대요.", "강아지를 입양했대요.", "마라톤 완주했대요.", "유튜브를 시작했대요.", "요리 대회에 나간대요.", "이번에 승진했대요.", "해외여행 다녀왔대요.", "밤마다 기타 연습한대요.", "드론 조종 자격증 땄대요.", "로또 3등 됐대요!", "웹툰 작가로 데뷔한대요.", "고양이 다섯 마리를 키운대요.", "김치찌개 맛집을 차린대요.", "100km 자전거 대회에 나간대요.", "노래 경연 프로그램에 나간대요.", "제주도로 이사 간대요.", "쌍둥이 아빠가 됐대요."];
const STORY_A = ["어제는요,", "지난 주말에", "오늘 아침에", "얼마 전에", "작년 이맘때"];
const STORY_B = ["버스에서 지갑을 주워서 주인 찾아줬어요.", "고양이 한 마리가 집까지 따라왔어요.", "처음으로 김치를 직접 담가 봤어요.", "한강에서 자전거를 타다가 노을을 봤어요.", "오래된 친구를 우연히 만났어요.", "요리하다가 프라이팬을 태웠어요, 하하.", "엘리베이터에 30분 갇혔어요.", "비 오는 날 우산을 세 번이나 잃어버렸어요.", "길에서 연예인을 봤어요!", "드론으로 동네를 찍어 봤는데 멋있더라고요.", "새벽에 일출 보러 산에 올라갔어요.", "아이랑 첫 캠핑을 갔어요.", "처음으로 혼자 영화관에 가봤어요.", "어릴 적 살던 동네에 가봤는데 다 바뀌었더라고요.", "할머니께 김장하는 법을 배웠어요.", "길 잃은 강아지 주인을 찾아줬어요.", "회사 체육대회에서 1등 했어요!", "베란다에서 방울토마토를 키우기 시작했어요.", "엄마랑 둘이 여행을 다녀왔어요.", "중고 자전거를 샀는데 너무 좋아요.", "밤새 퍼즐 1000피스를 맞췄어요.", "드라마 정주행하다가 아침이 됐어요."];
const STORY_C = ["재밌죠?", "인생 참 모르는 거예요.", "그쪽은 요즘 어때요?", "다음에 또 얘기해 줄게요.", "하하, 그런 날도 있는 거죠."];
const TIPS = [
  "거리 곳곳에 떨어진 코인을 모으면 게임 머니가 쌓여요.", "차고(N)에서 스포츠카를 꺼내면 오늘의 미션 속도 달성이 쉬워요.", "편의점에서 산 음료는 바로 마실 수 있어요. 캬~!",
  "집 냉장고에서 계란을 꺼내 인덕션에 가져가면 프라이를 할 수 있어요.", "직원에게 길 안내를 부탁하면 바닥에 화살표가 생겨요.", "X를 누르면 가장 가까운 건물 입구까지 안내해 줘요.",
  "Shift를 계속 누르면 전력 질주! 스태미나는 조심하세요.", "칭찬을 자주 하면 사람들이 더 친해져요.", "선물을 주면 호감도가 확 올라가요.", "J를 누르면 오늘의 미션을 접었다 펼 수 있어요.",
  "위에서 보기(T)로 집 구조를 한눈에 볼 수 있어요.", "자전거는 B, 차는 F로 탈 수 있어요.", "엘리베이터에서 다른 층도 구경해 보세요.",
  "대화를 많이 하면 오늘의 미션 보상을 받을 수 있어요.", "레벨이 오르면 화면에 LEVEL UP이 떠요!", "차를 너무 세게 박으면 내구도가 닳아요.", "점프는 Space! 계단 앞에서 해보세요.", "병원에서는 뛰지 마세요, 직원분들이 한마디 하세요.", "상점 물건 중 굿즈는 선물로 줄 수 있어요.", "소문은 친해진 사람만 알려줘요."];
const RUN_WARN = ["어머, 병원에서는 뛰시면 안 돼요!", "천천히 걸어 주세요, 위험해요!", "환자분들 계시니까 조용히 부탁드려요.", "앗, 부딪힐 뻔했어요! 천천히요.", "여기서 뛰시면 넘어지세요!", "보호자분, 천천히요!", "여기는 뛰는 곳이 아니에요!", "바닥이 미끄러워요, 걸어 주세요."];
export const runWarning = (r: () => number) => pick(r, RUN_WARN);

const fill = (t: string, c: SocialCtx) => t.replace(/\{(\w+)\}/g, (_, k: string) => k === "bldg" ? c.bldg : k === "floor" ? c.floor : k === "place" ? pick(c.rnd, c.places.length ? c.places : [c.bldg]) : "");

/** an answer to a social action, and how it changes their liking for the visitor */
export function socialAnswer(a: Social, c: SocialCtx, repeated: number): SocialAnswer {
  const r = c.rnd, staff = STAFF.has(c.role), open = openFor(r, c.affinity);
  // (the same thing asked again and again: it wears thin)
  if (repeated >= 3 && a !== "gift") return { text: pick(r, ["또요? 하하, 오늘 그 얘기만 몇 번째예요.", "음… 아까 했던 얘기 같은데요?", "다른 얘기 해요, 우리.", "그건 이제 그만~"]), delta: -3, mood: "annoyed" };
  switch (a) {
    case "greet": {
      const good = r() < 0.6 + c.affinity / 250;
      const body = staff ? pick(r, good ? GREET.staffGood : GREET.staffTired) : pick(r, good ? GREET.peerGood : GREET.peerMeh);
      return { text: `${open} ${body}`, delta: 3, mood: good ? "happy" : "neutral" };
    }
    case "joke": {
      const [q, p] = pick(r, JOKE_SET), chance = 0.35 + c.affinity / 160;
      if (staff && c.affinity < 20 && r() < 0.4) return { text: `${q} … ${pick(r, JOKE_REACT.annoyed)}`, delta: -2, mood: "annoyed" };
      const ok = r() < chance;
      return { text: `(${q} — ${p}) ${pick(r, ok ? JOKE_REACT.laugh : JOKE_REACT.groan)}`, delta: ok ? 7 : -1, mood: ok ? "happy" : "awkward" };
    }
    case "compliment": {
      const what = pick(r, COMPLIMENT_WHAT);
      if (c.affinity < 10 && r() < 0.3) return { text: `(${what}.) ${pick(r, COMPLIMENT_REPLY.awkward)}`, delta: 2, mood: "awkward" };
      return { text: `(${what}.) ${pick(r, staff && r() < 0.5 ? COMPLIMENT_REPLY.staff : COMPLIMENT_REPLY.happy)}`, delta: 6, mood: "happy" };
    }
    case "worry": {
      if (c.affinity < 25 && r() < 0.6) return { text: pick(r, WORRY_COLD), delta: -1, mood: "awkward" };
      return { text: `${pick(r, WORRY_OPEN)} ${pick(r, WORRY_ADVICE)} ${pick(r, WORRY_CLOSE)}`.trim(), delta: 5, mood: "happy" };
    }
    case "building": {
      const facts = c.kind === "clinic" || c.kind === "ward" ? [...BUILDING_FACTS, ...HOSPITAL_FACTS] : BUILDING_FACTS;
      return { text: `${open} ${fill(pick(r, facts), c)} ${r() < 0.5 ? fill(pick(r, facts), c) : ""}`.trim(), delta: 2, mood: "neutral" };
    }
    case "gift":
      return { text: `(${c.gift ?? "작은 선물"}을(를) 건넸다) ${pick(r, staff && r() < 0.5 ? GIFT_REPLY.staff : GIFT_REPLY.happy)}`, delta: 15, mood: "happy" };
    case "rumor":
      if (c.affinity < 40 && r() < 0.5) return { text: pick(r, ["소문이요? 저는 그런 거 잘 몰라요.", "글쎄요, 별다른 건 없는데요.", "남 얘기는 좀…"]), delta: 0, mood: "neutral" };
      return { text: `쉿, 이건 비밀인데요… ${fill(pick(r, RUMOR_WHO), c)} ${pick(r, RUMOR_WHAT)}`, delta: 4, mood: "happy" };
    case "story":
      return { text: `${pick(r, STORY_A)} ${pick(r, STORY_B)} ${pick(r, STORY_C)}`, delta: 4, mood: "happy" };
    case "tip":
      return { text: `${open} ${pick(r, TIPS)}`, delta: 2, mood: "neutral" };
  }
}
/** a line for ordinary talk from the new pools: a small story, a rumour, a tip, a fact of the building */
export function extraLine(r: () => number, bldg: string, floor: string, places: string[]): string {
  const c: SocialCtx = { role: "visitor", kind: "office", bldg, floor, places, affinity: 50, rnd: r };
  const k = r();
  return k < 0.3 ? `${pick(r, STORY_A)} ${pick(r, STORY_B)}` : k < 0.5 ? `${fill(pick(r, RUMOR_WHO), c)} ${pick(r, RUMOR_WHAT)}` : k < 0.7 ? pick(r, TIPS) : fill(pick(r, BUILDING_FACTS), c);
}
/** how they feel about the visitor, in words, from 0…100 */
export const affinityWord = (a: number) => a >= 85 ? "절친" : a >= 60 ? "친한 사이" : a >= 35 ? "아는 사이" : a >= 15 ? "얼굴만 아는 사이" : "처음 보는 사이";
/** how many different answers the pools can give (for the checks) */
export const answerCases = () => {
  const o = OPEN_BY_AFFINITY.reduce((t, [, l]) => t + l.length, 0);
  return o * (GREET.staffGood.length + GREET.staffTired.length + GREET.peerGood.length + GREET.peerMeh.length)
    + JOKE_SET.length * (JOKE_REACT.laugh.length + JOKE_REACT.groan.length + JOKE_REACT.annoyed.length)
    + COMPLIMENT_WHAT.length * (COMPLIMENT_REPLY.happy.length + COMPLIMENT_REPLY.staff.length + COMPLIMENT_REPLY.awkward.length)
    + WORRY_OPEN.length * WORRY_ADVICE.length * WORRY_CLOSE.length + WORRY_COLD.length
    + o * (BUILDING_FACTS.length + HOSPITAL_FACTS.length) ** 2
    + GIFT_REPLY.happy.length + GIFT_REPLY.staff.length + RUMOR_WHO.length * RUMOR_WHAT.length + STORY_A.length * STORY_B.length * STORY_C.length + o * TIPS.length + RUN_WARN.length;
};
