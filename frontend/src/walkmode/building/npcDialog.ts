import type { Role } from "./crowd";

/** what a person says, by who they are, where they stand and when: each person their own words
 * (picked by their id), the place's own facts filled in — departments, waits, the nearest toilet */
export interface TalkContext { id: number; hour: number; medical: boolean; zone: string; floor: string; depts: string[]; shops: string[]; waiting: number }
const pick = <T,>(list: T[], id: number, salt = 0) => list[Math.abs((id * 2654435761 + salt * 97) | 0) % list.length];

export function dialogFor(role: Role, medical: boolean, c?: TalkContext) {
  const id = c?.id ?? 0, h = c?.hour ?? 12;
  const greet = h < 11 ? "좋은 아침입니다." : h < 14 ? "안녕하세요, 점심시간이라 조금 붐비네요." : h < 18 ? "안녕하세요." : "늦은 시간에 오셨네요.";
  const dept = c?.depts.length ? pick(c.depts, id, 3) : "";
  const zone = c?.zone && !/^로비$/.test(c.zone) ? c.zone : "";
  switch (role) {
    case "doctor": return { text: pick([
      `${zone ? `${zone} 담당입니다. ` : ""}진료는 접수 순서대로 진행돼요. 문 옆 화면에 이름이 뜨면 들어오시면 됩니다.`,
      `오늘 ${dept || "외래"} 예약이 많아서 조금 지연되고 있어요. 검사 결과는 진료실에서 설명드릴게요.`,
      `${greet} 검사가 필요하면 처방 후 검사실로 안내해 드립니다.`], id) };
    case "nurse": return { text: pick([
      `${zone || "이 구역"} 간호사입니다. 접수하셨으면 대기석에 앉아 계세요. 지금 대기는 ${Math.max(1, (c?.waiting ?? 6) % 9)}명 정도예요.`,
      `혈압을 먼저 재고 진료실로 들어가실게요. 처음 오셨으면 원무과에서 접수부터 하셔야 해요.`,
      `${greet} 채혈은 공복이 좋아요. 검사실 위치를 안내해 드릴까요?`], id) };
    case "patient": return { text: pick([
      `벌써 ${20 + (id % 4) * 10}분째 기다리고 있어요. ${dept ? `${dept}는 늘 이렇게 붐비네요.` : ""}`,
      "번호표 뽑고 기다리는 중이에요. 원무과 화면에 번호가 뜨면 창구로 가면 된대요.",
      "검사 결과 들으러 왔어요. 접수는 1층 원무과에서 했어요.",
      "여기 처음 와서 길을 잃었어요. 안내 데스크에 물어보세요."], id) };
    case "staff": return { text: pick([
      `${greet} ${medical ? "원내 안내 직원입니다. 무엇을 도와드릴까요? 아래에서 물어보실 내용을 고르세요." : "안내 직원입니다. 매장·시설 위치를 물어보세요."}`,
      `${c?.floor ?? ""} 안내입니다. ${medical ? `오늘 원무과 대기는 약 ${c?.waiting ?? 8}명이에요. 번호표는 원무과 앞 키오스크에서 뽑으세요.` : "찾으시는 곳을 아래에서 골라 주세요."}`,
      `${medical ? "진료과, 접수, 화장실, 편의시설 위치를 안내해 드려요." : `${c?.shops.slice(0, 2).join(", ") || "매장"} 등 이 층 시설을 안내해 드려요.`}`], id) };
    case "worker": return { text: pick(["이 층에서 근무하고 있습니다. 회의실이나 탕비실 찾으세요?", "점심 먹고 들어가는 길이에요. 엘리베이터는 코어 쪽에 있어요.", `${greet} 방문증은 1층 안내데스크에서 받으세요.`], id) };
    case "shopper": return { text: pick([`${c?.shops.length ? `${pick(c.shops, id, 5)} 들렀다 가는 길이에요.` : "매장 구경하고 있어요."}`, "세일한다고 해서 왔는데 사람이 많네요.", "화장실이 어디 있는지 아세요? 저도 찾고 있었어요."], id) };
    case "diner": return { text: pick(["점심 먹으러 왔어요. 여기 푸드코트 괜찮아요.", "커피 한잔하고 있어요. 카페는 이 층에도 있어요.", "줄이 길어서 다른 데 갈까 고민 중이에요."], id) };
    default: return { text: pick([`${greet} 이 층 공용시설과 출입구를 확인해 보시겠어요?`, "저도 방문객이라 잘 몰라요. 안내 직원에게 물어보세요."], id) };
  }
}
