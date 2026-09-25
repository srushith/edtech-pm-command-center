import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "AI Insights" };

export default function Page({ searchParams }: PageProps<"/ai-insights">) {
  return <SectionPlaceholder id="ai-insights" searchParams={searchParams} />;
}
