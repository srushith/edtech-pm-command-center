import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Instructor / SME Hub" };

export default function Page({ searchParams }: PageProps<"/talent">) {
  return <SectionPlaceholder id="talent" searchParams={searchParams} />;
}
