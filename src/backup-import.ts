export type ImportPreview = {
  fingerprint: string;
  hasProfile: boolean;
  hasPlan: boolean;
  weeklyWorkoutDays: number;
  weeklyMealDays: number;
  workoutOverrides: number;
  mealOverrides: number;
  completedDays: number;
  skippedDays: number;
  mealLogs: number;
  measurements: number;
  actualWorkouts: number;
  videos: number;
};

export function formatImportPreview(preview: ImportPreview): string {
  return [
    `Profile: ${preview.hasProfile ? "included" : "none"}`,
    `Plan: ${preview.hasPlan ? "included" : "none"}`,
    `Weekly workout days: ${preview.weeklyWorkoutDays}`,
    `Weekly meal days: ${preview.weeklyMealDays}`,
    `Date overrides: ${preview.workoutOverrides} workouts, ${preview.mealOverrides} meals`,
    `History: ${preview.completedDays} completed, ${preview.skippedDays} skipped, ${preview.mealLogs} meal logs, ${preview.measurements} measurements, ${preview.actualWorkouts} workouts`,
    `Videos: ${preview.videos}`,
  ].join("\n");
}
