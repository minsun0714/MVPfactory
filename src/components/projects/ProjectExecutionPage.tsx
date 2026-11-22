"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ProjectOperations,
  ProjectRunHistory,
} from "@/components/office/ProjectOperations";
function useExecutionRefresh() {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { revision, refresh };
}
export function ProjectExecutionPage({
  id,
  history = false,
}: {
  id: string;
  history?: boolean;
}) {
  const { revision, refresh } = useExecutionRefresh();
  return (
    <div className="factory-ui project-manager project-execution">
      <nav className="pixel-wrap" aria-label="페이지 이동">
        {history && (
          <Link href={`/projects/${encodeURIComponent(id)}`}>
            ← 프로젝트 상세
          </Link>
        )}
        <Link href={`/office?project=${encodeURIComponent(id)}`}>사무실로</Link>
      </nav>
      {history ? (
        <ProjectRunHistory id={id} refresh={refresh} revision={revision} />
      ) : (
        <ProjectOperations id={id} refresh={refresh} revision={revision} />
      )}
    </div>
  );
}
