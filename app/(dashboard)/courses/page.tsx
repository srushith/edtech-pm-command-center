import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Courses" };

export default function Page({ searchParams }: PageProps<"/courses">) {
  return <SectionPlaceholder id="courses" searchParams={searchParams} />;
}
