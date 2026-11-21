/**
 * 가상 회사 계약. 기준 문서: docs/API.md §8
 * 제안 초안이다. 화면 담당과 협의해 확정한다.
 */
import type { IsoDateTime, RoleId } from "@/contracts/common";

export type CharacterAppearance = {
  body: string;
  hair: string;
  outfit: string;
  /** 카탈로그의 아이템 ID */
  accessories: string[];
};

export type OfficeItemPlacement = {
  itemId: string;
  x: number;
  y: number;
  rotation: number;
};

export type MeetingSeat = { seatId: string; x: number; y: number };

export type OfficeLayout = {
  expansionLevel: number;
  items: OfficeItemPlacement[];
  /** 배치에서 서버가 계산한 좌석(최대 4) */
  meetingSeats: MeetingSeat[];
};

export type Company = {
  /** 저장할 때마다 증가. 동시 편집 충돌 감지에 사용 */
  version: number;
  characters: Record<RoleId, CharacterAppearance>;
  office: OfficeLayout;
  updatedAt: IsoDateTime;
};

export const CATALOG_CATEGORIES = [
  "BODY",
  "HAIR",
  "OUTFIT",
  "ACCESSORY",
  "FURNITURE",
  "DECOR",
  "MEETING",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/** 모든 아이템과 확장은 처음부터 사용 가능하다(해금 조건 없음) */
export type CatalogItem = {
  id: string;
  category: CatalogCategory;
  name: string;
};
export type OfficeExpansion = { level: number; name: string };
export type CompanyCatalog = {
  items: CatalogItem[];
  expansions: OfficeExpansion[];
};

export type UpdateCharacterRequest = {
  version: number;
  appearance: CharacterAppearance;
};
export type UpdateOfficeRequest = { version: number; layout: OfficeLayout };
