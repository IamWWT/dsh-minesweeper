/**
 * 难度预设 + 自定义网格校验（引擎层，UI 与测试共用）。
 */
import { isFeasible } from "./engine.ts";

export interface DifficultyPreset {
  id: string;
  label: string;
  rows: number;
  cols: number;
  mines: number;
}

export const PRESETS: DifficultyPreset[] = [
  { id: "beginner", label: "入门 9×9 / 10雷", rows: 9, cols: 9, mines: 10 },
  { id: "intermediate", label: "进阶 16×16 / 40雷", rows: 16, cols: 16, mines: 40 },
  { id: "expert", label: "专家 30×16 / 99雷", rows: 30, cols: 16, mines: 99 },
];

/** 自定义网格 UI 层范围限制（引擎本身更宽松，UI 收敛到合理区间）。 */
export const CUSTOM_MIN = 5;
export const CUSTOM_MAX = 30;

export interface CustomInput {
  rows: number;
  cols: number;
  mines: number;
}

/** 校验自定义输入；返回 null = 通过，否则为中文错误信息。 */
export function validateCustom(rows: number, cols: number, mines: number): string | null {
  if (![rows, cols, mines].every((n) => Number.isInteger(n))) return "行 / 列 / 雷数必须是整数";
  if (rows < CUSTOM_MIN || rows > CUSTOM_MAX || cols < CUSTOM_MIN || cols > CUSTOM_MAX) {
    return `行 / 列须在 ${CUSTOM_MIN}–${CUSTOM_MAX} 之间`;
  }
  if (mines < 0) return "雷数不能为负";
  const cap = Math.floor((rows * cols) / 2);
  if (mines > cap) return `雷数不能超过 ${cap}（格数的一半）`;
  if (!isFeasible(rows, cols, mines)) return "该组合无法满足首点安全，请减少雷数";
  return null;
}

/** 成绩持久化键（localStorage）。 */
export function statsKeyOf(diffId: string): string {
  return `dsh-minesweeper/v1/${diffId}`;
}