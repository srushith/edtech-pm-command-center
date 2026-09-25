import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Curriculum" };

export default function Page({ searchParams }: PageProps<"/curriculum">) {
  return <SectionPlaceholder id="curriculum" searchParams={searchParams} />;
}
