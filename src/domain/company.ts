import { ROLE_IDS } from "@/contracts/common";
import type { RoleId } from "@/contracts/common";
import type {
  CharacterAppearance,
  Company,
  MeetingSeat,
  OfficeItemPlacement,
  OfficeLayout,
  UpdateCharacterRequest,
  UpdateOfficeRequest,
} from "@/contracts/company";
import { CATALOG, PLACEABLE_IDS, idsOf } from "@/domain/company-catalog";
import { AppError } from "@/domain/errors";

export const MAX_MEETING_SEATS = 4;
export const MAX_OFFICE_ITEMS = 200;
export const MAX_COORDINATE = 99;
const ROTATIONS = [0, 90, 180, 270];

export function defaultCharacters(): Record<RoleId, CharacterAppearance> {
  return {
    PM: {
      body: "body-1",
      hair: "hair-short",
      outfit: "outfit-jacket",
      accessories: ["headset"],
    },
    PLANNER: {
      body: "body-2",
      hair: "hair-curly",
      outfit: "outfit-cardigan",
      accessories: ["glasses", "pencil"],
    },
    DESIGNER: {
      body: "body-3",
      hair: "hair-bob",
      outfit: "outfit-apron",
      accessories: ["beret"],
    },
    DEVELOPER: {
      body: "body-1",
      hair: "hair-long",
      outfit: "outfit-hoodie",
      accessories: ["headphones"],
    },
  };
}

/** 회의 좌석은 배치된 회의 의자에서 서버가 계산한다. 클라이언트가 보낸 좌석은 쓰지 않는다. */
export function computeMeetingSeats(
  items: OfficeItemPlacement[],
): MeetingSeat[] {
  return items
    .filter((item) => item.itemId === "meeting-chair")
    .slice(0, MAX_MEETING_SEATS)
    .map((item, index) => ({
      seatId: `seat-${index + 1}`,
      x: item.x,
      y: item.y,
    }));
}

export function defaultOffice(): OfficeLayout {
  const items: OfficeItemPlacement[] = [
    { itemId: "desk", x: 2, y: 2, rotation: 0 },
    { itemId: "desk", x: 6, y: 2, rotation: 0 },
    { itemId: "desk", x: 2, y: 6, rotation: 0 },
    { itemId: "desk", x: 6, y: 6, rotation: 0 },
    { itemId: "meeting-table", x: 12, y: 4, rotation: 0 },
    { itemId: "meeting-chair", x: 11, y: 3, rotation: 0 },
    { itemId: "meeting-chair", x: 13, y: 3, rotation: 0 },
    { itemId: "meeting-chair", x: 11, y: 6, rotation: 180 },
    { itemId: "meeting-chair", x: 13, y: 6, rotation: 180 },
    { itemId: "plant", x: 0, y: 0, rotation: 0 },
    { itemId: "bookshelf", x: 9, y: 0, rotation: 0 },
  ];
  return { expansionLevel: 0, items, meetingSeats: computeMeetingSeats(items) };
}

export function defaultCompany(): Pick<Company, "characters" | "office"> {
  return { characters: defaultCharacters(), office: defaultOffice() };
}

function invalid(field: string, message: string): AppError {
  return new AppError("VALIDATION_FAILED", message, {
    details: { fields: [{ field, message }] },
  });
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid(field, "객체여야 합니다.");
  return value as Record<string, unknown>;
}

function readVersion(body: Record<string, unknown>): number {
  const version = body.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    throw invalid("version", "1 이상의 정수여야 합니다.");
  return version;
}

function pick(
  value: unknown,
  field: string,
  category: Parameters<typeof idsOf>[0],
): string {
  if (typeof value !== "string" || !idsOf(category).has(value))
    throw invalid(field, "카탈로그에 없는 아이템입니다.");
  return value;
}

export function parseRole(value: string): RoleId {
  if ((ROLE_IDS as readonly string[]).includes(value)) return value as RoleId;
  throw new AppError("NOT_FOUND", "알 수 없는 역할입니다.");
}

export function parseAppearance(value: unknown): CharacterAppearance {
  const body = asRecord(value, "appearance");
  const accessories = body.accessories;
  if (!Array.isArray(accessories) || accessories.length > 5)
    throw invalid(
      "appearance.accessories",
      "액세서리는 최대 5개까지 고를 수 있습니다.",
    );
  const unique = [
    ...new Set(
      accessories.map((id) => pick(id, "appearance.accessories", "ACCESSORY")),
    ),
  ];
  return {
    body: pick(body.body, "appearance.body", "BODY"),
    hair: pick(body.hair, "appearance.hair", "HAIR"),
    outfit: pick(body.outfit, "appearance.outfit", "OUTFIT"),
    accessories: unique,
  };
}

export function parseUpdateCharacter(value: unknown): UpdateCharacterRequest {
  const body = asRecord(value, "body");
  return {
    version: readVersion(body),
    appearance: parseAppearance(body.appearance),
  };
}

export function parseLayout(value: unknown): OfficeLayout {
  const body = asRecord(value, "layout");
  const level = body.expansionLevel;
  if (
    typeof level !== "number" ||
    !CATALOG.expansions.some((expansion) => expansion.level === level)
  )
    throw invalid("layout.expansionLevel", "제공하지 않는 확장 단계입니다.");
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length > MAX_OFFICE_ITEMS)
    throw invalid(
      "layout.items",
      `아이템은 최대 ${MAX_OFFICE_ITEMS}개까지 배치할 수 있습니다.`,
    );
  const items = rawItems.map((raw, index): OfficeItemPlacement => {
    const field = `layout.items[${index}]`;
    const item = asRecord(raw, field);
    const { itemId, x, y, rotation } = item;
    if (typeof itemId !== "string" || !PLACEABLE_IDS.has(itemId))
      throw invalid(`${field}.itemId`, "배치할 수 없는 아이템입니다.");
    for (const [name, coordinate] of [
      ["x", x],
      ["y", y],
    ] as const)
      if (
        typeof coordinate !== "number" ||
        !Number.isInteger(coordinate) ||
        coordinate < 0 ||
        coordinate > MAX_COORDINATE
      )
        throw invalid(
          `${field}.${name}`,
          `0~${MAX_COORDINATE} 사이의 정수여야 합니다.`,
        );
    if (typeof rotation !== "number" || !ROTATIONS.includes(rotation))
      throw invalid(`${field}.rotation`, "0, 90, 180, 270 중 하나여야 합니다.");
    return { itemId, x: x as number, y: y as number, rotation };
  });
  return {
    expansionLevel: level,
    items,
    meetingSeats: computeMeetingSeats(items),
  };
}

export function parseUpdateOffice(value: unknown): UpdateOfficeRequest {
  const body = asRecord(value, "body");
  return { version: readVersion(body), layout: parseLayout(body.layout) };
}
