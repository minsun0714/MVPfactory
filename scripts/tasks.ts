/**
 * tasks/ 폴더의 작업 파일을 읽어 작업 목록과 REQ별 작업 연결 현황을 출력한다.
 *
 * 사용법
 *   npm run tasks                 작업 목록과 REQ 현황표를 출력한다.
 *   npm run tasks:check           작업 파일의 형식 오류를 검사한다. 오류가 있으면 종료 코드 1.
 *
 * 상태는 파일에 적지 않고 다음 규칙으로 계산한다. (병렬 작업 시 충돌을 피하기 위함)
 *   done         tasks/done/ 폴더에 있다.
 *   in-progress  task/<이름> 브랜치(로컬 또는 원격)가 있다.
 *   blocked      depends_on 중 완료되지 않은 작업이 있다.
 *   ready        위에 해당하지 않는다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Status = "ready" | "blocked" | "in-progress" | "done";

interface Task {
  slug: string;
  file: string;
  title: string;
  reqs: string[];
  area: string;
  owns: string[];
  dependsOn: string[];
  isDone: boolean;
}

interface Options {
  check: boolean;
  tasksDir: string;
  prdPath: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REQ_PATTERN = /^REQ-\d{3}$/;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    check: false,
    tasksDir: path.resolve(process.cwd(), "tasks"),
    prdPath: path.resolve(process.cwd(), "docs/MVP_FACTORY_PRD.md"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") options.check = true;
    else if (arg === "--dir" && argv[i + 1]) {
      options.tasksDir = path.resolve(process.cwd(), argv[(i += 1)]);
    } else if (arg === "--prd" && argv[i + 1]) {
      options.prdPath = path.resolve(process.cwd(), argv[(i += 1)]);
    }
  }
  return options;
}

function stripComment(value: string): string {
  return value.replace(/\s+#.*$/, "").trim();
}

function parseList(value: string): string[] {
  const cleaned = stripComment(value);
  const inner = cleaned.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseFrontmatter(text: string): Record<string, string> | null {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const separator = line.indexOf(":");
    if (separator < 1 || /^\s/.test(line) || line.startsWith("#")) continue;
    let value = line.slice(separator + 1);
    // Prettier가 긴 목록을 여러 줄로 나누므로 닫는 ]까지 이어 붙인다.
    const startsList = value.trim() === "" || value.trim().startsWith("[");
    if (startsList && !value.includes("]")) {
      while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) {
        i += 1;
        value += ` ${stripComment(lines[i])}`;
        if (lines[i].includes("]")) break;
      }
    }
    fields[line.slice(0, separator).trim()] = value;
  }
  return fields;
}

function readTaskFiles(dir: string, isDone: boolean, errors: string[]): Task[] {
  if (!existsSync(dir)) return [];
  const tasks: Task[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md") || name.startsWith("_")) continue;
    const slug = name.slice(0, -3);
    const file = path.join(dir, name);
    const label = path.relative(process.cwd(), file);
    if (!SLUG_PATTERN.test(slug)) {
      errors.push(
        `${label}: 파일 이름은 소문자-영문-하이픈 형식이어야 합니다.`,
      );
    }
    const fields = parseFrontmatter(readFileSync(file, "utf8"));
    if (!fields) {
      errors.push(`${label}: 파일 맨 위에 --- 로 감싼 머리말이 없습니다.`);
      continue;
    }
    const title = stripComment(fields.title ?? "");
    const reqs = parseList(fields.reqs ?? "");
    const area = stripComment(fields.area ?? "");
    if (!title) errors.push(`${label}: title이 없습니다.`);
    if (!area) errors.push(`${label}: area가 없습니다.`);
    if (reqs.length === 0)
      errors.push(`${label}: reqs에 REQ 번호가 하나 이상 필요합니다.`);
    for (const req of reqs) {
      if (!REQ_PATTERN.test(req)) {
        errors.push(`${label}: reqs의 "${req}"는 REQ-001 형식이 아닙니다.`);
      }
    }
    tasks.push({
      slug,
      file: label,
      title,
      reqs,
      area,
      owns: parseList(fields.owns ?? ""),
      dependsOn: parseList(fields.depends_on ?? ""),
      isDone,
    });
  }
  return tasks;
}

function readBranches(): Set<string> {
  try {
    const output = execFileSync(
      "git",
      [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        "refs/remotes",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(output.split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

function hasTaskBranch(slug: string, branches: Set<string>): boolean {
  for (const branch of branches) {
    if (branch === `task/${slug}` || branch.endsWith(`/task/${slug}`))
      return true;
  }
  return false;
}

function computeStatus(
  task: Task,
  doneSlugs: Set<string>,
  branches: Set<string>,
): Status {
  if (task.isDone) return "done";
  if (hasTaskBranch(task.slug, branches)) return "in-progress";
  if (task.dependsOn.some((dependency) => !doneSlugs.has(dependency)))
    return "blocked";
  return "ready";
}

function normalizePath(pattern: string): string {
  return pattern.replace(/\/\*\*?$/, "").replace(/\/$/, "");
}

function overlaps(a: string, b: string): boolean {
  const left = normalizePath(a);
  const right = normalizePath(b);
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function findOverlaps(openTasks: Task[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < openTasks.length; i += 1) {
    for (let j = i + 1; j < openTasks.length; j += 1) {
      for (const first of openTasks[i].owns) {
        for (const second of openTasks[j].owns) {
          if (overlaps(first, second)) {
            warnings.push(
              `${openTasks[i].slug} ↔ ${openTasks[j].slug}: 같은 파일 영역을 맡고 있습니다 (${first} / ${second})`,
            );
          }
        }
      }
    }
  }
  return warnings;
}

function readReqTitles(prdPath: string): Map<string, string> {
  const titles = new Map<string, string>();
  if (!existsSync(prdPath)) return titles;
  for (const line of readFileSync(prdPath, "utf8").split("\n")) {
    const match = line.match(/^### (REQ-\d{3}) (.+)$/);
    if (match) titles.set(match[1], match[2].trim());
  }
  return titles;
}

function printTasks(tasks: Task[], statuses: Map<string, Status>): void {
  const order: Status[] = ["in-progress", "ready", "blocked", "done"];
  const labels: Record<Status, string> = {
    "in-progress": "진행 중",
    ready: "시작 가능",
    blocked: "선행 작업 대기",
    done: "완료",
  };
  console.log("# 작업 목록\n");
  for (const status of order) {
    const group = tasks.filter((task) => statuses.get(task.slug) === status);
    if (group.length === 0) continue;
    console.log(`## ${labels[status]} (${group.length})`);
    for (const task of group) {
      const waiting = task.dependsOn.filter(
        (dependency) => statuses.get(dependency) !== "done",
      );
      const note = status === "blocked" ? ` ← 대기: ${waiting.join(", ")}` : "";
      console.log(
        `- ${task.slug} [${task.area}] ${task.reqs.join(", ")} — ${task.title}${note}`,
      );
    }
    console.log("");
  }
}

function printReqTable(
  tasks: Task[],
  statuses: Map<string, Status>,
  titles: Map<string, string>,
): void {
  const reqs = new Set<string>([
    ...titles.keys(),
    ...tasks.flatMap((task) => task.reqs),
  ]);
  console.log("# REQ별 작업 연결 현황\n");
  console.log(
    "작업 파일이 REQ에 연결된 정도만 보여 줍니다. 구현이 끝났는지는 알려 주지 않으며, 구현 여부는 검증 결과로 판단합니다.\n",
  );
  console.log("| REQ | 제목 | 완료 작업 | 남은 작업 |");
  console.log("| --- | --- | --- | --- |");
  for (const req of [...reqs].sort()) {
    const linked = tasks.filter((task) => task.reqs.includes(req));
    const done = linked.filter(
      (task) => statuses.get(task.slug) === "done",
    ).length;
    const open = linked.length - done;
    const remaining = linked.length === 0 ? "연결된 작업 없음" : String(open);
    console.log(
      `| ${req} | ${titles.get(req) ?? "-"} | ${done} | ${remaining} |`,
    );
  }
  console.log("");
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const errors: string[] = [];
  const openTasks = readTaskFiles(options.tasksDir, false, errors);
  const doneTasks = readTaskFiles(
    path.join(options.tasksDir, "done"),
    true,
    errors,
  );
  const tasks = [...openTasks, ...doneTasks];

  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.slug)) {
      errors.push(
        `${task.file}: 같은 이름의 작업이 tasks/와 tasks/done/에 모두 있습니다.`,
      );
    }
    seen.add(task.slug);
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!seen.has(dependency)) {
        errors.push(
          `${task.file}: depends_on의 "${dependency}" 작업 파일이 없습니다.`,
        );
      }
    }
  }

  const doneSlugs = new Set(doneTasks.map((task) => task.slug));
  const branches = readBranches();
  const statuses = new Map<string, Status>(
    tasks.map((task) => [task.slug, computeStatus(task, doneSlugs, branches)]),
  );
  const warnings = findOverlaps(openTasks);

  if (options.check) {
    for (const warning of warnings) console.warn(`경고: ${warning}`);
    if (errors.length > 0) {
      for (const error of errors) console.error(`오류: ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `작업 파일 ${tasks.length}개 검사 통과 (경고 ${warnings.length}건)`,
    );
    return;
  }

  printTasks(tasks, statuses);
  printReqTable(tasks, statuses, readReqTitles(options.prdPath));
  if (warnings.length > 0) {
    console.log(
      "# 같은 파일 영역을 맡은 작업 (병렬 작업 전 담당자를 조율하세요)\n",
    );
    for (const warning of warnings) console.log(`- ${warning}`);
    console.log("");
  }
  if (errors.length > 0) {
    console.log("# 형식 오류\n");
    for (const error of errors) console.log(`- ${error}`);
    process.exitCode = 1;
  }
}

main();
