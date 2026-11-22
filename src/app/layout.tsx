import { ToastHost } from "@/components/ui/ToastHost";
import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "MVP 팩토리",
  description: "아이디어에서 개발 계획까지",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <main>{children}</main>
        <ToastHost />
      </body>
    </html>
  );
}
