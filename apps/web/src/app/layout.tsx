import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "./providers";
import "./globals.css";
import { Inter, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

const geistMonoHeading = Geist_Mono({subsets:['latin'],variable:'--font-heading'});

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
	title: "Nyxel",
	description: "Self-hosted agentic OS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			className={cn("font-sans", inter.variable, geistMonoHeading.variable)}
		>
			<body>
				<TooltipProvider>
					<Providers>
						<AppShell>{children}</AppShell>
					</Providers>
				</TooltipProvider>
			</body>
		</html>
	);
}
