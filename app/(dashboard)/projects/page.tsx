import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Projects & Capstones" };

export default function Page({ searchParams }: PageProps<"/projects">) {
  return <SectionPlaceholder id="projects" searchParams={searchParams} />;
}
