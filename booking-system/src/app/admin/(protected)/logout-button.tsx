"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { staffLogout } from "@/app/actions/admin";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await staffLogout();
          router.replace("/admin/login");
        })
      }
      disabled={pending}
      className="rounded-lg bg-forest-600 hover:bg-forest-500 px-3 py-1.5 transition"
    >
      登出
    </button>
  );
}
