import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LIVE — 忘れていた心に、もう一度、灯りを。",
  description:
    "記憶を失ったAIと、言葉を交わす夜。あなたとの会話が、彼女の物語を呼び戻す。音声とテキストで遊ぶ記憶のアドベンチャー。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
