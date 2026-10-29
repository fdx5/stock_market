import type { FacilityKind, FacilityRole, FloorPlan } from "./plan/types";

/* What a building's people say: put together from parts — an opening by the hour and how often
 * they have been spoken to, one of many things their part talks about (with the floor's own rooms,
 * departments, shops, its name and level filled in), and a close — so the same person rarely says
 * the same thing twice and no two say the same. Each talk goes on from the last: the first a
 * greeting and a matter, the next ones further matters, then a word that they must get on. */

export interface TalkContext {
  role: FacilityRole; kind: FacilityKind; plan: FloorPlan;
  /** the room they are in (its label) and who they are (a number of their own) */
  room: string; seed: number;
  /** how many times they have been spoken to */
  turn: number; hour: number;
}

type Fill = (k: string) => string;
const pickOf = (r: () => number) => <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length) % a.length];

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- the parts every one shares
const OPEN = {
  morning: ["좋은 아침이에요.", "아침부터 오셨네요.", "안녕하세요, 오늘 일찍 오셨네요.", "아, 안녕하세요.", "네, 안녕하세요!"],
  noon: ["안녕하세요.", "점심시간이라 좀 붐비죠?", "어서 오세요.", "네, 말씀하세요.", "아 네, 안녕하세요."],
  afternoon: ["안녕하세요.", "네, 무슨 일이세요?", "오후라 조금 한가해졌어요.", "아, 네.", "반갑습니다."],
  evening: ["늦은 시간에 오셨네요.", "저녁인데도 사람이 꽤 있죠?", "안녕하세요, 곧 마감 시간이에요.", "네, 안녕하세요.", "오늘 하루 수고 많으셨어요."],
  again: ["또 오셨네요.", "아까 그분이시죠?", "네, 또 말씀하세요.", "다시 뵙네요.", "아, 아직 계셨어요?", "또 궁금한 게 있으세요?"],
  busy: ["죄송해요, 지금 좀 바빠서요.", "잠깐만요, 이것만 하고요.", "아이고, 정신이 없네요.", "말씀은 들었어요, 잠시만요."],
};
/** how those who serve close, and how the others do */
const CLOSE_STAFF = ["", "", "좋은 하루 되세요.", "천천히 둘러보세요.", "필요하시면 또 불러 주세요.", "조심히 다니세요.", "궁금한 거 있으면 물어보세요.", "도움이 됐으면 좋겠네요.", "편하게 계세요.", "다른 건 없으세요?"];
const CLOSE_PEER = ["", "", "그럼 이만.", "수고하세요~", "얘기 고마워요.", "저도 이제 가 봐야겠어요.", "좋은 하루 보내세요.", "아무튼 그래요, 하하.", "다음에 또 봬요.", "그쪽도 볼일 잘 보세요."];
const SERVES = new Set<FacilityRole>(["doctor", "nurse", "clerk", "guard", "desk", "cook", "teacher"]);
/** a counter's clerk by what the building is */
const CLERK_BY: Partial<Record<FacilityKind, string[]>> = {
  clinic: ["처음 오셨으면 접수 신청서 작성해 주세요.", "진료비 수납은 이쪽 창구예요.", "실손보험 서류는 무인 발급기에서도 뽑으실 수 있어요.", "{dept} 예약 확인해 드릴게요.", "진료 카드 있으세요?", "주차 할인은 진료 영수증 보여주시면 돼요.", "다음 예약 문자로 보내 드릴게요.", "처방전은 {pharmacy}로 가져가시면 됩니다.", "보호자분 성함도 적어 주세요.", "대기 번호 {n}번이세요.", "검사 예약은 {lab} 옆 창구에서 해요.", "진단서는 발급 수수료가 있어요."],
  ward: ["면회는 오후 6시부터 8시까지예요.", "보호자 출입증 확인할게요.", "{room} 병실은 복도 끝이에요.", "퇴원 수속은 1층 원무과에서 해요."],
  retail: ["포장해 드릴까요?", "적립 카드 있으세요?", "오늘 행사 중이라 {pct}% 할인돼요.", "교환·환불은 영수증 있으면 7일 안에 돼요.", "그 상품은 {shop}에도 있어요.", "카드 무이자 할부 돼요.", "사이즈 찾아 드릴게요, 잠시만요.", "피팅룸은 안쪽에 있어요.", "주차 2시간 무료 등록해 드릴게요.", "신상품은 이쪽에 있어요.", "선물이면 리본 묶어 드릴까요?", "이번 주말까지 사은품 행사 해요."],
  food: ["주문은 키오스크에서 해 주세요.", "진동벨 울리면 가지러 오세요.", "오늘 추천 메뉴는 {menu}예요.", "포장 가능해요.", "물은 셀프예요.", "맵기 조절 돼요."],
};
const MENU = ["김치찌개", "돈가스", "비빔밥", "칼국수", "아메리카노", "라떼", "우동", "제육볶음", "냉면", "떡볶이"];
const ENOUGH = ["이제 일 좀 해야 해서요, 다음에 또 얘기해요.", "제가 지금 가 봐야 해서요.", "오늘 얘기 많이 했네요, 하하.", "다른 분들도 기다리셔서요, 죄송해요.", "말씀 즐거웠어요. 그럼 또 봬요."];
const WEATHER = ["오늘 날씨 괜찮던데요.", "밖에 바람이 좀 부네요.", "요즘 일교차가 커요, 감기 조심하세요.", "주차장 들어오는 데 한참 걸렸어요.", "오는 길에 차가 좀 막히더라고요."];
const SMALL = [
  "여기 {bldg} 처음 오셨어요?", "{floor}은 생각보다 넓죠?", "길 잃기 쉬워요, 바닥 안내선 따라가시면 돼요.", "엘리베이터는 코어 쪽에 모여 있어요.",
  "화장실은 복도 끝마다 있어요.", "비상구 표시 초록색 불 보이시죠? 그쪽이 계단이에요.", "{place} 가 보셨어요? 거기 괜찮아요.", "요즘 {place} 쪽이 제일 붐벼요.",
];

// ---------------------------------------------------------------- each part's own matters
const TOPICS: Record<FacilityRole, string[]> = {
  doctor: [
    "어디가 불편하세요? 언제부터 그러셨는지 말씀해 주세요.", "{dept} 진료는 예약 순서대로 봐 드려요.", "검사 결과는 다음 진료 때 같이 보시죠.",
    "처방전은 {pharmacy}에서 받으시면 돼요.", "약은 식후 30분에 드시고, 물 많이 드세요.", "무리하지 마시고 일주일 정도 쉬세요.",
    "혈액검사는 {lab}에서 하시고 오세요.", "엑스레이부터 찍어 보죠. {xray}로 가시면 됩니다.", "지금은 크게 걱정하실 단계는 아니에요.",
    "증상이 계속되면 다음 주에 다시 오세요.", "오늘 외래가 많아서 {min}분 정도 지연되고 있어요.", "진료실 앞 화면에 이름이 뜨면 들어오세요.",
    "{dept}에서 협진 의뢰를 드릴게요.", "수술 날짜는 간호사가 따로 안내해 드릴 거예요.", "운동은 가볍게 걷기부터 시작하세요.",
    "짠 음식은 줄이시는 게 좋아요.", "잠은 하루 7시간 이상 주무세요.", "통증이 심해지면 응급실로 바로 오세요.",
  ],
  nurse: [
    "성함이랑 생년월일 확인할게요.", "혈압 먼저 재고 들어가실게요.", "{dept} 대기는 지금 {n}명 정도예요.", "번호 부르면 {room}으로 들어오세요.",
    "채혈은 공복이 좋아요. 오늘 아침 드셨어요?", "주사 맞으신 자리는 5분 정도 눌러 주세요.", "처음 오셨으면 {reception}에서 접수부터 하셔야 해요.",
    "검사실은 이 복도 따라가시면 {lab}이 나와요.", "보호자분은 대기석에 앉아 계세요.", "수납은 진료 끝나고 {reception}에서 하시면 돼요.",
    "예약 변경은 대표번호로 전화 주시면 돼요.", "다음 예약은 {days}일 뒤로 잡아 드릴게요.", "약 드시기 전에 알레르기 있으시면 꼭 말씀해 주세요.",
    "휠체어 필요하시면 안내 데스크에 말씀하세요.", "체온이 조금 높네요. 잠시 앉아 계세요.", "검사 전에는 물 드시면 안 돼요.",
  ],
  patient: [
    "벌써 {min}분째 기다리고 있어요.", "{dept} 진료 받으러 왔어요.", "검사 결과 들으러 왔어요, 좀 떨리네요.", "여기 대기가 늘 길어요.",
    "아까 {reception}에서 번호표 뽑았어요.", "{pharmacy}가 어디 있는지 아세요?", "약 타러 왔는데 처방전을 놓고 왔지 뭐예요.",
    "무릎이 시큰거려서요, 나이 드니 별수 없네요.", "아이 예방접종 때문에 왔어요.", "어머니 모시고 왔어요.", "오늘 수술 전 검사가 있어요.",
    "{cafe}에서 커피 한잔하고 왔어요.", "주차가 3시간까지 무료래요.", "번호가 잘 안 넘어가네요.", "여기 의자는 그래도 편하네요.",
    "다음 달에 또 와야 한대요.", "입원은 안 해도 된대서 다행이에요.", "{floor}에 편의점도 있더라고요.",
  ],
  visitor: [
    "엘리베이터가 어디 있는지 아세요?", "{place} 찾고 있어요.", "여기 처음 와 봤어요, 꽤 크네요.", "친구 만나기로 했는데 아직 안 왔네요.",
    "{floor}에 뭐가 있는지 둘러보는 중이에요.", "화장실 어디예요? 아, 저기 표시 있네요.", "{cafe} 커피 맛있대요.", "주차 정산은 어디서 해요?",
    "길이 복잡해서 두 번이나 돌았어요.", "{bldg} 생각보다 사람 많네요.", "약속 시간까지 {min}분 남았어요.", "출구가 어느 쪽이었죠?",
    "{shop} 아직 문 열었나요?", "와이파이 비밀번호 혹시 아세요?", "휴대폰 충전할 데가 있으면 좋겠는데.", "여기 자판기 음료 종류 많더라고요.",
  ],
  desk: [
    "지금 회의 자료 정리 중이에요.", "담당자는 저쪽 자리에 계세요.", "{room} 찾으세요? 복도 끝이에요.", "오늘 마감이라 정신없어요.",
    "점심 뭐 먹을지 고민 중이에요.", "프린터가 또 말썽이네요.", "회의실 예약은 사내 시스템으로 하세요.", "방문하셨으면 안내 데스크에서 출입증 받으세요.",
    "{n}시에 미팅 있어서 곧 일어나야 해요.", "탕비실에 커피 있어요, 드시고 가세요.", "이번 분기 실적 보고서 쓰는 중이에요.", "요즘 야근이 잦네요.",
  ],
  clerk: [
    "무엇을 도와드릴까요?", "번호표 뽑고 잠시만 기다려 주세요.", "{room} 위치 안내해 드릴까요?", "엘리베이터는 홀 안쪽에 있어요.",
    "신분증 준비해 주시겠어요?", "카드도 되고 현금도 돼요.", "영수증 필요하세요?", "{floor} 안내도는 입구 옆에 있어요.",
    "주차 등록해 드릴게요, 차량 번호가요?", "분실물은 안내 데스크에서 맡아 드려요.", "지금 대기 {n}번이에요.", "서류 발급은 무인 발급기에서도 돼요.",
    "{shop} 쪽으로 가시면 돼요.", "포장해 드릴까요?", "적립 카드 있으세요?", "오늘 행사 중이라 {n}% 할인돼요.",
  ],
  student: ["쉬는 시간이에요.", "다음 수업 준비 중이에요.", "시험 기간이라 바빠요.", "과제가 너무 많아요.", "{room}에서 스터디해요.", "매점 가는 길이에요.", "선생님 찾으세요? 교무실에 계실 거예요.", "방학이 언제 오려나요."],
  teacher: ["수업은 {min}분 뒤에 시작해요.", "상담은 교무실로 오세요.", "자리에 앉아 주세요.", "숙제는 다음 시간까지예요.", "학부모 상담 주간이라 바빠요.", "{room} 수업 들어가는 길이에요."],
  shopper: [
    "구경 중이에요.", "{shop} 세일한대서 왔어요.", "이거 사이즈가 있을까요?", "계산은 저쪽에서 해요.", "여기 신상 들어왔대요.",
    "선물 고르는 중인데 뭐가 좋을지 모르겠어요.", "{cafe}에서 좀 쉬었다 가려고요.", "카드 할인 되는 데가 어디죠?", "벌써 {n}시간째 쇼핑 중이에요.",
    "{floor} 매장이 제일 볼 게 많아요.", "포인트 적립하는 거 깜빡했네.", "주차 2시간 무료래요, 영수증 챙기세요.",
  ],
  guard: ["출입증 확인 부탁드립니다.", "엘리베이터는 홀 안쪽에 있습니다.", "비상구는 복도 양 끝입니다.", "분실물은 안내 데스크에 맡겨 주세요.", "{bldg}은 밤 10시에 출입이 통제됩니다.", "뛰지 마시고 천천히 다니세요.", "주차장은 지하로 내려가시면 됩니다.", "도움 필요하시면 말씀하세요."],
  cook: ["주문하신 거 곧 나와요.", "오늘의 메뉴 괜찮아요.", "어서 오세요!", "국물이 오늘 진하게 잘 우러났어요.", "잠시만요, 불 앞이라서요.", "포장도 돼요.", "{n}번 손님 음식 나왔습니다!"],
  guest: ["체크인하고 올라왔어요.", "전망이 좋네요.", "조식은 몇 시부터예요?", "수영장은 몇 층이에요?", "룸서비스 시켜 볼까 해요.", "내일 아침 일찍 체크아웃해요."],
};

/** the floor's own names for the parts' sentences */
function placesOf(plan: FloorPlan) {
  const labels = [...new Set(plan.rooms.map(r => r.label))];
  const of = (re: RegExp) => labels.filter(l => re.test(l));
  const depts = [...new Set(labels.map(l => l.match(/^(\S+과)\s/)?.[1]).filter(Boolean) as string[])];
  return {
    labels, depts,
    pharmacy: of(/약국/), cafe: of(/카페|커피|베이커리|식당|푸드/), shop: plan.rooms.filter(r => r.type === "shop").map(r => r.label),
    reception: of(/원무|접수|수납|안내/), lab: of(/채혈|검사/), xray: of(/영상|X-ray|엑스레이/),
    public: labels.filter(l => !/복도|화장실|계단|엘리베이터|창고|준비실|의국|직원/.test(l)),
  };
}

export function talk(c: TalkContext): string {
  const r = rng(c.seed * 7919 + c.turn * 104729 + 13), pick = pickOf(r), P = placesOf(c.plan), f = c.plan.facility!;
  const fill: Fill = k => {
    switch (k) {
      case "bldg": return f.name; case "floor": return f.levelLabel;
      case "dept": return P.depts.length ? pick(P.depts) : "외래";
      case "room": return c.room && !/복도/.test(c.room) ? c.room : pick(P.public.length ? P.public : ["안내 데스크"]);
      case "pharmacy": return P.pharmacy.length ? pick(P.pharmacy) : "1층 약국";
      case "cafe": return P.cafe.length ? pick(P.cafe) : "카페";
      case "shop": return P.shop.length ? pick(P.shop) : "매장";
      case "reception": return P.reception.length ? pick(P.reception) : "원무과";
      case "lab": return P.lab.length ? pick(P.lab) : "검사실";
      case "xray": return P.xray.length ? pick(P.xray) : "영상의학과";
      case "place": return pick(P.public.length ? P.public : [f.name]);
      case "min": return String(5 + Math.floor(r() * 12) * 5); case "n": return String(2 + Math.floor(r() * 14));
      case "days": return String(pick([3, 7, 10, 14, 28]));
      case "pct": return String(pick([5, 10, 15, 20, 30]));
      case "menu": return pick(MENU);
      default: return "";
    }
  };
  const fillIn = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => fill(k));
  // (a person spoken to many times has had enough)
  if (c.turn >= 6 && r() < 0.5) return pick(ENOUGH);
  const h = c.hour, open = c.turn > 0 ? pick(OPEN.again) : h < 11 ? pick(OPEN.morning) : h < 14 ? pick(OPEN.noon) : h < 18 ? pick(OPEN.afternoon) : pick(OPEN.evening);
  const busy = (c.role === "clerk" || c.role === "nurse" || c.role === "cook") && r() < 0.12 ? pick(OPEN.busy) + " " : "";
  // (their own matter mostly; now and then a word about the place or the day)
  // (a clerk's counter is the building's: a hospital's 원무과 does not sell, a store does)
  const own = c.role === "clerk" ? CLERK_BY[c.kind] : undefined;
  const pool = own ? [...own, ...TOPICS.clerk.filter(t => !/할인|포장|적립|계산/.test(t))] : (TOPICS[c.role] ?? TOPICS.visitor);
  const body = r() < 0.18 ? fillIn(pick(SMALL)) : r() < 0.08 ? pick(WEATHER) : fillIn(pick(pool));
  const second = r() < 0.35 ? " " + fillIn(pick(pool)) : "";
  const close = pick(SERVES.has(c.role) ? CLOSE_STAFF : CLOSE_PEER);
  return `${busy}${open} ${body}${second === " " + body ? "" : second}${close ? " " + close : ""}`.replace(/\s+/g, " ").trim();
}
