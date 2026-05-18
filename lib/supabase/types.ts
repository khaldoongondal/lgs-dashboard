/**
 * Minimal Supabase Database type so the client doesn't infer `never` for
 * tables we haven't generated types for yet. When we wire up
 * `supabase gen types typescript`, this file gets replaced.
 */

type AnyTable = {
  Row:           any;
  Insert:        any;
  Update:        any;
  Relationships: [];
};

export type Database = {
  public: {
    Tables:         Record<string, AnyTable>;
    Views:          Record<string, AnyTable>;
    Functions:      Record<string, { Args: any; Returns: any }>;
    Enums:          Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
