import type {
  CompanyCatalog,
  CatalogCategory,
  CatalogItem,
} from "@/contracts/company";

/**
 * 제공하는 아이템과 확장. 모두 처음부터 사용할 수 있다(해금 조건 없음).
 * 목록은 제안 초안이며 실제 에셋이 정해지면 화면 담당과 함께 바꾼다.
 */
const ITEMS: CatalogItem[] = [
  { id: "body-1", category: "BODY", name: "기본 체형 1" },
  { id: "body-2", category: "BODY", name: "기본 체형 2" },
  { id: "body-3", category: "BODY", name: "기본 체형 3" },
  { id: "hair-short", category: "HAIR", name: "짧은 머리" },
  { id: "hair-long", category: "HAIR", name: "긴 머리" },
  { id: "hair-bob", category: "HAIR", name: "단발" },
  { id: "hair-curly", category: "HAIR", name: "볼륨 머리" },
  { id: "outfit-jacket", category: "OUTFIT", name: "재킷" },
  { id: "outfit-cardigan", category: "OUTFIT", name: "카디건" },
  { id: "outfit-apron", category: "OUTFIT", name: "작업 앞치마" },
  { id: "outfit-hoodie", category: "OUTFIT", name: "후드" },
  { id: "headset", category: "ACCESSORY", name: "헤드셋" },
  { id: "glasses", category: "ACCESSORY", name: "안경" },
  { id: "pencil", category: "ACCESSORY", name: "연필" },
  { id: "beret", category: "ACCESSORY", name: "베레모" },
  { id: "headphones", category: "ACCESSORY", name: "헤드폰" },
  { id: "desk", category: "FURNITURE", name: "책상" },
  { id: "bookshelf", category: "FURNITURE", name: "책장" },
  { id: "plant", category: "DECOR", name: "화분" },
  { id: "window-poster", category: "DECOR", name: "창가 포스터" },
  { id: "meeting-table", category: "MEETING", name: "회의 탁자" },
  { id: "meeting-chair", category: "MEETING", name: "회의 의자" },
  { id: "whiteboard", category: "MEETING", name: "화이트보드" },
];

export const CATALOG: CompanyCatalog = {
  items: ITEMS,
  expansions: [
    { level: 0, name: "기본 사무실" },
    { level: 1, name: "넓은 사무실" },
    { level: 2, name: "2층 사무실" },
    { level: 3, name: "사옥" },
  ],
};

export function idsOf(category: CatalogCategory): Set<string> {
  return new Set(
    ITEMS.filter((item) => item.category === category).map((item) => item.id),
  );
}

/** 사무실에 배치할 수 있는 아이템(외형용 아이템 제외) */
export const PLACEABLE_IDS: Set<string> = new Set(
  ITEMS.filter((item) =>
    ["FURNITURE", "DECOR", "MEETING"].includes(item.category),
  ).map((item) => item.id),
);
