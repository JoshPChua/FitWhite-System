/**
 * FitWhite Aesthetics POS - Database Types
 * 
 * Hand-crafted type definitions matching the Supabase schema.
 * These provide type safety for all Supabase queries.
 */

// ─── Enums ──────────────────────────────────────────────────

export type UserRole = 'owner' | 'manager' | 'cashier';
export type BranchType = 'owned' | 'managed';
export type ItemType = 'service' | 'product' | 'bundle';
export type PaymentMethod = 'cash' | 'gcash' | 'card' | 'bank_transfer';
export type SaleStatus = 'completed' | 'refunded' | 'partial_refund' | 'voided';
export type AdjustmentType = 'sale' | 'refund' | 'manual_add' | 'manual_remove' | 'initial' | 'bulk_upload';
export type RefundType = 'product' | 'service' | 'consumed';

// ─── Database type for Supabase client ──────────────────────

export interface Database {
  public: {
    Tables: {
      branches: {
        Row: {
          id: string;
          name: string;
          code: string;
          type: BranchType;
          address: string | null;
          phone: string | null;
          email: string | null;
          is_active: boolean;
          reporting_restricted: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          type?: BranchType;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          is_active?: boolean;
          reporting_restricted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          type?: BranchType;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          is_active?: boolean;
          reporting_restricted?: boolean;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          first_name: string;
          last_name: string;
          role: UserRole;
          branch_id: string | null;
          is_active: boolean;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          first_name: string;
          last_name: string;
          role?: UserRole;
          branch_id?: string | null;
          is_active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          first_name?: string;
          last_name?: string;
          role?: UserRole;
          branch_id?: string | null;
          is_active?: boolean;
          avatar_url?: string | null;
          updated_at?: string;
        };
      };
      customers: {
        Row: {
          id: string;
          branch_id: string;
          first_name: string;
          last_name: string;
          email: string | null;
          phone: string | null;
          store_credit: number;
          allergies: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          first_name: string;
          last_name: string;
          email?: string | null;
          phone?: string | null;
          store_credit?: number;
          allergies?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          branch_id?: string;
          first_name?: string;
          last_name?: string;
          email?: string | null;
          phone?: string | null;
          store_credit?: number;
          allergies?: string | null;
          notes?: string | null;
          updated_at?: string;
        };
      };
      services: {
        Row: {
          id: string;
          branch_id: string;
          name: string;
          description: string | null;
          price: number;
          duration_minutes: number | null;
          category: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          name: string;
          description?: string | null;
          price: number;
          duration_minutes?: number | null;
          category?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          branch_id?: string;
          name?: string;
          description?: string | null;
          price?: number;
          duration_minutes?: number | null;
          category?: string | null;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      products: {
        Row: {
          id: string;
          branch_id: string;
          name: string;
          description: string | null;
          sku: string | null;
          price: number;
          category: string | null;
          unit: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          name: string;
          description?: string | null;
          sku?: string | null;
          price: number;
          category?: string | null;
          unit?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          branch_id?: string;
          name?: string;
          description?: string | null;
          sku?: string | null;
          price?: number;
          category?: string | null;
          unit?: string;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      inventory: {
        Row: {
          id: string;
          product_id: string;
          branch_id: string;
          quantity: number;
          low_stock_threshold: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          branch_id: string;
          quantity?: number;
          low_stock_threshold?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          product_id?: string;
          branch_id?: string;
          quantity?: number;
          low_stock_threshold?: number;
          updated_at?: string;
        };
      };
      bundles: {
        Row: {
          id: string;
          branch_id: string;
          name: string;
          description: string | null;
          price: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          name: string;
          description?: string | null;
          price: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          branch_id?: string;
          name?: string;
          description?: string | null;
          price?: number;
          is_active?: boolean;
          updated_at?: string;
        };
      };
      bundle_items: {
        Row: {
          id: string;
          bundle_id: string;
          service_id: string | null;
          product_id: string | null;
          quantity: number;
        };
        Insert: {
          id?: string;
          bundle_id: string;
          service_id?: string | null;
          product_id?: string | null;
          quantity?: number;
        };
        Update: {
          bundle_id?: string;
          service_id?: string | null;
          product_id?: string | null;
          quantity?: number;
        };
      };
      sales: {
        Row: {
          id: string;
          receipt_number: string;
          branch_id: string;
          user_id: string;
          customer_id: string | null;
          subtotal: number;
          discount: number;
          tax: number;
          total: number;
          status: SaleStatus;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          receipt_number: string;
          branch_id: string;
          user_id: string;
          customer_id?: string | null;
          subtotal: number;
          discount?: number;
          tax?: number;
          total: number;
          status?: SaleStatus;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          receipt_number?: string;
          branch_id?: string;
          user_id?: string;
          customer_id?: string | null;
          subtotal?: number;
          discount?: number;
          tax?: number;
          total?: number;
          status?: SaleStatus;
          notes?: string | null;
          updated_at?: string;
        };
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          item_type: ItemType;
          service_id: string | null;
          product_id: string | null;
          bundle_id: string | null;
          name: string;
          quantity: number;
          unit_price: number;
          total_price: number;
        };
        Insert: {
          id?: string;
          sale_id: string;
          item_type: ItemType;
          service_id?: string | null;
          product_id?: string | null;
          bundle_id?: string | null;
          name: string;
          quantity: number;
          unit_price: number;
          total_price: number;
        };
        Update: {
          sale_id?: string;
          item_type?: ItemType;
          service_id?: string | null;
          product_id?: string | null;
          bundle_id?: string | null;
          name?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
        };
      };
      payments: {
        Row: {
          id: string;
          sale_id: string;
          method: PaymentMethod;
          amount: number;
          change_amount: number;
          reference_number: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          sale_id: string;
          method: PaymentMethod;
          amount: number;
          change_amount?: number;
          reference_number?: string | null;
          created_at?: string;
        };
        Update: {
          sale_id?: string;
          method?: PaymentMethod;
          amount?: number;
          change_amount?: number;
          reference_number?: string | null;
        };
      };
      refunds: {
        Row: {
          id: string;
          sale_id: string;
          branch_id: string;
          user_id: string;
          refund_type: RefundType;
          amount: number;
          reason: string;
          notes: string;
          return_inventory: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          sale_id: string;
          branch_id: string;
          user_id: string;
          refund_type: RefundType;
          amount: number;
          reason: string;
          notes: string;
          return_inventory?: boolean;
          created_at?: string;
        };
        Update: {
          sale_id?: string;
          branch_id?: string;
          user_id?: string;
          refund_type?: RefundType;
          amount?: number;
          reason?: string;
          notes?: string;
          return_inventory?: boolean;
        };
      };
      refund_items: {
        Row: {
          id: string;
          refund_id: string;
          sale_item_id: string;
          quantity: number;
          amount: number;
        };
        Insert: {
          id?: string;
          refund_id: string;
          sale_item_id: string;
          quantity: number;
          amount: number;
        };
        Update: {
          refund_id?: string;
          sale_item_id?: string;
          quantity?: number;
          amount?: number;
        };
      };
      stock_adjustments: {
        Row: {
          id: string;
          inventory_id: string;
          branch_id: string;
          user_id: string;
          adjustment_type: AdjustmentType;
          quantity_change: number;
          reason: string | null;
          reference_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          inventory_id: string;
          branch_id: string;
          user_id: string;
          adjustment_type: AdjustmentType;
          quantity_change: number;
          reason?: string | null;
          reference_id?: string | null;
          created_at?: string;
        };
        Update: {
          inventory_id?: string;
          branch_id?: string;
          user_id?: string;
          adjustment_type?: AdjustmentType;
          quantity_change?: number;
          reason?: string | null;
          reference_id?: string | null;
        };
      };
      treatment_history: {
        Row: {
          id: string;
          customer_id: string;
          branch_id: string;
          service_name: string;
          dosage: string | null;
          notes: string | null;
          administered_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          branch_id: string;
          service_name: string;
          dosage?: string | null;
          notes?: string | null;
          administered_by?: string | null;
          created_at?: string;
        };
        Update: {
          customer_id?: string;
          branch_id?: string;
          service_name?: string;
          dosage?: string | null;
          notes?: string | null;
          administered_by?: string | null;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string;
          branch_id: string | null;
          action_type: string;
          entity_type: string | null;
          entity_id: string | null;
          description: string | null;
          metadata: Record<string, unknown> | null;
          ip_address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          branch_id?: string | null;
          action_type: string;
          entity_type?: string | null;
          entity_id?: string | null;
          description?: string | null;
          metadata?: Record<string, unknown> | null;
          ip_address?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          branch_id?: string | null;
          action_type?: string;
          entity_type?: string | null;
          entity_id?: string | null;
          description?: string | null;
          metadata?: Record<string, unknown> | null;
          ip_address?: string | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_role: {
        Args: Record<string, never>;
        Returns: UserRole;
      };
      get_user_branch_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_owner: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      generate_receipt_number: {
        Args: { branch_code: string };
        Returns: string;
      };
    };
    Enums: {
      user_role: UserRole;
      branch_type: BranchType;
      item_type: ItemType;
      payment_method: PaymentMethod;
      sale_status: SaleStatus;
      adjustment_type: AdjustmentType;
      refund_type: RefundType;
    };
  };
}

// ─── Convenience types ──────────────────────────────────────

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type InsertTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type UpdateTables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

// Named row types for easy import
export type Branch = Tables<'branches'>;
export type Profile = Tables<'profiles'>;
export type Customer = Tables<'customers'>;
export type Service = Tables<'services'>;
export type Product = Tables<'products'>;
export type Inventory = Tables<'inventory'>;
export type Bundle = Tables<'bundles'>;
export type BundleItem = Tables<'bundle_items'>;
export type Sale = Tables<'sales'>;
export type SaleItem = Tables<'sale_items'>;
export type Payment = Tables<'payments'>;
export type Refund = Tables<'refunds'>;
export type RefundItem = Tables<'refund_items'>;
export type StockAdjustment = Tables<'stock_adjustments'>;
export type TreatmentHistory = Tables<'treatment_history'>;
export type AuditLog = Tables<'audit_logs'>;

// ─── Auth context type (used throughout the app) ────────────

export interface AuthUser {
  id: string;
  email: string;
  profile: Profile;
}
