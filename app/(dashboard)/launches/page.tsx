import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Launches" };

export default function Page({ searchParams }: PageProps<"/launches">) {
  return <SectionPlaceholder id="launches" searchParams={searchParams} />;
}
