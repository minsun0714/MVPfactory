/**
 * Composition Root. 구체 구현을 만들어 유스케이스에 연결한다.
 * 진입점(Route Handler, 워커)만 이 모듈을 사용한다.
 */
import { createCompanyUseCases } from "@/application/company";
import { createDecisionUseCases } from "@/application/decisions";
import { createEventUseCases } from "@/application/events";
import { createHealthUseCases } from "@/application/health";
import { createOfficeUseCases } from "@/application/office";
import { createProjectUseCases } from "@/application/projects";
import { createResultUseCases } from "@/application/results";
import { createRunUseCases } from "@/application/runs";
import { createSettingsUseCases } from "@/application/settings";
import { RunEventNotifier } from "@/infrastructure/events/run-event-notifier";
import { createConnectionProbe } from "@/infrastructure/integrations/connection-probe";
import { createIntegrationReadiness } from "@/infrastructure/integrations/readiness";
import { createCompanyRepository } from "@/infrastructure/prisma/company-repository";
import { createDecisionRepository } from "@/infrastructure/prisma/decision-repository";
import { createRunEventRepository } from "@/infrastructure/prisma/event-repository";
import { createHealthRepository } from "@/infrastructure/prisma/health-repository";
import { createOfficeRepository } from "@/infrastructure/prisma/office-repository";
import { createProjectRepository } from "@/infrastructure/prisma/project-repository";
import { createResultRepository } from "@/infrastructure/prisma/result-repository";
import { createRunRepository } from "@/infrastructure/prisma/run-repository";
import { createSettingsRepository } from "@/infrastructure/prisma/settings-repository";
import { createWorkspaceFeedRepository } from "@/infrastructure/prisma/workspace-feed-repository";
import { db } from "@/lib/db";

const globalForNotifier = globalThis as unknown as {
  runEventNotifier?: RunEventNotifier;
};

/** DB 연결을 잡고 있으므로 모듈이 다시 불러와져도 하나만 유지한다. */
function getNotifier(): RunEventNotifier {
  if (!globalForNotifier.runEventNotifier) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL을 설정하세요.");
    globalForNotifier.runEventNotifier = new RunEventNotifier(connectionString);
  }
  return globalForNotifier.runEventNotifier;
}

function build() {
  const notifier = getNotifier();
  return {
    notifier,
    projects: createProjectUseCases(createProjectRepository(db)),
    runs: createRunUseCases(
      createRunRepository(db),
      createIntegrationReadiness({ settings: createSettingsRepository(db) }),
    ),
    decisions: createDecisionUseCases(createDecisionRepository(db)),
    events: createEventUseCases(
      createRunEventRepository(db),
      notifier,
      createWorkspaceFeedRepository(db),
    ),
    office: createOfficeUseCases(createOfficeRepository(db)),
    company: createCompanyUseCases(createCompanyRepository(db)),
    settings: createSettingsUseCases(
      createSettingsRepository(db),
      createConnectionProbe(),
    ),
    health: createHealthUseCases(createHealthRepository(db)),
    results: createResultUseCases(createResultRepository(db)),
  };
}

let container: ReturnType<typeof build> | undefined;

/** 유스케이스는 모듈 단위로 한 번만 만든다. 개발 중 코드가 바뀌어 모듈이 다시 불러와지면 새로 만든다. */
export function getContainer() {
  container ??= build();
  return container;
}
