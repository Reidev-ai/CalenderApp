export type UpdatePhase = "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
export type UpdateStatus = {
  phase: UpdatePhase;
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};
