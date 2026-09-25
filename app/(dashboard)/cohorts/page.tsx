import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Cohorts" };

export default function Page({ searchParams }: PageProps<"/cohorts">) {
  return <SectionPlaceholder id="cohorts" searchParams={searchParams} />;
}
