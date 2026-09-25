import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export const metadata: Metadata = { title: "Learner Voice" };

export default function Page({ searchParams }: PageProps<"/learner-voice">) {
  return <SectionPlaceholder id="learner-voice" searchParams={searchParams} />;
}
