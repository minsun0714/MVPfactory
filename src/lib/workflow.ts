import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
} from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { db } from "./db";
import {
  developer,
  designer,
  planner,
  pm,
  RoleOutput,
  validateOutput,
} from "./roles";

const State = Annotation.Root({ runId: Annotation<string>() });
type StateValue = typeof State.State;

const roles = {
  pm: {
    label: "PM",
    type: "진행 요약",
    run: pm,
    required: ["입력과_제약", "진행_요약", "결정"],
  },
  planner: {
    label: "기획자",
    type: "기획 결과",
    run: planner,
    required: ["목적", "핵심_기능", "데이터_항목", "완료_조건"],
  },
  designer: {
    label: "디자이너",
    type: "화면 구성",
    run: designer,
    required: ["화면_목록", "화면_구성", "상태"],
  },
  developer: {
    label: "개발자",
    type: "개발 계획",
    run: developer,
    required: ["구현_계획", "앞선_결과", "검증_항목"],
  },
};

async function roleNode(state: StateValue, key: keyof typeof roles) {
  const role = roles[key];
  const run = await db.run.update({
    where: { id: state.runId },
    data: { stage: role.label },
    include: { project: true, artifacts: true },
  });
  const previous =
    run.artifacts
      .map((a) => `${a.type}: ${JSON.stringify(a.content)}`)
      .join("\n") || "입력 아이디어";
  const output: RoleOutput = validateOutput(
    role.run({
      idea: run.project.idea,
      requirements: run.project.requirements,
      previous,
    }),
    role.required,
  );
  await db.artifact.upsert({
    where: { runId_type: { runId: run.id, type: role.type } },
    create: {
      runId: run.id,
      role: role.label,
      type: role.type,
      content: output,
    },
    update: {},
  });
  return {};
}

async function review(state: StateValue, type: string) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: state.runId },
    include: { artifacts: true, project: true },
  });
  const proposal = run.artifacts
    .map((a) => `${a.type}: ${JSON.stringify(a.content)}`)
    .join("\n");
  await db.decision.upsert({
    where: { runId_type: { runId: run.id, type } },
    create: { runId: run.id, type, proposal },
    update: {},
  });
  interrupt({ type });
  await db.$transaction(async (tx) => {
    const decision = await tx.decision.findUniqueOrThrow({
      where: { runId_type: { runId: run.id, type } },
    });
    if (decision.status !== "ANSWERED" || !decision.response)
      throw new Error("CEO 응답이 없습니다.");
    const applied = await tx.decision.updateMany({
      where: { id: decision.id, appliedAt: null },
      data: { appliedAt: new Date() },
    });
    if (applied.count) {
      const project = await tx.project.findUniqueOrThrow({
        where: { id: run.projectId },
      });
      await tx.project.update({
        where: { id: project.id },
        data: {
          requirements: `${project.requirements}\nCEO ${type}: ${decision.response}`,
        },
      });
    }
  });
  return {};
}

async function afterPlanning(state: StateValue) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: state.runId },
    include: { project: true },
  });
  return run.project.ceoLevel === "COLLABORATIVE" ? "scope" : "design";
}
async function afterDesign(state: StateValue) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: state.runId },
    include: { project: true },
  });
  if (run.project.ceoLevel === "DELEGATE") {
    await db.decision.upsert({
      where: { runId_type: { runId: run.id, type: "위임 결정" } },
      create: {
        runId: run.id,
        type: "위임 결정",
        proposal:
          "중간 검토 없이 기획과 화면 구성을 기준으로 개발 계획을 진행합니다.",
        status: "ANSWERED",
        response: "CEO가 중간 결정을 위임했습니다.",
        answeredAt: new Date(),
      },
      update: {},
    });
    return "develop";
  }
  return "designReview";
}

export async function createWorkflow(connectionString: string) {
  const saver = PostgresSaver.fromConnString(connectionString);
  await saver.setup();
  const graph = new StateGraph(State)
    .addNode("pm", (s) => roleNode(s, "pm"))
    .addNode("plan", (s) => roleNode(s, "planner"))
    .addNode("scope", (s) => review(s, "기능 범위"))
    .addNode("design", (s) => roleNode(s, "designer"))
    .addNode("designReview", (s) => review(s, "통합안 및 화면 구성"))
    .addNode("develop", (s) => roleNode(s, "developer"))
    .addEdge(START, "pm")
    .addEdge("pm", "plan")
    .addConditionalEdges("plan", afterPlanning, ["scope", "design"])
    .addEdge("scope", "design")
    .addConditionalEdges("design", afterDesign, ["designReview", "develop"])
    .addEdge("designReview", "develop")
    .addEdge("develop", END)
    .compile({ checkpointer: saver });
  return graph;
}

export async function processRun(
  graph: Awaited<ReturnType<typeof createWorkflow>>,
  runId: string,
) {
  const config = { configurable: { thread_id: runId } };
  const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
  if (run.mode !== "DEMO")
    throw new Error("실제 실행 모드는 연동이 구현되지 않았습니다.");
  let snapshot = await graph.getState(config);
  const interruption = snapshot.tasks.flatMap(
    (task) => task.interrupts ?? [],
  )[0];
  if (interruption) {
    const type = (interruption.value as { type: string }).type;
    const decision = await db.decision.findUniqueOrThrow({
      where: { runId_type: { runId, type } },
    });
    if (decision.status === "PENDING") {
      await db.run.update({
        where: { id: runId },
        data: { status: "WAITING", stage: `CEO 검토: ${type}` },
      });
      return;
    }
    await graph.invoke(new Command({ resume: decision.response }), config);
  } else if (snapshot.next.length) {
    await graph.invoke(null, config);
  } else if (!snapshot.values?.runId) {
    await graph.invoke({ runId }, config);
  }
  snapshot = await graph.getState(config);
  const nextInterrupt = snapshot.tasks.flatMap(
    (task) => task.interrupts ?? [],
  )[0];
  if (nextInterrupt) {
    const type = (nextInterrupt.value as { type: string }).type;
    const decision = await db.decision.findUniqueOrThrow({
      where: { runId_type: { runId, type } },
    });
    await db.run.update({
      where: { id: runId },
      data: {
        status: decision.status === "ANSWERED" ? "QUEUED" : "WAITING",
        stage: `CEO 검토: ${type}`,
      },
    });
  } else if (!snapshot.next.length) {
    await db.run.update({
      where: { id: runId },
      data: { status: "COMPLETED", stage: "데모 완료", finishedAt: new Date() },
    });
  } else {
    throw new Error("워크플로우가 예상하지 못한 상태로 중단되었습니다.");
  }
}
