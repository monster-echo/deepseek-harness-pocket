import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind 类名合并（与手机端同一套 clsx + tailwind-merge） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
