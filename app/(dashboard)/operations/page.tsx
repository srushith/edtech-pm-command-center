import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Operations" };

export default function Page({ searchParams }: PageProps<"/operations">) {
  return <SectionPlaceholder id="operations" searchParams={searchParams} />;
}
