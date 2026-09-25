"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === "light" ? "dark" : "light";
  return (
    <Button variant="ghost" size="icon-sm" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} onClick={() => setTheme(next)}>
      {/* Both icons render; CSS picks one so server and client markup match. */}
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
