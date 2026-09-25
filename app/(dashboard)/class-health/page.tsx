import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Class Health" };

export default function Page({ searchParams }: PageProps<"/class-health">) {
  return <SectionPlaceholder id="class-health" searchParams={searchParams} />;
}
