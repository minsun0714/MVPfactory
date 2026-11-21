import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "MVP 팩토리", description: "아이디어에서 개발 계획까지" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body><header><nav><Link href="/">MVP 팩토리</Link><Link href="/new">새 프로젝트</Link></nav></header><main><div className="notice">데모 실행 — 실제 AI 생성 및 외부 배포는 수행하지 않습니다</div>{children}</main></body></html>;
}
