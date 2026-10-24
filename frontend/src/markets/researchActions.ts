export const RESEARCH_ACTIONS = {
  search_open: "종목 검색 열기", search_empty: "검색 결과 없음", search_error: "검색 수신 실패",
  symbol_select: "검색 종목 선택", symbol_apply: "종목 조건 적용", filter_change: "조회 조건 변경",
  control_use: "분석 도구 사용", assumption_change: "가정 입력 변경", source_open: "근거 원문 열기",
  related_open: "관련 페이지 이동", import_local: "로컬 자료 가져오기", export_csv: "CSV 다운로드",
  print_brief: "인쇄·PDF", snapshot_record: "공개 표본 기록", copy_link: "조회 링크 복사",
} as const;
export type ResearchAction = keyof typeof RESEARCH_ACTIONS;
