/* ============================================================================
   What the telescope can look at, and what it says about each of them.
   ----------------------------------------------------------------------------
   One entry per observable body. The figures are the real ones — kilometres,
   kilograms, kelvin — not the scene's units, because this panel is the one
   place on the page that talks about the actual solar system rather than the
   model of it standing in for it.

   `frame` is the exception: it IS in scene units, and it is how far back the
   camera sits expressed as a multiple of the body's drawn radius. It exists
   because "fills the view" is not one number. A bare sphere reads well at
   about six radii; a ringed planet needs room for the rings, a black hole for
   its disc, and the neutron star for an ejecta cloud that grows to many times
   the star itself. Framing all of them the same way would put Saturn's rings
   off the edge and leave the neutron star a dot in the middle of its own
   explosion.

   The descriptions are written here rather than fetched: this page has no
   business making a network call to show a caption, and a body's mass does not
   change often enough to be worth one.
   ========================================================================= */

export interface ObservableSpec {
  /** The key the SCENE knows the body by, which is not always the key
   * bodies.ts declares. A moon's pickable is registered as `host:moon` — see
   * buildMoon in scene.ts — so a plain "io" here matches nothing at all and
   * every moon on this menu would silently do nothing when tapped. */
  key: string;
  ko: string;
  en: string;
  /** Which group it sits in on the menu. */
  group: "star" | "planet" | "moon" | "exotic";
  /** Multiples of the body's drawn radius to sit back by. See the note above
   * on why this is not one constant. */
  frame: number;
  radiusKm: string;
  mass: string;
  density: string;
  temperature: string;
  description: string;
}

export const OBSERVABLES: ObservableSpec[] = [
  {
    key: "sun",
    ko: "태양",
    en: "Sun",
    group: "star",
    frame: 4.2,
    radiusKm: "696,340 km",
    mass: "1.989 × 10³⁰ kg",
    density: "1.41 g/cm³",
    temperature: "표면 5,500 °C · 중심 1,500만 °C",
    description:
      "태양계 전체 질량의 99.86%를 혼자 차지하는 항성입니다. 나머지 전부 — 여덟 행성과 모든 위성, 소행성과 혜성을 합쳐도 0.14%에 지나지 않습니다. 태양이 무거운 것이 아니라 태양계가 곧 태양이고, 행성들은 그 주위에 남은 부스러기라고 보는 편이 실제에 가깝습니다.\n\n중심부에서는 초당 약 6억 톤의 수소가 헬륨으로 바뀌며, 그 과정에서 사라진 400만 톤의 질량이 빛과 열이 됩니다. 이렇게 만들어진 에너지가 표면까지 올라오는 데는 수만 년이 걸리지만, 표면을 떠난 뒤 지구에 닿기까지는 8분 20초면 충분합니다. 지금 보고 있는 햇빛은 8분 전의 태양이고, 그 빛을 만든 반응은 훨씬 오래전에 일어났습니다.\n\n표면 온도는 5,500도 남짓인데 그 바깥의 코로나는 100만 도가 넘습니다. 불에서 멀어질수록 뜨거워지는 셈이라 오랫동안 풀리지 않은 문제였고, 자기장이 에너지를 실어 나른다는 설명이 지금은 가장 유력합니다. 앞으로 약 50억 년 뒤 수소를 모두 태우면 적색거성으로 부풀어 지구 궤도 근처까지 다가올 것으로 예측됩니다.",
  },
  {
    key: "mercury",
    ko: "수성",
    en: "Mercury",
    group: "planet",
    frame: 5.4,
    radiusKm: "2,440 km",
    mass: "3.30 × 10²³ kg",
    density: "5.43 g/cm³",
    temperature: "-173 °C ~ 427 °C",
    description:
      "태양에 가장 가깝고 가장 작은 행성입니다. 지구의 위성인 달보다 조금 클 뿐이지만, 밀도는 태양계 행성 중 지구 다음으로 높습니다. 반지름의 4분의 3이 철로 된 핵이어서, 사실상 금속 덩어리에 얇은 암석 껍질을 씌운 구조입니다. 형성 초기에 거대한 충돌로 바깥층이 벗겨져 나갔다는 설명이 유력합니다.\n\n대기가 거의 없어 열을 붙잡아 두지 못합니다. 햇빛이 닿는 낮은 427도까지 오르고 밤은 영하 173도로 떨어져, 태양계에서 하루 사이 온도 차가 가장 큰 곳입니다. 그런데도 극지방의 깊은 크레이터 바닥, 태양이 한 번도 비친 적 없는 곳에는 얼음이 남아 있는 것으로 확인됐습니다.\n\n자전과 공전이 3대 2로 묶여 있어, 두 번 공전하는 동안 세 번 자전합니다. 그 결과 수성의 하루는 수성의 1년보다 깁니다. 태양이 하늘에서 잠시 멈췄다 거꾸로 움직이는 구간도 있는데, 공전 속도가 자전 속도를 앞지르는 근일점 부근에서 일어나는 현상입니다.",
  },
  {
    key: "venus",
    ko: "금성",
    en: "Venus",
    group: "planet",
    frame: 5.4,
    radiusKm: "6,052 km",
    mass: "4.87 × 10²⁴ kg",
    density: "5.24 g/cm³",
    temperature: "평균 464 °C",
    description:
      "크기와 밀도가 지구와 가장 비슷해 오랫동안 쌍둥이 행성으로 불렸지만, 실제로는 태양계에서 가장 가혹한 곳입니다. 표면 기압은 지구의 92배로 수심 900미터의 물속과 같고, 평균 온도는 464도로 태양에 더 가까운 수성보다도 뜨겁습니다.\n\n원인은 거리가 아니라 대기입니다. 이산화탄소가 96%를 차지하는 두꺼운 대기가 들어온 열을 내보내지 않습니다. 온실효과가 끝까지 진행되면 어떻게 되는지를 보여주는 실물이라, 기후 연구에서 자주 인용됩니다. 상공에는 황산 구름이 깔려 있어 표면은 가시광선으로 볼 수 없고, 레이더로만 지도를 그릴 수 있었습니다.\n\n자전이 대단히 느리고 방향도 거꾸로입니다. 한 바퀴 도는 데 243일이 걸려 공전 주기인 225일보다 길고, 태양은 서쪽에서 떠 동쪽으로 집니다. 왜 뒤집혔는지는 확실하지 않으며, 거대 충돌설과 조석 효과로 서서히 뒤집혔다는 설이 함께 거론됩니다.",
  },
  {
    key: "earth",
    ko: "지구",
    en: "Earth",
    group: "planet",
    frame: 5.2,
    radiusKm: "6,371 km",
    mass: "5.97 × 10²⁴ kg",
    density: "5.51 g/cm³",
    temperature: "평균 15 °C",
    description:
      "태양계에서 밀도가 가장 높은 행성이며, 표면에 액체 상태의 물이 안정적으로 존재하는 유일한 곳입니다. 표면의 71%가 바다이고, 그 물이 열을 실어 나르며 기후를 완만하게 유지합니다.\n\n녹아 있는 외핵에서 흐르는 철이 자기장을 만듭니다. 이 자기장이 태양풍을 비껴 보내 대기가 우주로 벗겨지는 것을 막습니다. 화성은 이 장치를 일찍 잃었고 그래서 대기를 잃었습니다. 지구가 지금의 모습인 데는 크기나 거리 못지않게 이 자기장의 몫이 큽니다.\n\n자전축이 23.4도 기울어 있어 계절이 생깁니다. 이 기울기가 오래도록 일정하게 유지되는 것은 상대적으로 거대한 위성인 달이 붙잡아 주기 때문으로, 달이 없었다면 자전축이 크게 흔들리며 기후가 훨씬 불안정했을 것으로 추정됩니다.\n\n대기의 산소는 처음부터 있던 것이 아닙니다. 약 24억 년 전 광합성을 하는 미생물이 뿜어낸 결과이며, 당시에는 대부분의 생물에게 치명적인 오염 물질이었습니다.",
  },
  {
    key: "mars",
    ko: "화성",
    en: "Mars",
    group: "planet",
    frame: 5.4,
    radiusKm: "3,390 km",
    mass: "6.42 × 10²³ kg",
    density: "3.93 g/cm³",
    temperature: "-153 °C ~ 20 °C",
    description:
      "붉게 보이는 것은 표면을 덮은 산화철, 곧 녹 때문입니다. 지름은 지구의 절반, 질량은 10분의 1 남짓이지만 육지 면적은 지구의 대륙을 합친 것과 비슷합니다.\n\n태양계에서 가장 높은 산과 가장 큰 협곡이 모두 여기 있습니다. 올림푸스 몬스는 높이 약 22km로 에베레스트의 두 배가 넘고, 마리네리스 협곡은 길이 4,000km에 이릅니다. 판이 움직이지 않아 화산이 한자리에서 계속 쌓인 결과입니다.\n\n한때는 강과 호수, 어쩌면 바다가 있었습니다. 물이 흐른 자국과 물속에서만 만들어지는 광물이 여러 곳에서 확인됐습니다. 그러나 핵이 식으며 자기장을 잃었고, 태양풍이 대기를 벗겨내면서 물은 우주로 달아나거나 지하와 극관에 얼음으로 갇혔습니다. 지금 남은 대기는 지구의 1% 미만이라 액체 상태의 물이 표면에 머물 수 없습니다.\n\n하루 길이는 24시간 37분으로 지구와 거의 같고, 자전축 기울기도 25도로 비슷해 계절이 있습니다.",
  },
  {
    key: "jupiter",
    ko: "목성",
    en: "Jupiter",
    group: "planet",
    frame: 5.0,
    radiusKm: "69,911 km",
    mass: "1.90 × 10²⁷ kg",
    density: "1.33 g/cm³",
    temperature: "구름 상층 -145 °C",
    description:
      "나머지 일곱 행성을 모두 합친 것보다 2.5배 무거운 행성입니다. 부피로는 지구 1,300개가 들어갑니다. 그런데도 밀도는 물의 1.3배에 지나지 않는데, 대부분이 수소와 헬륨이기 때문입니다.\n\n디딜 표면이 없습니다. 아래로 내려갈수록 기체가 서서히 짙어지다 액체가 되고, 더 깊은 곳에서는 수소가 압력에 눌려 금속처럼 전기를 통하게 됩니다. 이 금속성 수소층의 흐름이 태양계에서 가장 강한 행성 자기장을 만들며, 그 세기는 지구의 2만 배에 이릅니다.\n\n대적점은 최소 190년 넘게 관측된 거대한 폭풍으로, 한때 지구 세 개가 들어갈 크기였으나 최근 100년 사이 눈에 띄게 줄고 있습니다. 자전 주기는 10시간이 채 되지 않아 태양계에서 가장 빠르며, 그 원심력에 적도가 눈에 띄게 부풀어 있습니다.\n\n95개가 넘는 위성을 거느리고, 강한 중력으로 안쪽 궤도로 향하던 혜성과 소행성의 상당수를 대신 받아냅니다.",
  },
  {
    key: "saturn",
    ko: "토성",
    en: "Saturn",
    group: "planet",
    // The rings reach well past the disc — framed on the body alone they would
    // run off both edges of the screen.
    frame: 7.6,
    radiusKm: "58,232 km",
    mass: "5.68 × 10²⁶ kg",
    density: "0.687 g/cm³",
    temperature: "구름 상층 -178 °C",
    description:
      "밀도가 물보다 낮은 유일한 행성입니다. 충분히 큰 바다가 있다면 뜬다는 비유가 자주 쓰이는데, 실제로는 그만한 물에 닿기 전에 자기 중력으로 무너집니다.\n\n고리는 거의 전부 얼음 조각입니다. 크기는 모래알에서 집채만 한 덩어리까지 다양하고, 폭은 지구에서 달까지 거리보다 넓은 데 비해 두께는 대체로 10미터에서 수십 미터에 지나지 않습니다. 종이 한 장을 축구장만큼 펼친 셈입니다. 부서진 위성이나 미처 뭉치지 못한 물질이 기원으로 추정되며, 나이는 태양계보다 훨씬 젊은 1억 년 안팎일 가능성이 제기됐습니다. 고리는 지금도 토성으로 떨어지고 있어 영원하지 않습니다.\n\n북극에는 각 변이 뚜렷한 육각형 제트기류가 자리 잡고 있습니다. 폭이 3만 km에 이르며 수십 년째 형태를 유지하고 있는데, 왜 육각형인지는 유체역학 실험으로 재현은 되지만 완전히 설명되지는 않았습니다.",
  },
  {
    key: "uranus",
    ko: "천왕성",
    en: "Uranus",
    group: "planet",
    frame: 5.6,
    radiusKm: "25,362 km",
    mass: "8.68 × 10²⁵ kg",
    density: "1.27 g/cm³",
    temperature: "-224 °C",
    description:
      "자전축이 98도 기울어 사실상 누워서 구르는 행성입니다. 극이 번갈아 태양을 정면으로 향하기 때문에, 한쪽 극은 42년 동안 낮이 이어지고 다음 42년은 밤이 이어집니다. 형성 초기에 지구만 한 천체와 충돌해 쓰러졌다는 설명이 유력합니다.\n\n태양계에서 가장 추운 대기를 가졌습니다. 최저 영하 224도로, 태양에서 더 먼 해왕성보다도 차갑습니다. 다른 거대 행성들이 내부에서 받는 만큼 이상의 열을 내보내는 것과 달리 천왕성은 그렇지 않은데, 충돌로 내부 열이 빠져나갔기 때문이라는 추정이 있습니다.\n\n청록색은 대기 중 메탄이 붉은빛을 흡수하고 푸른빛을 되돌려 보내기 때문입니다. 수소와 헬륨 아래에는 물과 암모니아, 메탄이 뜨겁고 짙은 상태로 섞인 층이 있어 얼음 거대 행성으로 분류됩니다.\n\n1781년 윌리엄 허셜이 발견했으며, 망원경으로 찾아낸 최초의 행성입니다. 그전까지 인류가 아는 태양계는 토성에서 끝나 있었습니다.",
  },
  {
    key: "neptune",
    ko: "해왕성",
    en: "Neptune",
    group: "planet",
    frame: 5.6,
    radiusKm: "24,622 km",
    mass: "1.02 × 10²⁶ kg",
    density: "1.64 g/cm³",
    temperature: "-214 °C",
    description:
      "태양계에서 가장 바깥에 있는 행성이며, 눈이 아니라 계산으로 먼저 찾아낸 천체입니다. 천왕성의 궤도가 예측과 어긋나는 것을 보고 바깥에 다른 행성이 있으리라 추정해 위치를 계산했고, 1846년 그 좌표를 겨눈 망원경이 하룻밤 만에 실제로 발견했습니다.\n\n바람이 가장 빠릅니다. 초속 600m에 육박해 음속을 넘나드는데, 태양빛이 지구의 900분의 1밖에 닿지 않는 곳에서 이만한 에너지가 어디서 오는지는 아직 분명하지 않습니다. 내부에서 받는 열이 태양에서 받는 것보다 많다는 점이 단서로 꼽힙니다.\n\n깊은 곳은 압력이 극단적이어서 메탄이 분해되며 탄소가 다이아몬드로 굳어 가라앉는다는 이론이 있고, 실험실에서 비슷한 조건을 만들어 재현에 성공했습니다.\n\n태양을 한 바퀴 도는 데 165년이 걸립니다. 발견된 뒤 제자리로 돌아온 것은 2011년이 처음이었습니다.",
  },

  {
    key: "mars:phobos",
    ko: "포보스",
    en: "Phobos",
    group: "moon",
    frame: 5.4,
    radiusKm: "11.3 km (평균)",
    mass: "1.06 × 10¹⁶ kg",
    density: "1.88 g/cm³",
    temperature: "-4 °C ~ -112 °C",
    description:
      "화성의 두 위성 중 큰 쪽이며, 태양계에서 모행성에 가장 가까이 붙어 도는 위성입니다. 화성 표면에서 겨우 6,000km 위를 지나는데, 이는 지구와 달 사이 거리의 60분의 1에 지나지 않습니다.\n\n너무 가까워서 화성의 자전보다 빠르게 공전합니다. 7시간 39분이면 한 바퀴를 도는 반면 화성의 하루는 24시간이 넘습니다. 그래서 화성에서 보면 포보스는 서쪽에서 떠서 동쪽으로 지고, 하루에 두 번 하늘을 가로지릅니다. 태양계에서 이런 위성은 포보스뿐입니다.\n\n구형이 아닙니다. 자체 중력으로 둥글어지기에는 너무 작아 27×22×18km의 감자 모양이고, 표면 중력은 지구의 1,800분의 1 수준입니다. 사람이 가볍게 뛰면 궤도에 오를 정도입니다.\n\n한쪽 면을 차지한 스티크니 크레이터는 지름 9km로 포보스 자체 크기의 절반에 가깝습니다. 이 충돌이 조금만 더 셌다면 위성은 부서졌을 것입니다.\n\n밀도가 낮고 표면이 매우 어두워 소행성대에서 붙잡힌 천체라는 설이 오래 유력했으나, 궤도가 너무 원에 가깝고 적도면에 놓여 있어 화성 충돌의 파편이 뭉쳤다는 설도 함께 거론됩니다.\n\n조석 때문에 매년 약 2cm씩 화성에 가까워지고 있어, 3천만~5천만 년 뒤에는 부서져 고리가 되거나 화성에 떨어질 것으로 예측됩니다.",
  },
  {
    key: "earth:moon",
    ko: "달",
    en: "Moon",
    group: "moon",
    frame: 5.2,
    radiusKm: "1,737 km",
    mass: "7.35 × 10²² kg",
    density: "3.34 g/cm³",
    temperature: "-173 °C ~ 127 °C",
    description:
      "모행성 대비 크기로는 태양계에서 가장 큰 위성입니다. 지구 지름의 4분의 1이 넘어, 지구-달을 이중 행성으로 보아야 한다는 주장이 나올 정도입니다.\n\n약 45억 년 전 화성만 한 천체가 지구에 비스듬히 충돌하며 튀어나온 파편이 뭉쳐 만들어졌다는 설명이 가장 널리 받아들여집니다. 달 암석의 산소 동위원소 조성이 지구와 거의 같다는 점이 강력한 근거입니다.\n\n조석 고정으로 자전과 공전 주기가 같아 항상 같은 면만 보여줍니다. 반대편은 1959년 탐사선이 사진을 보내오기 전까지 누구도 본 적이 없었고, 실제로 보니 앞면과 달리 어두운 바다가 거의 없는 크레이터투성이였습니다.\n\n지구의 자전축 기울기를 안정시켜 기후를 완만하게 유지하는 역할을 합니다. 매년 약 3.8cm씩 멀어지고 있으며, 그만큼 지구의 자전은 느려져 하루가 조금씩 길어지고 있습니다.",
  },
  {
    key: "jupiter:io",
    ko: "이오",
    en: "Io",
    group: "moon",
    frame: 5.4,
    radiusKm: "1,822 km",
    mass: "8.93 × 10²² kg",
    density: "3.53 g/cm³",
    temperature: "평균 -143 °C · 화산 1,600 °C",
    description:
      "태양계에서 화산 활동이 가장 활발한 천체입니다. 400개가 넘는 활화산이 있고, 분출물이 500km 상공까지 솟구칩니다. 표면은 유황과 이산화황으로 덮여 노랑과 주황, 검정이 뒤섞인 독특한 색을 띱니다.\n\n열의 원천은 내부의 방사성 붕괴가 아니라 조석입니다. 목성의 막대한 중력과 이웃한 유로파·가니메데의 궤도 공명이 이오를 끊임없이 다른 방향으로 잡아당겨, 고체인 표면이 100미터 가까이 오르내립니다. 이 반복되는 변형이 마찰열을 만들어 내부를 녹입니다.\n\n분출된 물질이 계속 표면을 새로 덮기 때문에 충돌 크레이터가 거의 남아 있지 않습니다. 태양계에서 가장 젊은 표면을 가진 축에 듭니다.\n\n이오에서 빠져나간 이온이 목성 주위에 도넛 모양의 플라스마 고리를 이루고, 이것이 목성 자기권을 뒤흔들며 강력한 전파를 만들어냅니다.",
  },
  {
    key: "jupiter:europa",
    ko: "유로파",
    en: "Europa",
    group: "moon",
    frame: 5.4,
    radiusKm: "1,561 km",
    mass: "4.80 × 10²² kg",
    density: "3.01 g/cm³",
    temperature: "-160 °C",
    description:
      "얼음 껍질 아래 액체 상태의 바다가 있을 것으로 보는 대표적인 천체입니다. 표면은 태양계에서 가장 매끄러운 축에 들고, 높은 지형이 거의 없이 갈라진 붉은 줄무늬가 얽혀 있습니다. 이 균열은 얼음판이 조석으로 밀리고 벌어진 흔적으로 해석됩니다.\n\n바다의 깊이는 60~150km로 추정되며, 그렇다면 지구의 모든 바닷물을 합친 것보다 많은 물이 있습니다. 열은 이오와 마찬가지로 목성의 조석에서 옵니다. 물과 열, 그리고 암석 바닥과 닿는 화학 반응이 함께 갖춰질 수 있어 생명 가능성을 논할 때 가장 자주 거론됩니다.\n\n허블 우주망원경은 남극 부근에서 200km 높이로 솟는 수증기 기둥으로 보이는 현상을 여러 차례 포착했습니다. 사실이라면 얼음을 뚫지 않고도 바닷물을 채집할 수 있다는 뜻이라, 탐사 계획에서 중요하게 다뤄지고 있습니다.",
  },
  {
    key: "jupiter:ganymede",
    ko: "가니메데",
    en: "Ganymede",
    group: "moon",
    frame: 5.3,
    radiusKm: "2,634 km",
    mass: "1.48 × 10²³ kg",
    density: "1.94 g/cm³",
    temperature: "-163 °C",
    description:
      "태양계에서 가장 큰 위성입니다. 수성보다 크지만 질량은 절반이 되지 않는데, 절반가량이 얼음이기 때문입니다.\n\n위성 중 유일하게 자체 자기장을 가지고 있습니다. 녹은 철 핵이 만들어내는 것으로 보이며, 그 덕분에 극지방에서 오로라가 관측됩니다. 이 오로라가 흔들리는 방식을 분석해 지하 250km 아래에 짠 바다가 있다는 증거를 얻었습니다.\n\n표면은 두 종류로 나뉩니다. 어둡고 크레이터가 빽빽한 오래된 지역과, 밝고 홈이 파인 젊은 지역이 뚜렷하게 갈립니다. 젊은 지역은 지각이 벌어지며 새 얼음이 올라온 흔적으로 해석됩니다.\n\n1610년 갈릴레이가 목성 주위를 도는 네 점을 발견했을 때 그중 하나였습니다. 지구가 모든 것의 중심이 아니라는 사실을 눈으로 확인시켜 준 관측이었습니다.",
  },
  {
    key: "jupiter:callisto",
    ko: "칼리스토",
    en: "Callisto",
    group: "moon",
    frame: 5.3,
    radiusKm: "2,410 km",
    mass: "1.08 × 10²³ kg",
    density: "1.83 g/cm³",
    temperature: "-139 °C",
    description:
      "태양계에서 충돌 크레이터가 가장 빽빽한 천체입니다. 표면 어디를 봐도 크레이터가 겹쳐 있어, 더 이상 새 크레이터가 들어설 자리가 없는 포화 상태에 이르렀습니다. 40억 년 넘게 지질 활동이 거의 없었다는 뜻이라, 태양계 초기의 모습을 그대로 간직한 표본으로 다뤄집니다.\n\n갈릴레이 위성 넷 중 가장 바깥에 있어 목성의 조석을 거의 받지 않습니다. 이오와 유로파를 뜨겁게 데우는 힘이 여기까지는 미치지 않아, 내부가 식은 채로 남았습니다. 같은 시기에 같은 행성 주위에서 만들어진 위성들의 운명이 거리 하나로 갈린 사례입니다.\n\n그럼에도 지하 100km 아래에 바다가 있을 가능성이 자기장 측정에서 제기됐습니다.\n\n목성의 강한 방사선대 바깥에 있어, 유인 탐사 기지 후보로 진지하게 검토되는 몇 안 되는 외행성계 천체입니다.",
  },
  {
    key: "saturn:mimas",
    ko: "미마스",
    en: "Mimas",
    group: "moon",
    frame: 5.6,
    radiusKm: "198 km",
    mass: "3.75 × 10¹⁹ kg",
    density: "1.15 g/cm³",
    temperature: "-200 °C",
    description:
      "지름 400km 남짓한 작은 얼음 위성이지만, 자기 몸 지름의 3분의 1에 이르는 거대한 크레이터를 정면에 달고 있습니다. 허셜 크레이터라 불리며 폭이 130km, 벽 높이가 5km에 이릅니다. 이 하나 때문에 미마스는 태양계에서 가장 알아보기 쉬운 천체 중 하나가 됐습니다.\n\n이만한 충돌이면 천체가 부서졌어야 한다는 점에서, 미마스는 자기 자신이 견딜 수 있는 한계 바로 앞까지 갔던 셈입니다. 반대편 표면에는 충격파가 지나가며 생긴 것으로 보이는 균열이 남아 있습니다.\n\n중력에 의해 둥근 모양을 유지하는 천체 가운데 가장 작은 축에 듭니다.\n\n최근 회전의 미세한 흔들림을 분석한 결과, 얼음 껍질 아래 비교적 최근에 생긴 바다가 있을 가능성이 제기됐습니다. 표면에 아무런 활동 흔적이 없는 천체라 예상 밖의 결과였습니다.",
  },
  {
    key: "saturn:enceladus",
    ko: "엔셀라두스",
    en: "Enceladus",
    group: "moon",
    frame: 5.6,
    radiusKm: "252 km",
    mass: "1.08 × 10²⁰ kg",
    density: "1.61 g/cm³",
    temperature: "-201 °C",
    description:
      "지름 500km에 지나지 않는 작은 위성이지만, 남극에서 물기둥을 우주로 뿜어내고 있습니다. 카시니 탐사선이 이 기둥 속을 직접 통과하며 성분을 측정했고, 물과 소금, 실리카 입자, 그리고 여러 유기 분자가 확인됐습니다.\n\n실리카 입자는 90도 이상의 물이 암석과 반응해야 만들어집니다. 얼음 아래 바다가 바닥의 암석과 닿아 있고 그곳에 열수 활동이 있다는 뜻으로, 지구 심해 열수구에서 생명이 시작됐다는 가설과 겹칩니다. 생명이 존재할 조건을 가장 구체적으로 확인한 천체입니다.\n\n뿜어낸 얼음 알갱이는 토성의 E 고리를 채웁니다. 위성 하나가 행성의 고리 하나를 계속 만들어내고 있는 셈입니다.\n\n표면은 갓 내린 눈처럼 반사율이 거의 1에 가까워 태양계에서 가장 밝습니다. 햇빛을 거의 다 되돌려 보내기 때문에 그만큼 차갑기도 합니다.",
  },
  {
    key: "saturn:titan",
    ko: "타이탄",
    en: "Titan",
    group: "moon",
    frame: 5.3,
    radiusKm: "2,575 km",
    mass: "1.35 × 10²³ kg",
    density: "1.88 g/cm³",
    temperature: "-179 °C",
    description:
      "두꺼운 대기를 가진 유일한 위성입니다. 표면 기압이 지구의 1.45배로 오히려 더 높고, 대기의 대부분은 질소입니다. 이 점에서 태양계에서 지구와 가장 닮은 대기를 가졌습니다.\n\n영하 179도에서는 메탄이 물처럼 행동합니다. 구름이 되어 비로 내리고, 강을 이루어 흐르고, 호수와 바다에 고입니다. 북극 부근의 크라켄 마레는 카스피해보다 넓습니다. 지구 밖에서 표면에 안정적인 액체가 흐르는 곳은 여기가 유일합니다.\n\n두꺼운 주황색 안개가 표면을 가려 오랫동안 아무것도 보지 못했습니다. 2005년 하위헌스 탐사선이 대기를 뚫고 내려가 착륙에 성공하면서 자갈이 깔린 강바닥 같은 지형이 처음 드러났습니다.\n\n대기에서 복잡한 유기 분자가 계속 만들어지고 있어, 생명이 시작되기 전 지구의 화학 환경을 관찰할 수 있는 실험실로 여겨집니다.",
  },
  {
    key: "uranus:titania",
    ko: "티타니아",
    en: "Titania",
    group: "moon",
    frame: 5.4,
    radiusKm: "789 km",
    mass: "3.40 × 10²¹ kg",
    density: "1.71 g/cm³",
    temperature: "-203 °C",
    description:
      "천왕성의 위성 중 가장 큽니다. 얼음과 암석이 거의 반씩 섞여 있으며, 표면에는 길이 1,500km에 이르는 거대한 협곡과 단층이 뻗어 있습니다. 내부의 물이 얼며 부피가 늘어 지각이 갈라진 흔적으로 해석됩니다.\n\n크레이터는 있지만 칼리스토처럼 포화 상태는 아닙니다. 형성 이후 어느 시점에 지질 활동이 표면을 한 차례 다시 덮었다는 뜻입니다.\n\n1787년 천왕성을 발견한 윌리엄 허셜이 함께 찾아냈습니다. 이름은 셰익스피어 희곡의 요정 여왕에서 왔는데, 천왕성 위성들만은 신화가 아니라 셰익스피어와 포프의 작품에서 이름을 따오는 전통이 있습니다.\n\n인류가 가까이서 본 것은 1986년 보이저 2호가 스쳐 지나간 단 한 번뿐이며, 그때 촬영된 것은 남반구 절반뿐입니다. 나머지 절반은 아직 아무도 보지 못했습니다.",
  },
  {
    key: "neptune:triton",
    ko: "트리톤",
    en: "Triton",
    group: "moon",
    frame: 5.4,
    radiusKm: "1,353 km",
    mass: "2.14 × 10²² kg",
    density: "2.06 g/cm³",
    temperature: "-235 °C",
    description:
      "큰 위성 가운데 유일하게 모행성의 자전과 반대 방향으로 돕니다. 이 역행 궤도는 트리톤이 해왕성과 함께 만들어진 것이 아니라, 카이퍼 벨트를 떠돌다 붙잡힌 천체라는 강력한 증거입니다. 명왕성과 크기도 조성도 비슷합니다.\n\n표면 온도는 영하 235도로 태양계에서 측정된 것 중 가장 낮은 축에 듭니다. 그런데도 활동이 멈추지 않아, 질소 가스가 8km 높이까지 솟구치는 간헐천이 보이저 2호에 포착됐습니다. 얇은 얼음층 아래에 갇힌 질소가 약한 햇빛에 데워져 터져 나오는 것으로 설명됩니다.\n\n남반구는 갓 얼어붙은 질소로 덮여 밝고, 적도 부근에는 멜론 껍질처럼 갈라진 독특한 지형이 펼쳐져 있습니다.\n\n역행 궤도는 조석 때문에 조금씩 안쪽으로 감기고 있어, 수십억 년 뒤에는 해왕성에 너무 가까워져 부서지고 고리가 될 것으로 예측됩니다.",
  },

  {
    key: "neutron",
    ko: "중성자별",
    en: "Neutron star",
    group: "exotic",
    // Framed for the merger's ejecta cloud, not for the star. The remnant is a
    // point and the cloud around it grows past two hundred units; framed on the
    // star alone the camera sits inside its own explosion.
    frame: 26,
    radiusKm: "약 10~12 km",
    mass: "태양 질량의 1.4~2.3배",
    density: "약 3.7 × 10¹⁷ kg/m³",
    temperature: "표면 약 60만 °C",
    description:
      "태양보다 훨씬 무거운 별이 연료를 다 태우고 초신성으로 폭발한 뒤, 중심에 남은 핵이 자기 중력으로 무너져 만들어집니다. 전자가 원자핵 속으로 밀려 들어가 양성자와 합쳐지면서 거의 전부 중성자만 남습니다.\n\n서울시 정도 크기에 태양보다 무거운 질량이 들어차 있습니다. 각설탕 한 개 부피가 지구 전체 인류의 무게와 비슷합니다. 표면 중력은 지구의 1,000억 배가 넘어, 1미터 높이에서 떨어진 물체가 바닥에 닿을 때 초속 수천 km에 이릅니다.\n\n무너지면서 각운동량이 보존되어 대단히 빠르게 회전합니다. 초당 수백 바퀴를 도는 것도 있습니다. 자기장은 지구의 1조 배에 달하고, 자기축을 따라 좁은 전파 빔이 뿜어져 나옵니다. 이 빔이 등대처럼 지구를 스칠 때마다 규칙적인 신호로 관측되며, 그렇게 보이는 중성자별을 펄서라고 부릅니다.\n\n두 개가 서로 돌다 합쳐지면 중력파가 발생하고, 그 충돌에서 금과 백금 같은 무거운 원소가 만들어집니다.",
  },
  {
    key: "blackhole",
    ko: "블랙홀",
    en: "Black hole",
    group: "exotic",
    // The disc reaches 5.2 horizon radii; framed on the horizon the disc would
    // spill off every edge.
    frame: 11,
    radiusKm: "사건의 지평선 — 질량에 비례",
    mass: "항성질량 태양의 3~수십 배",
    density: "정의되지 않음 (특이점)",
    temperature: "강착원반 최대 수백만 °C",
    description:
      "중력이 너무 강해 빛조차 빠져나올 수 없는 영역입니다. 되돌아올 수 없는 경계를 사건의 지평선이라 부르며, 그 안에서 일어나는 일은 바깥에 어떤 정보도 전하지 못합니다.\n\n블랙홀 자체는 빛을 내지 않습니다. 우리가 보는 것은 빨려 들어가는 물질입니다. 가스가 나선을 그리며 떨어지는 동안 마찰로 수백만 도까지 달아올라 X선을 뿜어내고, 이 강착원반이 블랙홀의 위치를 알려줍니다.\n\n가까이 다가가면 머리와 발에 걸리는 중력 차이가 몸을 세로로 길게 늘이는데, 이를 스파게티화라고 부릅니다.\n\n시간도 휘어집니다. 지평선에 가까울수록 바깥에서 볼 때 시간이 느리게 흐르며, 떨어지는 물체는 지평선에 영영 닿지 않는 것처럼 보이다 붉게 흐려지며 사라집니다.\n\n2019년 사건의 지평선 망원경이 M87 은하 중심의 블랙홀 그림자를 처음으로 촬영했고, 이론이 예측한 고리 모양과 일치했습니다.",
  },
];

/** Menu order, and the headings the list is broken up by. Grouped because a
 * flat list of twenty-two names is a wall; grouped, it is four short lists. */
export const OBSERVABLE_GROUPS: { key: ObservableSpec["group"]; ko: string; en: string }[] = [
  { key: "star", ko: "항성", en: "Star" },
  { key: "planet", ko: "행성", en: "Planets" },
  { key: "moon", ko: "위성", en: "Moons" },
  { key: "exotic", ko: "심우주", en: "Deep sky" },
];

export function observableOf(key: string): ObservableSpec | undefined {
  return OBSERVABLES.find((o) => o.key === key);
}

/** The planet a moon belongs to, or undefined for anything that is not one.
 *
 * Read off the key rather than stored beside it. A moon's key already carries
 * its host — `jupiter:io` — and every host is itself on this list, so the name
 * is one lookup away in whichever language is being shown. Writing it out per
 * entry would mean a Korean field and an English field kept in step by hand
 * with the planet's own names, which is three places to change a name in. */
export function hostOf(spec: ObservableSpec): ObservableSpec | undefined {
  const [host, moon] = spec.key.split(":");
  if (!moon) return undefined;
  return OBSERVABLES.find((o) => o.key === host);
}
