import { redirect } from "next/navigation";

// The Command Center home arrives in Phase 2; until then land on data integrity.
export default function Home() {
  redirect("/data");
}
