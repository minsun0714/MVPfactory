-- CreateEnum
CREATE TYPE "ArtifactAuthor" AS ENUM ('PM', 'PLANNER', 'DESIGNER', 'DEVELOPER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('PASS', 'FAIL', 'NOT_RUN', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "CeoLevel" AS ENUM ('DELEGATE', 'KEY_DECISIONS', 'COLLABORATIVE');

-- CreateEnum
CREATE TYPE "RunMode" AS ENUM ('REAL', 'DEMO');

-- CreateEnum
CREATE TYPE "RoleId" AS ENUM ('PM', 'PLANNER', 'DESIGNER', 'DEVELOPER');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('github', 'vercel', 'supabase');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'NOT_CONNECTED', 'INSUFFICIENT_PERMISSION', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "RepoVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ExternalOperationStatus" AS ENUM ('PLANNED', 'REQUESTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DecisionKind" AS ENUM ('SCOPE_REVIEW', 'DESIGN_REVIEW', 'INTEGRATED_REVIEW', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('PREPARED', 'OPEN', 'ANSWERED', 'APPLIED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DecisionChoice" AS ENUM ('APPROVE', 'REQUEST_CHANGES', 'SELECT_OPTION');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('IN_PROGRESS', 'WAITING_CEO', 'ENDED', 'FAILED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "MeetingEntryKind" AS ENUM ('STATEMENT', 'REACTION');

-- CreateEnum
CREATE TYPE "ExternalResourceKind" AS ENUM ('REPOSITORY', 'DATABASE', 'DEPLOYMENT_PROJECT');

-- CreateEnum
CREATE TYPE "DeploymentStage" AS ENUM ('CANDIDATE', 'PUBLISHED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RunType" AS ENUM ('INITIAL', 'REVISION');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_CEO', 'PAUSED', 'BLOCKED', 'FAILED', 'SUCCEEDED');

-- CreateEnum
CREATE TYPE "BlockedReason" AS ENUM ('CONNECTION_MISSING', 'PERMISSION_DENIED', 'LIMIT_REACHED', 'EXTERNAL_RESULT_UNKNOWN', 'WORKER_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('START', 'RESUME', 'RECOVER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'WAITING', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepExecutionId" TEXT,
    "author" "ArtifactAuthor" NOT NULL,
    "type" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "specVersion" INTEGER,
    "content" JSONB,
    "storageRef" TEXT,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "lockfileDigest" TEXT,
    "templateVersion" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "storageRef" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationReport" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "specVersion" INTEGER NOT NULL,
    "sourceDigest" TEXT,
    "commitSha" TEXT,
    "deploymentId" TEXT,
    "envRevision" TEXT,
    "harnessVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "result" "VerificationResult" NOT NULL,
    "evidence" TEXT,
    "reason" TEXT,

    CONSTRAINT "VerificationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "repoVisibility" "RepoVisibility" NOT NULL DEFAULT 'PRIVATE',
    "limitMaxModelCalls" INTEGER,
    "limitMaxFixAttempts" INTEGER,
    "limitMaxActiveSeconds" INTEGER,
    "limitMaxEstimatedCost" DECIMAL(12,4),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "ConnectionStatus" NOT NULL,
    "target" TEXT,
    "checkedAt" TIMESTAMPTZ(3),
    "message" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConnectionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyLayout" (
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "characters" JSONB NOT NULL,
    "office" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyLayout_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "DecisionKind" NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PREPARED',
    "proposalVersion" INTEGER NOT NULL,
    "proposalFingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "proposal" JSONB NOT NULL,
    "changesFromPrevious" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "interruptRef" TEXT,
    "responseChoice" "DecisionChoice",
    "responseOptionId" TEXT,
    "responseComment" TEXT,
    "answeredAt" TIMESTAMPTZ(3),
    "appliedAt" TIMESTAMPTZ(3),
    "supersededById" TEXT,
    "openedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "stageId" TEXT,
    "role" "RoleId",
    "summary" TEXT NOT NULL,
    "refs" JSONB NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "decisionId" TEXT,
    "topic" TEXT NOT NULL,
    "participants" "RoleId"[],
    "status" "MeetingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "outcome" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingEntry" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" "MeetingEntryKind" NOT NULL,
    "entryOrder" INTEGER NOT NULL,
    "eventSequence" INTEGER NOT NULL,
    "role" "RoleId" NOT NULL,
    "text" TEXT,
    "reactionKind" TEXT,

    CONSTRAINT "MeetingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalResource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "kind" "ExternalResourceKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalOperation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "operationKey" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ExternalOperationStatus" NOT NULL DEFAULT 'PLANNED',
    "targetAccount" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "externalId" TEXT,
    "evidence" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExternalOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppMigration" (
    "id" TEXT NOT NULL,
    "databaseResourceId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "appliedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AppMigration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "providerDeploymentId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "envRevision" TEXT NOT NULL,
    "migrationVersion" TEXT,
    "url" TEXT,
    "stage" "DeploymentStage" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "instanceId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("instanceId")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "purpose" TEXT,
    "constraints" TEXT,
    "ceoLevel" "CeoLevel" NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "projectGeneration" INTEGER NOT NULL DEFAULT 0,
    "confirmedSpecVersion" INTEGER,
    "lastGoodDeploymentId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSpec" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdByRunId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "RunType" NOT NULL,
    "mode" "RunMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "stageId" TEXT,
    "stageLabel" TEXT,
    "ceoLevel" "CeoLevel" NOT NULL,
    "blockedReason" "BlockedReason",
    "failure" JSONB,
    "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "projectGeneration" INTEGER NOT NULL,
    "baseSpecVersion" INTEGER,
    "workflowVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "templateVersion" TEXT,
    "modelConfig" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "usageModelCalls" INTEGER NOT NULL DEFAULT 0,
    "usageFixAttempts" INTEGER NOT NULL DEFAULT 0,
    "usageActiveSeconds" INTEGER NOT NULL DEFAULT 0,
    "usageWaitingSeconds" INTEGER NOT NULL DEFAULT 0,
    "usageCostAmount" DECIMAL(12,4),
    "usageCostCurrency" TEXT,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "eventsRetainedFrom" INTEGER NOT NULL DEFAULT 1,
    "threadId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveRunLock" (
    "workspaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveRunLock_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "dedupeKey" TEXT NOT NULL,
    "causeJobId" TEXT,
    "claimedBy" TEXT,
    "claimEpoch" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMPTZ(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "notBefore" TIMESTAMPTZ(3),
    "noOpReason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "inputFingerprint" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "errorClass" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepExecutionId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "costAmount" DECIMAL(12,4),
    "costCurrency" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_runId_type_revision_key" ON "Artifact"("runId", "type", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "SourceSnapshot_runId_sourceDigest_key" ON "SourceSnapshot"("runId", "sourceDigest");

-- CreateIndex
CREATE INDEX "VerificationReport_runId_idx" ON "VerificationReport"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationItem_reportId_checkId_key" ON "VerificationItem"("reportId", "checkId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionState_workspaceId_provider_key" ON "ConnectionState"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_supersededById_key" ON "Decision"("supersededById");

-- CreateIndex
CREATE INDEX "Decision_status_openedAt_idx" ON "Decision"("status", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_runId_kind_round_key" ON "Decision"("runId", "kind", "round");

-- CreateIndex
CREATE UNIQUE INDEX "RunEvent_runId_sequence_key" ON "RunEvent"("runId", "sequence");

-- CreateIndex
CREATE INDEX "Meeting_runId_startedAt_idx" ON "Meeting"("runId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingEntry_meetingId_eventSequence_key" ON "MeetingEntry"("meetingId", "eventSequence");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalResource_projectId_provider_kind_key" ON "ExternalResource"("projectId", "provider", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalOperation_operationKey_key" ON "ExternalOperation"("operationKey");

-- CreateIndex
CREATE INDEX "ExternalOperation_projectId_idx" ON "ExternalOperation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AppMigration_databaseResourceId_version_key" ON "AppMigration"("databaseResourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_projectId_providerDeploymentId_key" ON "Deployment"("projectId", "providerDeploymentId");

-- CreateIndex
CREATE INDEX "Project_workspaceId_archivedAt_updatedAt_idx" ON "Project"("workspaceId", "archivedAt", "updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSpec_projectId_version_key" ON "ProductSpec"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Run_threadId_key" ON "Run"("threadId");

-- CreateIndex
CREATE INDEX "Run_projectId_createdAt_idx" ON "Run"("projectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Run_status_idx" ON "Run"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveRunLock_runId_key" ON "ActiveRunLock"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_notBefore_createdAt_idx" ON "Job"("status", "notBefore", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StepExecution_runId_nodeId_inputFingerprint_attempt_key" ON "StepExecution"("runId", "nodeId", "inputFingerprint", "attempt");

-- CreateIndex
CREATE INDEX "UsageRecord_runId_idx" ON "UsageRecord"("runId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_stepExecutionId_fkey" FOREIGN KEY ("stepExecutionId") REFERENCES "StepExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationItem" ADD CONSTRAINT "VerificationItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "VerificationReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionState" ADD CONSTRAINT "ConnectionState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLayout" ADD CONSTRAINT "CompanyLayout_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingEntry" ADD CONSTRAINT "MeetingEntry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalResource" ADD CONSTRAINT "ExternalResource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalOperation" ADD CONSTRAINT "ExternalOperation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalOperation" ADD CONSTRAINT "ExternalOperation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppMigration" ADD CONSTRAINT "AppMigration_databaseResourceId_fkey" FOREIGN KEY ("databaseResourceId") REFERENCES "ExternalResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_lastGoodDeploymentId_fkey" FOREIGN KEY ("lastGoodDeploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpec" ADD CONSTRAINT "ProductSpec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSpec" ADD CONSTRAINT "ProductSpec_createdByRunId_fkey" FOREIGN KEY ("createdByRunId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveRunLock" ADD CONSTRAINT "ActiveRunLock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveRunLock" ADD CONSTRAINT "ActiveRunLock_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_causeJobId_fkey" FOREIGN KEY ("causeJobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_stepExecutionId_fkey" FOREIGN KEY ("stepExecutionId") REFERENCES "StepExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Prisma 스키마로 표현하지 못하는 제약. 설계: docs/DB_SCHEMA.md §5, §7

-- 작업 공간은 하나뿐이다.
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_single_row_check" CHECK ("id" = 'default');

-- 이벤트 순번과 보존 시작 순번
ALTER TABLE "Run" ADD CONSTRAINT "Run_sequence_check" CHECK ("lastSequence" >= 0 AND "eventsRetainedFrom" >= 1);
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_sequence_positive_check" CHECK ("sequence" >= 1);

-- 프로젝트·결정의 버전은 음수가 될 수 없다.
ALTER TABLE "Project" ADD CONSTRAINT "Project_generation_check" CHECK ("projectGeneration" >= 0);
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_version_check" CHECK ("proposalVersion" >= 1 AND "round" >= 1);

-- 응답이 저장된(ANSWERED, APPLIED) 결정에는 선택이 있어야 한다.
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_response_check" CHECK ("status" NOT IN ('ANSWERED', 'APPLIED') OR "responseChoice" IS NOT NULL);

-- 산출물은 본문 또는 저장소 참조 중 하나가 있어야 한다.
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_content_or_storage_check" CHECK ("content" IS NOT NULL OR "storageRef" IS NOT NULL);

-- 적용 대상이 아닌(NOT_APPLICABLE) 검증 항목에는 근거가 있어야 한다.
ALTER TABLE "VerificationItem" ADD CONSTRAINT "VerificationItem_not_applicable_reason_check" CHECK ("result" <> 'NOT_APPLICABLE' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0));

-- 회의 참여자는 1~4명이다.
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_participants_check" CHECK (cardinality("participants") BETWEEN 1 AND 4);

-- 발언에는 내용, 반응에는 종류가 있어야 한다.
ALTER TABLE "MeetingEntry" ADD CONSTRAINT "MeetingEntry_kind_fields_check" CHECK (("kind" = 'STATEMENT' AND "text" IS NOT NULL) OR ("kind" = 'REACTION' AND "reactionKind" IS NOT NULL));

-- 문자열로 둔 열거형의 허용 값
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_kind_check" CHECK ("kind" IN ('MODEL_CALL', 'FIX_ATTEMPT', 'ACTIVE_TIME'));
ALTER TABLE "AppMigration" ADD CONSTRAINT "AppMigration_status_check" CHECK ("status" IN ('PLANNED', 'APPLIED', 'FAILED'));
