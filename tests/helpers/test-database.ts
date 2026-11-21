/**
 * DB를 쓰는 테스트가 개발 DB를 건드리지 않게 한다. 이 모듈은 부수 효과로 `DATABASE_URL`을
 * 테스트 전용 DB로 바꾸므로, `@/lib/db`나 `@/server/*`보다 **먼저** import해야 한다.
 *
 * 테스트는 열린 Run 예약과 대기 중인 Job을 지우고 프로젝트를 만든다. 사용 중인 DB에서 돌리면
 * 진행 중인 실행이 망가진다.
 *
 * 테스트 DB 주소는 `TEST_DATABASE_URL`이고, 없으면 `DATABASE_URL`의 DB 이름 뒤에 `_test`를 붙여 쓴다.
 * DB 이름에 `test`가 없으면 거부한다. 처음 한 번 만들어 두어야 한다.
 *   docker exec mvpfactory-db-1 psql -U postgres -c 'CREATE DATABASE mvpfactory_test'
 *   DATABASE_URL=<테스트 DB 주소> npx prisma migrate deploy
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile();

function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function resolveTestUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const dev = process.env.DATABASE_URL?.trim();
  if (!dev)
    throw new Error("DATABASE_URL 또는 TEST_DATABASE_URL을 설정하세요.");
  const url = new URL(dev);
  url.pathname = `/${databaseName(dev)}_test`;
  return url.toString();
}

const testUrl = resolveTestUrl();
const devUrl = process.env.DATABASE_URL?.trim();
const name = databaseName(testUrl);

if (!/test/i.test(name))
  throw new Error(
    `테스트는 이름에 "test"가 들어간 DB에서만 실행합니다. 현재 대상: ${name}`,
  );
if (devUrl && !process.env.TEST_DATABASE_URL && databaseName(devUrl) === name)
  throw new Error(
    "테스트 DB가 개발 DB와 같습니다. TEST_DATABASE_URL을 설정하세요.",
  );

process.env.DATABASE_URL = testUrl;
export const TEST_DATABASE_NAME = name;
