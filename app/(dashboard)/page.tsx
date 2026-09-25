import { SectionPlaceholder } from "@/components/shell/section-placeholder";

export default function Page({ searchParams }: PageProps<"/">) {
  return <SectionPlaceholder id="command-center" searchParams={searchParams} />;
}
