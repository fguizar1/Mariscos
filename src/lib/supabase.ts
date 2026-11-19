import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type RolUsuario = "admin" | "mesero" | "cocina" | "barra";

export interface Usuario {
  id: string;
  nombre: string;
  rol: RolUsuario;
  pin_acceso: string;
  activo: boolean;
}

export interface Mesa {
  id: string;
  nombre: string;
  estado: "libre" | "ocupada";
  orden_visual: number;
}

export interface Categoria {
  id: string;
  nombre: string;
  area_destino: "cocina" | "barra";
  orden_visual: number;
}

export interface Producto {
  id: string;
  categoria_id: string;
  nombre: string;
  precio: number;
  disponible: boolean;
}
