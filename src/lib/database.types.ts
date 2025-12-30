// Database types placeholder
// Run `npx supabase gen types typescript --project-id wktzqqbjbaogobrcmxuw > src/lib/database.types.ts`
// after running `npx supabase login` to generate full types

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: Record<string, unknown>
    Views: Record<string, unknown>
    Functions: {
      get_roster_with_scenario_overrides: {
        Args: {
          scenario_name: string
        }
        Returns: {
          emp_id: string
          name: string
          team: string
          role: string
          core: string
          support: string
          date: string
          display_value: string
          is_tail: boolean
          bay: string
          source: 'roster' | 'scenario' | 'override'
        }[]
      }
    }
    Enums: Record<string, unknown>
  }
}
