import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** 팩토리 DB 클라이언트. 업무 규칙을 두지 않는다. */
export const db = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** 로그인이 없는 단일 사용자 작업 공간의 고정 ID */
export const WORKSPACE_ID = "default";
