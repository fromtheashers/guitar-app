import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import Link from "next/link";
import { Mark } from "@/components/Mark";
import { NavLinks } from "@/components/NavLinks";
import { APP_NAME } from "@/lib/brand";
import "./globals.css";
import styles from "./layout.module.css";

const ui = Schibsted_Grotesk({
  variable: "--font-ui",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Practise worship songs on guitar: chords in time with the video, easy or advanced, in any key.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#121212",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={ui.variable}>
      <body>
        <header className={styles.bar}>
          <div className={styles.inner}>
            <Link href="/" className={styles.brand}>
              <Mark size={26} />
              <span>{APP_NAME}</span>
            </Link>
            <NavLinks className={styles.nav} />
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </body>
    </html>
  );
}
